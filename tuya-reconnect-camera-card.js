class TuyaReconnectCameraCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:tuya-reconnect-camera-card",
      entity: "camera.cateye",
      title: "Tuya Camera",
      fit_mode: "cover",
      watchdog_interval: 3,
      frozen_checks: 3,
      refresh_seconds: 75,
      reconnect_delay: 2,
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
      refresh_seconds: 75,
      reconnect_delay: 2,
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
    if (!this._card) return;

    const state = hass.states[this._config.entity];
    const available = Boolean(state) && state.state !== "unavailable";

    if (!available) {
      this._setState("offline", "offline");
      this._stop();
      return;
    }

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
    this._bindImgEvents(this._img);
    this.appendChild(this._card);
  }

  // Bind load/error on a given img element.
  _bindImgEvents(img) {
    img.addEventListener("error", () => {
      this._scheduleReconnect("stream error");
    });

    img.addEventListener("load", () => {
      if (!this._running) return;
      // First frame received — stream is live. Start watchdog + periodic refresh.
      this._setState("live", "live");
      this._startWatchdog();
      this._startPeriodicRefresh();
    });
  }

  // Replace the DOM <img> element so the browser is forced to close the old
  // multipart/x-mixed-replace TCP connection before opening a new one.
  _replaceImageElement() {
    const oldImg = this._img;
    if (!oldImg || !oldImg.parentNode) return;

    const newImg = document.createElement("img");
    newImg.alt = "camera stream";
    newImg.style.objectFit = this._config.fit_mode;
    this._bindImgEvents(newImg);
    oldImg.parentNode.replaceChild(newImg, oldImg);
    this._img = newImg;
  }

  _restart() {
    this._stop();
    if (!this._connected || !this._hass || !this._config) return;

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
    if (!state) return null;

    const token = state.attributes && state.attributes.access_token;
    // camera_proxy_stream returns a continuous multipart/x-mixed-replace MJPEG
    // stream — the browser renders it live, exactly like camera-page.js in the
    // Node.js app. Relative path works both locally and via HA Cloud / reverse proxy.
    const path = "/api/camera_proxy_stream/" + this._config.entity;
    if (!token) {
      return path + "?ts=" + Date.now();
    }
    return (
      path +
      "?token=" + encodeURIComponent(token) +
      "&ts=" + Date.now()
    );
  }

  _startStream() {
    if (!this._running) return;

    const url = this._buildStreamUrl();
    if (!url) {
      this._scheduleReconnect("missing token");
      return;
    }

    this._setState("reconnecting", "connecting");

    // Replace the element to force-close the old MJPEG TCP socket before
    // opening a new connection — same pattern as camera-page.js (src = '').
    this._replaceImageElement();
    this._img.src = url;
  }

  // Canvas-based pixel watchdog — identical to the Node.js app implementation.
  // Samples an 8x8 thumbnail every watchdog_interval seconds.
  // If pixels don't change for frozen_checks consecutive checks, triggers reconnect.
  _startWatchdog() {
    clearInterval(this._watchdogTimer);

    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    this._lastPixels = null;
    this._frozenCount = 0;

    this._watchdogTimer = setInterval(() => {
      if (!this._running) return;

      try {
        ctx.drawImage(this._img, 0, 0, 8, 8);
        const pixels = ctx.getImageData(0, 0, 8, 8).data.join(",");

        if (this._lastPixels !== null && pixels === this._lastPixels) {
          this._frozenCount++;
          if (this._frozenCount >= this._config.frozen_checks) {
            clearInterval(this._watchdogTimer);
            this._scheduleReconnect("watchdog: frozen frame");
          }
        } else {
          this._frozenCount = 0;
        }

        this._lastPixels = pixels;
      } catch (_) {
        // cross-origin or element not painted yet — ignore
      }
    }, Math.max(1, this._config.watchdog_interval) * 1000);
  }

  // Force a reconnect before Tuya's RTSP token expires (~150 s).
  _startPeriodicRefresh() {
    clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => {
      if (!this._running) return;
      this._scheduleReconnect("periodic refresh");
    }, Math.max(30, this._config.refresh_seconds) * 1000);
  }

  _scheduleReconnect(reason) {
    if (!this._running) return;

    clearTimeout(this._reconnectTimer);
    clearInterval(this._watchdogTimer);
    clearInterval(this._refreshTimer);
    this._watchdogTimer = null;
    this._refreshTimer = null;

    this._setState("reconnecting", "reconnecting");
    console.debug("[tuya-camera-card] reconnect:", reason);

    this._reconnectTimer = setTimeout(() => {
      if (!this._running) return;
      this._startStream();
    }, Math.max(0, this._config.reconnect_delay) * 1000);
  }

  _setState(mode, label) {
    if (!this._statusEl) return;
    this._statusEl.className = "status " + mode;
    this._statusEl.textContent = label;
  }
}

customElements.define("tuya-reconnect-camera-card", TuyaReconnectCameraCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tuya-reconnect-camera-card",
  name: "Tuya Reconnect Camera Card",
  description: "Live MJPEG stream with canvas freeze-watchdog and auto-reconnect",
  preview: true,
});
