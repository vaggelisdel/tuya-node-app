class TuyaReconnectCameraCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:tuya-reconnect-camera-card",
      entity: "camera.cateye_low_latency",
      title: "Tuya Camera",
      fit_mode: "cover",
      watchdog_interval: 3,
      frozen_checks: 3,
      reconnect_delay: 1,
      refresh_seconds: 75,
      unavailable_grace: 12,
      warmup_seconds: 2,
      include_token: true,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("entity is required");
    }

    this._config = {
      fit_mode: "cover",
      watchdog_interval: 3,
      frozen_checks: 3,
      reconnect_delay: 1,
      refresh_seconds: 75,
      unavailable_grace: 12,
      warmup_seconds: 2,
      include_token: true,
      ...config,
    };

    if (!this._card) {
      this._buildCard();
    }

    this._titleEl.textContent = this._config.title || this._config.entity;
    this._img.style.objectFit = this._config.fit_mode;

    if (this.isConnected && this._hass) {
      this._restart();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._card || !this._config) {
      return;
    }

    const state = hass.states[this._config.entity];
    const available = Boolean(state) && state.state !== "unavailable";

    if (!available) {
      if (!this._unavailableTimer) {
        this._setState("reconnecting", "camera unavailable");
        this._showSpinner(true, "Camera unavailable...");
        this._unavailableTimer = setTimeout(() => {
          this._unavailableTimer = null;
          this._setState("offline", "offline");
          this._stop();
        }, Math.max(1, this._config.unavailable_grace) * 1000);
      }
      return;
    }

    clearTimeout(this._unavailableTimer);
    this._unavailableTimer = null;

    if (!this._running) {
      this._restart();
    }
  }

  connectedCallback() {
    this._connected = true;
    if (this._config && this._hass) {
      this._restart();
    }
  }

  disconnectedCallback() {
    this._connected = false;
    this._stop();
  }

  getCardSize() {
    return 3;
  }

  _buildCard() {
    this._card = document.createElement("ha-card");
    this._card.innerHTML = `
      <style>
        .wrap {
          position: relative;
          background: #000;
          border-radius: 12px;
          overflow: hidden;
          min-height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .title {
          padding: 10px 12px;
          font-size: 14px;
          font-weight: 600;
          color: var(--primary-text-color);
          background: linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.15));
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          z-index: 3;
        }

        img {
          width: 100%;
          min-height: 220px;
          display: block;
          background: #000;
        }

        .spinner-wrap {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          z-index: 2;
          pointer-events: none;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #444;
          border-top-color: #667eea;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .spinner-label {
          color: #aaa;
          font-size: 13px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .spinner-wrap.hidden {
          display: none;
        }

        .status {
          position: absolute;
          left: 10px;
          bottom: 10px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 1;
          color: #fff;
          background: rgba(0, 0, 0, 0.55);
          z-index: 3;
          backdrop-filter: blur(3px);
        }

        .status.live {
          border: 1px solid #1db954;
        }

        .status.reconnecting {
          border: 1px solid #f5a524;
        }

        .status.offline {
          border: 1px solid #e5484d;
        }
      </style>
      <div class="wrap">
        <div class="title"></div>
        <img alt="camera stream" />
        <div class="spinner-wrap" id="spinnerWrap">
          <div class="spinner"></div>
          <span class="spinner-label">Loading stream...</span>
        </div>
        <div class="status reconnecting">connecting</div>
      </div>
    `;

    this._titleEl = this._card.querySelector(".title");
    this._img = this._card.querySelector("img");
    this._spinner = this._card.querySelector("#spinnerWrap");
    this._statusEl = this._card.querySelector(".status");
    this._bindImgEvents(this._img);

    this.appendChild(this._card);
  }

  _bindImgEvents(img) {
    img.addEventListener("load", () => {
      if (!this._running) {
        return;
      }
      this._setState("live", "live");
      this._showSpinner(false);
      this._startWatchdog();
      this._startPeriodicRefresh();
    });

    img.addEventListener("error", () => {
      this._scheduleReconnect("image error");
    });
  }

  _replaceImageElement() {
    const oldImg = this._img;
    if (!oldImg || !oldImg.parentNode) {
      return;
    }

    const newImg = document.createElement("img");
    newImg.alt = oldImg.alt || "camera stream";
    newImg.style.objectFit = this._config.fit_mode;
    this._bindImgEvents(newImg);
    oldImg.parentNode.replaceChild(newImg, oldImg);
    this._img = newImg;
  }

  _restart() {
    this._stop();
    if (!this._connected || !this._hass || !this._config) {
      return;
    }

    this._running = true;
    this._setState("reconnecting", "connecting");
    this._showSpinner(true, "Loading stream...");
    this._requestNewStream("initial");
  }

  _stop() {
    this._running = false;
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._warmupTimer);
    clearTimeout(this._unavailableTimer);
    clearInterval(this._watchdogTimer);
    clearInterval(this._refreshTimer);
    this._reconnectTimer = null;
    this._warmupTimer = null;
    this._unavailableTimer = null;
    this._watchdogTimer = null;
    this._refreshTimer = null;
    this._lastPixels = null;
    this._frozenCount = 0;

    if (this._img) {
      this._img.removeAttribute("src");
    }
  }

  _buildStreamUrl() {
    const state = this._hass.states[this._config.entity];
    if (!state) {
      return null;
    }

    const token = state.attributes && state.attributes.access_token;
    const path = this._config.stream_path || "/api/camera_proxy_stream/" + this._config.entity;
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2);

    // Always include the access_token — HA requires it for camera_proxy_stream
    // when the request comes from an <img> element (no Authorization header).
    if (this._config.include_token && token && !path.includes("token=")) {
      return path + "?token=" + encodeURIComponent(token) + "&ts=" + ts + "&r=" + rnd;
    }

    return path + (path.includes("?") ? "&" : "?") + "ts=" + ts + "&r=" + rnd;
  }

  _requestNewStream(reason) {
    if (!this._running) {
      return;
    }

    const url = this._buildStreamUrl();
    if (!url) {
      this._scheduleReconnect("missing stream url");
      return;
    }

    this._setState("reconnecting", "connecting");
    this._showSpinner(true, "Loading stream...");
    this._replaceImageElement();
    this._img.src = url;

    clearTimeout(this._warmupTimer);
    this._warmupTimer = setTimeout(() => {
      if (!this._running) {
        return;
      }
      this._setState("reconnecting", "waiting frames");
      this._startWatchdog();
      this._startPeriodicRefresh();
    }, Math.max(1, this._config.warmup_seconds) * 1000);

    if (window.console) {
      console.debug("[tuya-camera-card] requested new stream:", reason);
    }
  }

  _startWatchdog() {
    clearInterval(this._watchdogTimer);
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    this._lastPixels = null;
    this._frozenCount = 0;

    this._watchdogTimer = setInterval(() => {
      if (!this._running) {
        return;
      }

      try {
        ctx.drawImage(this._img, 0, 0, 8, 8);
        const pixels = ctx.getImageData(0, 0, 8, 8).data.join(",");

        if (this._lastPixels !== null && pixels === this._lastPixels) {
          this._frozenCount += 1;
          if (this._frozenCount >= this._config.frozen_checks) {
            clearInterval(this._watchdogTimer);
            this._scheduleReconnect("watchdog frozen");
          }
        } else {
          this._frozenCount = 0;
        }

        this._lastPixels = pixels;
      } catch (_error) {
        // Ignore read errors until image has painted.
      }
    }, Math.max(1, this._config.watchdog_interval) * 1000);
  }

  _startPeriodicRefresh() {
    clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => {
      if (!this._running) {
        return;
      }
      this._scheduleReconnect("periodic refresh");
    }, Math.max(30, this._config.refresh_seconds) * 1000);
  }

  _scheduleReconnect(reason) {
    if (!this._running) {
      return;
    }

    clearTimeout(this._reconnectTimer);
    clearTimeout(this._warmupTimer);
    clearInterval(this._watchdogTimer);
    clearInterval(this._refreshTimer);
    this._watchdogTimer = null;
    this._refreshTimer = null;

    if (this._img) {
      this._img.removeAttribute("src");
    }

    this._setState("reconnecting", "reconnecting");
    this._showSpinner(true, "Reconnecting...");
    if (window.console) {
      console.debug("[tuya-camera-card] reconnect:", reason);
    }

    this._reconnectTimer = setTimeout(() => {
      if (!this._running) {
        return;
      }
      this._requestNewStream(reason);
    }, Math.max(0, this._config.reconnect_delay) * 1000);
  }

  _showSpinner(visible, label) {
    if (!this._spinner) {
      return;
    }
    this._spinner.classList.toggle("hidden", !visible);
    if (label) {
      const labelEl = this._spinner.querySelector(".spinner-label");
      if (labelEl) {
        labelEl.textContent = label;
      }
    }
  }

  _setState(mode, label) {
    if (!this._statusEl) {
      return;
    }
    this._statusEl.className = "status " + mode;
    this._statusEl.textContent = label;
  }
}

if (!customElements.get("tuya-reconnect-camera-card")) {
  customElements.define("tuya-reconnect-camera-card", TuyaReconnectCameraCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tuya-reconnect-camera-card",
  name: "Tuya Reconnect Camera Card",
  description: "RTSP proxy stream card with stuck-frame watchdog and stream re-request",
  preview: true,
});
