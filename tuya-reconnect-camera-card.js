class TuyaReconnectCameraCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:tuya-reconnect-camera-card",
      entity: "camera.cateye",
      title: "Tuya Camera",
      fit_mode: "cover",
      refresh_seconds: 6,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("entity is required");
    }

    this._config = {
      fit_mode: "cover",
      refresh_seconds: 6,
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
    if (!available) {
      this._setState("offline", "offline");
      this._stop();
      return;
    }

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
        .status.loading { border: 1px solid #f5a524; }
        .status.offline { border: 1px solid #e5484d; }
      </style>
      <div class="wrap">
        <div class="title"></div>
        <img alt="camera" />
        <div class="status loading">connecting</div>
      </div>
    `;

    this._titleEl = this._card.querySelector(".title");
    this._img = this._card.querySelector("img");
    this._statusEl = this._card.querySelector(".status");

    this._img.addEventListener("load", () => {
      this._setState("live", "live");
    });

    this._img.addEventListener("error", () => {
      this._setState("loading", "retrying");
    });

    this.appendChild(this._card);
  }

  _restart() {
    this._stop();
    if (!this._connected || !this._hass || !this._config) {
      return;
    }

    this._running = true;
    this._setState("loading", "connecting");
    this._loadSnapshot();

    const interval = Math.max(1, this._config.refresh_seconds) * 1000;
    this._refreshTimer = setInterval(() => {
      if (!this._running) {
        return;
      }
      this._loadSnapshot();
    }, interval);
  }

  _stop() {
    this._running = false;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
    if (this._img) {
      this._img.removeAttribute("src");
    }
  }

  _buildSnapshotUrl() {
    const state = this._hass.states[this._config.entity];
    if (!state) {
      return null;
    }

    const token = state.attributes && state.attributes.access_token;
    // Use /api/camera_proxy (single JPEG snapshot) — works like picture-glance.
    // Relative path ensures it works both locally and via HA Cloud / reverse proxy.
    const path = "/api/camera_proxy/" + this._config.entity;
    const ts = Date.now();
    if (!token) {
      return path + "?ts=" + ts;
    }
    return (
      path +
      "?token=" + encodeURIComponent(token) +
      "&ts=" + ts
    );
  }

  _loadSnapshot() {
    if (!this._running) {
      return;
    }

    const url = this._buildSnapshotUrl();
    if (!url) {
      return;
    }

    this._img.src = url;
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
  description: "Snapshot-based live camera card — refreshes every N seconds like picture-glance",
  preview: true,
});
