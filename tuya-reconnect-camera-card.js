class TuyaReconnectCameraCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:tuya-reconnect-camera-card",
      entity: "camera.cateye",
      title: "Tuya Camera",
      fit_mode: "cover",
      watchdog_interval: 3,
      frozen_checks: 3,
      refresh_seconds: 100,
      reconnect_delay: 1,
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
      refresh_seconds: 100,
      reconnect_delay: 1,
      ...config,
    };

    if (!this._card) {
      this._buildCard();
    }

    this._titleEl.textContent = this._config.title || this._config.entity;
    this._img.style.objectFit = this._config.fit_mode;

    if (this.isConnected) {
      this._restart();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._card) {
      return;
    }

    const state = hass.states[this._config.entity];
    const available = Boolean(state) && state.state !== "unavailable";
    this._setState(available ? "live" : "offline");

    if (available && !this._running) {
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
          background: #0f141a;
          border-radius: 12px;
          overflow: hidden;
          min-height: 220px;
        }

        .title {
          padding: 10px 12px;
          font-size: 14px;
          font-weight: 600;
          color: var(--primary-text-color);
          background: linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.15));
          position: absolute;
          left: 0;
          right: 0;
          z-index: 3;
        }

        img {
          width: 100%;
          height: 100%;
          min-height: 220px;
          display: block;
          background: #111;
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

        .status.live { border: 1px solid #1db954; }
        .status.reconnecting { border: 1px solid #f5a524; }
        .status.offline { border: 1px solid #e5484d; }
      </style>
      <div class="wrap">
        <div class="title"></div>
        <img alt="camera stream" />
        <div class="status reconnecting">connecting</div>
      </div>
    `;

    this._titleEl = this._card.querySelector(".title");
    this._img = this._card.querySelector("img");
    this._statusEl = this._card.querySelector(".status");

    this._img.addEventListener("error", () => {
      this._scheduleReconnect("load error");
    });

    this.appendChild(this._card);
  }

  _restart() {
    this._stop();
    if (!this._connected || !this._hass || !this._config) {
      return;
    }

    this._running = true;
    this._setState("reconnecting", "connecting");
    this._startStream();
  }

  _stop() {
    this._running = false;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._watchdogTimer);
    clearInterval(this._refreshTimer);
    this._reconnectTimer = null;
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
    if (!token) {
      return null;
    }

    const path = "/api/camera_proxy_stream/" + this._config.entity + "?token=" + token + "&ts=" + Date.now();
    return this._hass.hassUrl(path);
  }

  _startStream() {
    if (!this._running) {
      return;
    }

    const url = this._buildStreamUrl();
    if (!url) {
      this._scheduleReconnect("missing token");
      return;
    }

    this._setState("reconnecting", "reconnecting");
    this._img.src = url;

    clearTimeout(this._warmupTimer);
    this._warmupTimer = setTimeout(() => {
      if (!this._running) {
        return;
      }
      this._setState("live", "live");
      this._startWatchdog();
      this._startPeriodicRefresh();
    }, 1500);
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
      if (!this._running || !ctx) {
        return;
      }

      try {
        ctx.drawImage(this._img, 0, 0, 8, 8);
        const pixels = ctx.getImageData(0, 0, 8, 8).data;

        let signature = "";
        for (let i = 0; i < pixels.length; i += 4) {
          signature += String.fromCharCode(
            pixels[i],
            pixels[i + 1],
            pixels[i + 2]
          );
        }

        if (this._lastPixels === signature) {
          this._frozenCount += 1;
          if (this._frozenCount >= this._config.frozen_checks) {
            this._scheduleReconnect("watchdog freeze");
          }
        } else {
          this._frozenCount = 0;
        }

        this._lastPixels = signature;
      } catch (_err) {
        this._scheduleReconnect("watchdog error");
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
    clearInterval(this._watchdogTimer);
    clearInterval(this._refreshTimer);

    this._setState("reconnecting", "reconnecting");

    this._reconnectTimer = setTimeout(() => {
      if (!this._running) {
        return;
      }
      this._startStream();
    }, Math.max(0, this._config.reconnect_delay) * 1000);

    if (window && window.console) {
      console.debug("[tuya-reconnect-camera-card] " + reason);
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

customElements.define("tuya-reconnect-camera-card", TuyaReconnectCameraCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tuya-reconnect-camera-card",
  name: "Tuya Reconnect Camera Card",
  description: "Low-latency MJPEG card with freeze watchdog and auto-reconnect",
  preview: true,
});
