// Lazy-load hls.js from CDN — same version used in camera-page.js
const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js";

async function loadHlsJs() {
  if (window.Hls) return window.Hls;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HLS_CDN;
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error("Failed to load hls.js"));
    document.head.appendChild(s);
  });
}

class TuyaReconnectCameraCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:tuya-reconnect-camera-card",
      entity: "camera.cateye",
      title: "Tuya Camera",
      fit_mode: "contain",
      stall_checks: 2,
      stall_interval: 6,
      reconnect_delay: 3,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("entity is required");
    }

    this._config = {
      fit_mode: "contain",
      stall_checks: 2,       // consecutive stall detections before reconnect
      stall_interval: 6,     // seconds between stall checks
      reconnect_delay: 3,    // seconds to wait before reconnecting
      ...config,
    };

    if (!this._card) {
      this._buildCard();
    }

    this._titleEl.textContent = this._config.title || this._config.entity;
    this._video.style.objectFit = this._config.fit_mode;

    if (this.isConnected && this._hass) {
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

        video {
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

        @keyframes spin { to { transform: rotate(360deg); } }

        .spinner-wrap.hidden { display: none; }

        .status {
          position: absolute;
          left: 10px;
          bottom: 10px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 1;
          color: #fff;
          background: rgba(0,0,0,0.55);
          z-index: 3;
          backdrop-filter: blur(3px);
        }

        .status.live        { border: 1px solid #1db954; }
        .status.reconnecting{ border: 1px solid #f5a524; }
        .status.offline     { border: 1px solid #e5484d; }
      </style>
      <div class="wrap">
        <div class="title"></div>
        <video playsinline muted autoplay></video>
        <div class="spinner-wrap" id="spinnerWrap">
          <div class="spinner"></div>
          <span class="spinner-label">Loading stream…</span>
        </div>
        <div class="status reconnecting">connecting</div>
      </div>
    `;

    this._titleEl  = this._card.querySelector(".title");
    this._video    = this._card.querySelector("video");
    this._spinner  = this._card.querySelector("#spinnerWrap");
    this._statusEl = this._card.querySelector(".status");
    this.appendChild(this._card);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  _restart() {
    this._stop();
    if (!this._connected || !this._hass || !this._config) return;

    this._running = true;
    this._setState("reconnecting", "connecting");
    this._showSpinner(true, "Loading stream…");
    this._startHls();
  }

  _stop() {
    this._running = false;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._stallTimer);
    this._reconnectTimer = null;
    this._stallTimer     = null;
    this._stallCount     = 0;

    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }

    this._video.pause();
    this._video.removeAttribute("src");
    this._video.load();
  }

  // ── HLS stream — mirrors loadHlsStream() in camera-page.js ───────────────

  async _startHls() {
    if (!this._running) return;

    try {
      // Step 1 — ask HA to start the HLS pipeline (same as POST /api/streams/:id/start)
      const result = await this._hass.callWS({
        type: "camera/stream",
        entity_id: this._config.entity,
        format: "hls",
      });

      if (!this._running) return;

      const url = result.url + "?t=" + Date.now();

      // Step 2 — load HLS.js (lazy) and attach to <video>
      const Hls = await loadHlsJs();
      if (!this._running) return;

      if (Hls.isSupported()) {
        this._hls = new Hls({
          enableWorker:              true,
          liveSyncDurationCount:     2,
          liveMaxLatencyDurationCount: 4,
          lowLatencyMode:            true,
          backBufferLength:          0,
        });

        this._hls.attachMedia(this._video);
        this._hls.loadSource(url);

        this._hls.on(Hls.Events.MANIFEST_PARSED, () => {
          this._video.play().catch(() => {});
          this._showSpinner(false);
          this._setState("live", "live");
          this._startStallWatcher();
        });

        this._hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            this._scheduleReconnect("hls fatal error");
          }
        });

      } else if (this._video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        this._video.src = url;
        this._video.load();
        this._video.play().catch(() => {});
        this._showSpinner(false);
        this._setState("live", "live");
        this._startStallWatcher();
      } else {
        this._scheduleReconnect("hls not supported");
      }

    } catch (err) {
      console.error("[tuya-camera-card] stream start failed:", err);
      this._scheduleReconnect("stream start error");
    }
  }

  // ── Stall watcher — mirrors startHlsStallWatcher() in camera-page.js ─────

  _startStallWatcher() {
    clearInterval(this._stallTimer);
    let lastTime  = -1;
    this._stallCount = 0;

    this._stallTimer = setInterval(() => {
      if (!this._running) return;
      const t = this._video.currentTime;

      if (!this._video.paused && t === lastTime) {
        this._stallCount++;
        if (this._stallCount >= this._config.stall_checks) {
          clearInterval(this._stallTimer);
          this._scheduleReconnect("video stalled");
        }
      } else {
        this._stallCount = 0;
      }
      lastTime = t;
    }, Math.max(1, this._config.stall_interval) * 1000);
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  _scheduleReconnect(reason) {
    if (!this._running) return;

    clearTimeout(this._reconnectTimer);
    clearInterval(this._stallTimer);
    this._stallTimer = null;

    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    this._video.pause();
    this._video.removeAttribute("src");
    this._video.load();

    this._setState("reconnecting", "reconnecting");
    this._showSpinner(true, "Reconnecting…");
    console.debug("[tuya-camera-card] reconnect:", reason);

    this._reconnectTimer = setTimeout(() => {
      if (!this._running) return;
      this._startHls();
    }, Math.max(0, this._config.reconnect_delay) * 1000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _showSpinner(visible, label) {
    if (!this._spinner) return;
    this._spinner.classList.toggle("hidden", !visible);
    if (label) {
      this._spinner.querySelector(".spinner-label").textContent = label;
    }
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
  description: "HLS live stream card with stall-watchdog and auto-reconnect",
  preview: true,
});
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
