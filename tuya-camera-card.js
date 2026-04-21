/**
 * tuya-camera-card.js
 * HACS Lovelace card — connects to a running tuya-node-app server,
 * lists all Tuya camera devices and streams them in a grid layout.
 *
 * Configuration (Lovelace YAML):
 *   type: custom:tuya-camera-card
 *   server_url: http://192.168.1.100:3000   # required
 *   stream_method: mjpeg                     # mjpeg (default) | hls
 *   columns: 2                               # grid columns (default: 2)
 *   title: My Cameras                        # optional card title
 *   device_ids: []                           # optional allowlist of device IDs
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@latest";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------------------
// Camera tile — one per device
// ---------------------------------------------------------------------------
class TuyaCameraTile {
  /**
   * @param {object} device  { id, name, category }
   * @param {string} serverUrl
   * @param {string} method  mjpeg | hls
   */
  constructor(device, serverUrl, method) {
    this.device = device;
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.method = method;
    this.active = false;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.hlsInstance = null;

    this.root = document.createElement("div");
    this.root.className = "tile";
    this.root.innerHTML = `
      <div class="tile-header">
        <span class="dot off"></span>
        <span class="tile-name">${device.name || device.id}</span>
        <span class="tile-cat">${device.category || ""}</span>
      </div>
      <div class="tile-player">
        <img class="mjpeg-img" alt="" style="display:none" />
        <video class="hls-video" muted playsinline controls style="display:none"></video>
        <div class="tile-overlay">
          <div class="spinner"></div>
        </div>
        <div class="tile-error" style="display:none">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10
            10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <span>Stream unavailable</span>
        </div>
      </div>
    `;

    this._img = this.root.querySelector(".mjpeg-img");
    this._video = this.root.querySelector(".hls-video");
    this._overlay = this.root.querySelector(".tile-overlay");
    this._errorBox = this.root.querySelector(".tile-error");
    this._dot = this.root.querySelector(".dot");
  }

  // ---- lifecycle -----------------------------------------------------------

  start() {
    if (this.active) return;
    this.active = true;
    this._setStatus("loading");
    this.method === "hls" ? this._startHls() : this._startMjpeg();
  }

  stop() {
    this.active = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdogTimer);
    this._destroyHls();
    this._img.src = "";
    this._img.style.display = "none";
    this._video.style.display = "none";
    this._setStatus("off");
  }

  destroy() {
    this.stop();
    this.root.remove();
  }

  // ---- MJPEG ---------------------------------------------------------------

  _startMjpeg() {
    this._img.onload = null;
    this._img.onerror = null;
    this._img.src = "";

    const url = `${this.serverUrl}/api/streams/${this.device.id}/mjpeg?t=${Date.now()}`;
    this._video.style.display = "none";
    this._img.style.display = "block";
    this._img.src = url;

    // MJPEG multipart streams don't fire onload while alive — hide spinner after 6 s
    const spinnerTimeout = setTimeout(() => {
      this._overlay.style.display = "none";
      this._setStatus("on");
      this._startMjpegWatchdog();
    }, 6000);

    this._img.onload = () => {
      clearTimeout(spinnerTimeout);
      this._overlay.style.display = "none";
      this._setStatus("on");
      this._startMjpegWatchdog();
    };

    this._img.onerror = () => {
      clearTimeout(spinnerTimeout);
      this._scheduleReconnect();
    };
  }

  _startMjpegWatchdog() {
    clearInterval(this.watchdogTimer);
    const canvas = document.createElement("canvas");
    canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext("2d");
    let lastPixels = null;
    let frozen = 0;

    this.watchdogTimer = setInterval(() => {
      if (!this.active) { clearInterval(this.watchdogTimer); return; }
      try {
        ctx.drawImage(this._img, 0, 0, 8, 8);
        const px = ctx.getImageData(0, 0, 8, 8).data.join(",");
        if (lastPixels !== null && px === lastPixels) {
          if (++frozen >= 3) {
            clearInterval(this.watchdogTimer);
            this._scheduleReconnect(1000);
          }
        } else {
          frozen = 0;
        }
        lastPixels = px;
      } catch (_) {}
    }, 3000);
  }

  // ---- HLS -----------------------------------------------------------------

  async _startHls() {
    try {
      await loadScript(HLS_CDN);
    } catch (_) {
      this._showError();
      return;
    }

    // Tell the server to start (or reuse) the FFmpeg → HLS pipeline
    let playlistUrl;
    try {
      const res = await fetch(`${this.serverUrl}/api/streams/${this.device.id}/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "start failed");
      playlistUrl = `${this.serverUrl}${data.playlistUrl}?t=${Date.now()}`;
    } catch (err) {
      console.error(`[tuya-card][${this.device.id}] HLS start error:`, err);
      this._scheduleReconnect();
      return;
    }

    this._img.style.display = "none";
    this._video.style.display = "block";

    this._destroyHls();

    if (window.Hls && window.Hls.isSupported()) {
      this.hlsInstance = new window.Hls({
        enableWorker: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        lowLatencyMode: true,
        backBufferLength: 0,
      });
      this.hlsInstance.attachMedia(this._video);
      this.hlsInstance.loadSource(playlistUrl);

      this.hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this._video.play().catch(() => {});
        this._overlay.style.display = "none";
        this._setStatus("on");
        this._startHlsStallWatcher();
      });

      this.hlsInstance.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) this._scheduleReconnect();
      });
    } else if (this._video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      this._video.src = playlistUrl;
      this._video.load();
      this._overlay.style.display = "none";
      this._setStatus("on");
    } else {
      this._showError();
    }
  }

  _startHlsStallWatcher() {
    clearInterval(this.watchdogTimer);
    let lastTime = -1;
    let same = 0;
    this.watchdogTimer = setInterval(() => {
      if (!this.active) { clearInterval(this.watchdogTimer); return; }
      const t = this._video.currentTime;
      if (!this._video.paused && t === lastTime) {
        if (++same >= 2) { clearInterval(this.watchdogTimer); this._scheduleReconnect(); }
      } else { same = 0; }
      lastTime = t;
    }, 6000);
  }

  _destroyHls() {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
  }

  // ---- reconnect -----------------------------------------------------------

  _scheduleReconnect(delay = 4000) {
    if (!this.active) return;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdogTimer);
    this._setStatus("loading");
    this._overlay.style.display = "flex";
    this._errorBox.style.display = "none";
    this.reconnectTimer = setTimeout(() => {
      if (!this.active) return;
      this.method === "hls" ? this._startHls() : this._startMjpeg();
    }, delay);
  }

  // ---- helpers -------------------------------------------------------------

  _setStatus(state) {
    this._dot.className = `dot ${state}`;
  }

  _showError() {
    this._overlay.style.display = "none";
    this._errorBox.style.display = "flex";
    this._setStatus("off");
    if (this.active) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this._errorBox.style.display = "none";
        this.method === "hls" ? this._startHls() : this._startMjpeg();
      }, 15000);
    }
  }
}

// ---------------------------------------------------------------------------
// Card editor (shown in Lovelace visual editor)
// ---------------------------------------------------------------------------
class TuyaCameraCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; }

  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;
    this.innerHTML = `
      <style>
        .editor { display:grid; gap:.75rem; padding:.5rem }
        label { font-size:.85rem; font-weight:500; color:var(--primary-text-color) }
        input, select {
          width:100%; padding:.4rem .6rem; border-radius:.4rem;
          border:1px solid var(--divider-color,#ccc);
          background:var(--card-background-color,#fff);
          color:var(--primary-text-color,#000); font-size:.9rem;
        }
      </style>
      <div class="editor">
        <div>
          <label>Server URL</label>
          <input id="server_url" placeholder="http://192.168.1.100:3000"
            value="${this._config?.server_url || ""}" />
        </div>
        <div>
          <label>Stream method</label>
          <select id="stream_method">
            <option value="mjpeg" ${(this._config?.stream_method||"mjpeg")==="mjpeg"?"selected":""}>MJPEG (low latency)</option>
            <option value="hls"   ${this._config?.stream_method==="hls"?"selected":""}>HLS</option>
          </select>
        </div>
        <div>
          <label>Columns</label>
          <input id="columns" type="number" min="1" max="6"
            value="${this._config?.columns || 2}" />
        </div>
        <div>
          <label>Card title (optional)</label>
          <input id="title" value="${this._config?.title || ""}" />
        </div>
        <div>
          <label>Device IDs to show (comma-separated, leave blank for all)</label>
          <input id="device_ids"
            value="${(this._config?.device_ids || []).join(", ")}" />
        </div>
      </div>
    `;

    const fire = () => {
      const ids = this.querySelector("#device_ids").value
        .split(",").map(s => s.trim()).filter(Boolean);
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: {
          config: {
            ...this._config,
            server_url:    this.querySelector("#server_url").value.trim(),
            stream_method: this.querySelector("#stream_method").value,
            columns:       Number(this.querySelector("#columns").value) || 2,
            title:         this.querySelector("#title").value.trim() || undefined,
            device_ids:    ids.length ? ids : undefined,
          },
        },
        bubbles: true,
        composed: true,
      }));
    };

    this.querySelectorAll("input, select").forEach(el => el.addEventListener("change", fire));
  }
}

customElements.define("tuya-camera-card-editor", TuyaCameraCardEditor);

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------
class TuyaCameraCard extends HTMLElement {
  // ---- HA card lifecycle ---------------------------------------------------

  static getConfigElement() {
    return document.createElement("tuya-camera-card-editor");
  }

  static getStubConfig() {
    return { server_url: "http://192.168.1.100:3000", stream_method: "mjpeg", columns: 2 };
  }

  setConfig(config) {
    if (!config.server_url) throw new Error("tuya-camera-card: server_url is required");
    this._config = config;
    if (this.isConnected) this._rebuild();
  }

  set hass(_) {} // required by HA but unused — we talk directly to our server

  getCardSize() {
    return Math.ceil((this._tiles?.length || 1) / (this._config?.columns || 2)) * 3;
  }

  // ---- DOM -----------------------------------------------------------------

  connectedCallback() {
    if (!this._shadow) {
      this._shadow = this.attachShadow({ mode: "open" });
    }
    if (this._config) this._rebuild();
  }

  disconnectedCallback() {
    this._stopAll();
  }

  // ---- build / update ------------------------------------------------------

  async _rebuild() {
    this._stopAll();
    const cfg = this._config;
    const cols = cfg.columns || 2;

    this._shadow.innerHTML = `
      <style>
        :host { display:block }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.15));
          overflow: hidden;
          font-family: var(--paper-font-body1_-_font-family, sans-serif);
        }
        .card-header {
          padding: 1rem 1.25rem .5rem;
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--primary-text-color);
          display: flex;
          align-items: center;
          gap: .5rem;
        }
        .card-header svg { width:1.25rem; height:1.25rem; fill:var(--primary-color,#03a9f4) }
        .grid {
          display: grid;
          grid-template-columns: repeat(${cols}, 1fr);
          gap: 2px;
          padding: .75rem;
          gap: .75rem;
        }
        .tile {
          background: #000;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
        }
        .tile-header {
          position: absolute;
          top: 0; left: 0; right: 0;
          z-index: 10;
          padding: .35rem .6rem;
          background: linear-gradient(to bottom, rgba(0,0,0,.7) 0%, transparent 100%);
          display: flex;
          align-items: center;
          gap: .4rem;
        }
        .tile-name {
          font-size: .78rem;
          font-weight: 600;
          color: #fff;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tile-cat {
          font-size: .68rem;
          color: rgba(255,255,255,.6);
          background: rgba(255,255,255,.15);
          padding: .1rem .4rem;
          border-radius: 1rem;
        }
        .dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .dot.on      { background: #4caf50; box-shadow: 0 0 5px #4caf50 }
        .dot.off     { background: #666 }
        .dot.loading { background: #ff9800; animation: pulse .8s infinite alternate }
        @keyframes pulse { from { opacity:.4 } to { opacity:1 } }
        .tile-player {
          position: relative;
          aspect-ratio: 16/9;
          background: #0a0a0a;
        }
        .mjpeg-img, .hls-video {
          width: 100%; height: 100%;
          object-fit: contain;
          display: block;
        }
        .tile-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,.4);
        }
        .spinner {
          width: 32px; height: 32px;
          border: 3px solid rgba(255,255,255,.2);
          border-top-color: var(--primary-color, #03a9f4);
          border-radius: 50%;
          animation: spin .8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg) } }
        .tile-error {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: .4rem;
          color: rgba(255,255,255,.5);
          font-size: .75rem;
          background: #0a0a0a;
        }
        .tile-error svg {
          width: 2rem; height: 2rem;
          fill: rgba(255,255,255,.3);
        }
        .loading-state {
          padding: 2rem;
          text-align: center;
          color: var(--secondary-text-color);
          font-size: .9rem;
        }
        .error-state {
          padding: 2rem;
          text-align: center;
          color: var(--error-color, #f44336);
          font-size: .9rem;
        }
      </style>
      <ha-card class="card">
        ${cfg.title ? `<div class="card-header">
          <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
          ${cfg.title}
        </div>` : ""}
        <div class="grid" id="grid">
          <div class="loading-state">Loading devices…</div>
        </div>
      </ha-card>
    `;

    this._grid = this._shadow.getElementById("grid");
    this._tiles = [];
    await this._loadDevices();
  }

  async _loadDevices() {
    const cfg = this._config;
    let devices;
    try {
      const res = await fetch(`${cfg.server_url.replace(/\/$/, "")}/api/devices`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "failed");
      devices = data.devices || [];
    } catch (err) {
      this._grid.innerHTML = `<div class="error-state">Could not reach tuya-node-app server.<br/><small>${err.message}</small></div>`;
      // Retry in 15 s
      setTimeout(() => { if (this.isConnected) this._loadDevices(); }, 15000);
      return;
    }

    // Optional allowlist
    if (cfg.device_ids?.length) {
      devices = devices.filter(d => cfg.device_ids.includes(d.id));
    }

    // Keep only camera-type devices (Tuya category "sp", "dghsxj", etc.)
    const CAMERA_CATEGORIES = ["sp", "dghsxj", "sgbj", "jtmspbj", "wsdcg"];
    const cameras = devices.filter(d =>
      CAMERA_CATEGORIES.includes(d.category) ||
      (d.name || "").toLowerCase().includes("cam") ||
      (d.name || "").toLowerCase().includes("camera") ||
      (d.name || "").toLowerCase().includes("eye")
    );

    if (cameras.length === 0) {
      this._grid.innerHTML = `<div class="loading-state">No camera devices found.<br/><small>Check your Tuya account has cameras, or add device_ids in the card config.</small></div>`;
      return;
    }

    this._grid.innerHTML = "";
    this._tiles = cameras.map(device => {
      const tile = new TuyaCameraTile(device, cfg.server_url, cfg.stream_method || "mjpeg");
      this._grid.appendChild(tile.root);
      tile.start();
      return tile;
    });
  }

  _stopAll() {
    (this._tiles || []).forEach(t => t.stop());
    this._tiles = [];
  }
}

customElements.define("tuya-camera-card", TuyaCameraCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tuya-camera-card",
  name: "Tuya Camera Card",
  description: "Live camera grid powered by tuya-node-app",
  preview: false,
  documentationURL: "https://github.com/YOUR_USER/tuya-node-app",
});
