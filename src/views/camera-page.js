export function renderCameraPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tuya Camera Stream</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #1a1a1a;
        color: #fff;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1.5rem 2rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      header h1 {
        font-size: 1.5rem;
        font-weight: 600;
      }

      header p {
        font-size: 0.9rem;
        opacity: 0.9;
        margin-top: 0.25rem;
      }

      main {
        flex: 1;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .container {
        width: 100%;
        max-width: 1200px;
      }

      .controls {
        margin-bottom: 2rem;
        display: grid;
        gap: 1rem;
      }

      .controls-row {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: flex-end;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .form-group label {
        font-size: 0.9rem;
        font-weight: 500;
        color: #aaa;
      }

      .device-select,
      .stream-type-select {
        padding: 0.6rem 1rem;
        border: 1px solid #444;
        border-radius: 0.5rem;
        background: #2a2a2a;
        color: #fff;
        font-size: 1rem;
        cursor: pointer;
        min-width: 250px;
      }

      .device-select:focus,
      .stream-type-select:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      }

      button {
        padding: 0.6rem 1.5rem;
        border: none;
        border-radius: 0.5rem;
        background: #667eea;
        color: #fff;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.3s ease;
        height: fit-content;
      }

      button:hover {
        background: #764ba2;
      }

      button:disabled {
        background: #444;
        cursor: not-allowed;
        opacity: 0.5;
      }

      .stream-container {
        background: #0a0a0a;
        border-radius: 0.75rem;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        margin-bottom: 2rem;
      }

      .stream-player {
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }

      video {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .loading {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #444;
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .status {
        padding: 1rem;
        border-radius: 0.5rem;
        margin-bottom: 1rem;
        font-size: 0.9rem;
      }

      .status.success {
        background: #1a4d2e;
        color: #90ee90;
      }

      .status.error {
        background: #4d1a1a;
        color: #ff6b6b;
      }

      .status.info {
        background: #1a3a4d;
        color: #87ceeb;
      }

      .info-panel {
        background: #2a2a2a;
        border-radius: 0.5rem;
        padding: 1.5rem;
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        border-bottom: 1px solid #444;
      }

      .info-row:last-child {
        border-bottom: none;
      }

      .info-label {
        font-weight: 500;
        color: #aaa;
      }

      .info-value {
        font-family: monospace;
        word-break: break-all;
        max-width: 60%;
        text-align: right;
      }

      .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        color: #aaa;
      }

      .empty-state svg {
        width: 100px;
        height: 100px;
        margin-bottom: 1rem;
        opacity: 0.3;
      }

      .method-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 1rem;
        font-size: 0.85rem;
        font-weight: 600;
        background: #444;
        color: #fff;
      }

      .method-badge.hls {
        background: #1a4d2e;
        color: #90ee90;
      }

      .method-badge.rtsp {
        background: #4d3a1a;
        color: #ffa500;
      }

      .latency-info {
        font-size: 0.85rem;
        color: #aaa;
        margin-top: 0.5rem;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>📹 Camera Stream</h1>
      <p>View Tuya camera streams with RTSP (direct) or HLS (proxied) support</p>
    </header>

    <main>
      <div class="container">
        <div class="controls">
          <div class="controls-row">
            <div class="form-group" style="flex: 1; min-width: 250px;">
              <label for="deviceSelect">Camera Device</label>
              <select id="deviceSelect" class="device-select">
                <option value="">Select a camera device...</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1; min-width: 250px;">
              <label for="streamType">Stream Method</label>
              <select id="streamType" class="stream-type-select">
                <option value="rtsp">RTSP via MJPEG (Proxied — near real-time)</option>
                <option value="hls">HLS (HA-style stream pipeline)</option>
              </select>
            </div>
          </div>
          <div class="controls-row">
            <button id="loadStreamBtn" disabled>Start Stream</button>
            <button id="stopStreamBtn" disabled>Stop Stream</button>
          </div>
        </div>

        <div id="statusArea"></div>

        <div class="stream-container" id="streamContainer" style="display: none;">
          <div class="stream-player">
            <video id="videoPlayer" controls playsinline muted style="display:none;width:100%;height:100%;object-fit:contain;"></video>
            <img id="mjpegPlayer" alt="RTSP stream" style="display:none;width:100%;height:100%;object-fit:contain;" />
            <div class="loading" id="loadingIndicator" style="display: none;">
              <div class="spinner"></div>
              <p>Loading stream...</p>
            </div>
          </div>
        </div>

        <div class="info-panel" id="infoPanel" style="display: none;">
          <h3>Stream Information</h3>
          <div class="info-row">
            <span class="info-label">Device ID:</span>
            <span class="info-value" id="deviceId"></span>
          </div>
          <div class="info-row">
            <span class="info-label">Device Name:</span>
            <span class="info-value" id="deviceName"></span>
          </div>
          <div class="info-row">
            <span class="info-label">Stream Method:</span>
            <span class="info-value">
              <span class="method-badge" id="methodBadge"></span>
            </span>
          </div>
          <div class="info-row">
            <span class="info-label">Source URL:</span>
            <span class="info-value" id="streamUrl" style="font-size: 0.8rem;"></span>
          </div>
          <div class="info-row">
            <span class="info-label">Status:</span>
            <span class="info-value" id="streamStatus">Disconnected</span>
          </div>
          <div class="latency-info">
            <strong>Note:</strong> RTSP/MJPEG is the lowest-latency option here. HLS follows the Home Assistant-style stream pipeline and is usually a bit behind live.
          </div>
        </div>

        <div class="empty-state" id="emptyState" style="display: none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          <p>No camera devices available or no stream loaded</p>
        </div>
      </div>
    </main>

    <script>
      let devices = [];
      let currentStreamUrl = null;
      let hlsInstance = null;
      let currentStreamType = "rtsp";
      let currentDeviceId = null;
      let autoReconnect = false;
      let reconnectTimer = null;
      let hlsStallTimer = null;
      let mjpegWatchdogTimer = null;

      const deviceSelect = document.getElementById('deviceSelect');
      const streamTypeSelect = document.getElementById('streamType');
      const loadStreamBtn = document.getElementById('loadStreamBtn');
      const stopStreamBtn = document.getElementById('stopStreamBtn');
      const statusArea = document.getElementById('statusArea');
      const streamContainer = document.getElementById('streamContainer');
      const videoPlayer = document.getElementById('videoPlayer');
      const mjpegPlayer = document.getElementById('mjpegPlayer');
      const loadingIndicator = document.getElementById('loadingIndicator');
      const infoPanel = document.getElementById('infoPanel');
      const emptyState = document.getElementById('emptyState');

      function showStatus(message, type = 'info') {
        const status = document.createElement('div');
        status.className = \`status \${type}\`;
        status.textContent = message;
        statusArea.innerHTML = '';
        statusArea.appendChild(status);
      }

      function scheduleReconnect(delay = 4000) {
        if (!autoReconnect || !currentDeviceId) return;
        clearTimeout(reconnectTimer);
        clearInterval(mjpegWatchdogTimer);
        clearInterval(hlsStallTimer);
        showStatus('Stream lost \u2014 reconnecting...', 'info');
        reconnectTimer = setTimeout(async () => {
          if (!currentDeviceId || !autoReconnect) return;
          await loadStreamWithMethod(currentDeviceId, currentStreamType);
        }, delay);
      }

      async function loadDevices() {
        try {
          showStatus('Loading devices...', 'info');
          const response = await fetch('/api/devices');
          const data = await response.json();
          
          if (data.success && data.devices) {
            devices = data.devices;
            populateDeviceSelect();
            showStatus('Devices loaded successfully', 'success');
          } else {
            showStatus('Failed to load devices', 'error');
            emptyState.style.display = 'block';
          }
        } catch (error) {
          showStatus(\`Error: \${error.message}\`, 'error');
          emptyState.style.display = 'block';
        }
      }

      function populateDeviceSelect() {
        deviceSelect.innerHTML = '<option value="">Select a camera device...</option>';
        devices.forEach(device => {
          const option = document.createElement('option');
          option.value = device.id;
          option.textContent = \`\${device.name || 'Unknown'} (\${device.category})\`;
          deviceSelect.appendChild(option);
        });
      }

      deviceSelect.addEventListener('change', () => {
        loadStreamBtn.disabled = !deviceSelect.value;
      });

      streamTypeSelect.addEventListener('change', () => {
        currentStreamType = streamTypeSelect.value;
        // If a stream is playing, show a message about needing to restart
        if (currentStreamUrl) {
          showStatus(\`Switch to \${currentStreamType.toUpperCase()} method - stop and start stream to apply\`, 'info');
        }
      });

      async function loadStreamWithMethod(deviceId, method) {
        const selectedDevice = devices.find(d => d.id === deviceId);
        if (method === 'rtsp') {
          await loadMjpegStream(deviceId, selectedDevice);
        } else {
          await loadHlsStream(deviceId, selectedDevice);
        }
      }

      async function loadMjpegStream(deviceId, selectedDevice) {
        try {
          clearInterval(mjpegWatchdogTimer);
          mjpegPlayer.onload = null;
          mjpegPlayer.onerror = null;
          mjpegPlayer.src = ''; // close any prior connection before reassigning
          loadingIndicator.style.display = 'flex';
          showStatus('Starting RTSP stream (MJPEG)...', 'info');

          const mjpegUrl = '/api/streams/' + deviceId + '/mjpeg?t=' + Date.now();
          currentStreamUrl = mjpegUrl;
          currentDeviceId = deviceId;

          updateStreamInfo(deviceId, selectedDevice, 'rtsp', mjpegUrl);

          // Use <img> for MJPEG — browser streams it natively
          videoPlayer.style.display = 'none';
          mjpegPlayer.style.display = 'block';
          mjpegPlayer.src = mjpegUrl;

          mjpegPlayer.onload = () => {
            loadingIndicator.style.display = 'none';
            startMjpegWatchdog();
          };
          // onerror fires when the server closes the connection with an HTTP error;
          // for clean EOF (last frame frozen) we rely on the canvas watchdog above.
          mjpegPlayer.onerror = () => scheduleReconnect();
          // Give it a moment to start — if still loading, hide spinner after 5s
          setTimeout(() => { loadingIndicator.style.display = 'none'; }, 5000);

          showStreamUI();
          showStatus('RTSP stream loaded successfully', 'success');
        } catch (error) {
          loadingIndicator.style.display = 'none';
          showStatus(\`Error: \${error.message}\`, 'error');
          emptyState.style.display = 'block';
        }
      }

      async function loadHlsStream(deviceId, selectedDevice) {
        try {
          loadingIndicator.style.display = 'flex';
          showStatus('Starting HLS proxy...', 'info');

          // Start the HLS stream (server fetches fresh RTSP URL and transcodes)
          const startResponse = await fetch(\`/api/streams/\${deviceId}/start\`, {
            method: 'POST'
          });
          const startData = await startResponse.json();

          if (!startData.success) {
            throw new Error(startData.error || 'Failed to start HLS stream');
          }

          // Add timestamp to bust browser cache on the playlist
          const playlistUrl = startData.playlistUrl + \`?t=\${Date.now()}\`;
          currentStreamUrl = playlistUrl;
          currentDeviceId = deviceId;

          updateStreamInfo(deviceId, selectedDevice, 'hls', startData.playlistUrl);

          mjpegPlayer.style.display = 'none';
          videoPlayer.style.display = 'block';

          // Set up HLS.js
          if (Hls.isSupported()) {
            if (hlsInstance) {
              hlsInstance.destroy();
            }

            hlsInstance = new Hls({
              enableWorker: true,
              liveSyncDurationCount: 2,
              liveMaxLatencyDurationCount: 4,
              lowLatencyMode: true,
              backBufferLength: 0,
            });

            hlsInstance.attachMedia(videoPlayer);
            hlsInstance.loadSource(playlistUrl);

            hlsInstance.on(Hls.Events.ERROR, (event, data) => {
              if (data.fatal) {
                loadingIndicator.style.display = 'none';
                scheduleReconnect();
              }
            });

            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
              videoPlayer.play().catch(() => {});
              loadingIndicator.style.display = 'none';
              startHlsStallWatcher();
            });
          } else {
            // Fallback for native HLS support (Safari)
            videoPlayer.src = playlistUrl;
            videoPlayer.load();
            loadingIndicator.style.display = 'none';
          }

          showStreamUI();
          showStatus('HLS stream loaded successfully', 'success');

        } catch (error) {
          loadingIndicator.style.display = 'none';
          showStatus(\`Error: \${error.message}\`, 'error');
          emptyState.style.display = 'block';
        }
      }

      function startMjpegWatchdog() {
        clearInterval(mjpegWatchdogTimer);
        // Sample a tiny region of the image every 3 s.
        // If pixels don't change for 3 consecutive checks (~9 s) the frame is frozen.
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        let lastPixels = null;
        let frozenCount = 0;
        mjpegWatchdogTimer = setInterval(() => {
          if (!autoReconnect) { clearInterval(mjpegWatchdogTimer); return; }
          try {
            ctx.drawImage(mjpegPlayer, 0, 0, 8, 8);
            const pixels = ctx.getImageData(0, 0, 8, 8).data.join(',');
            if (lastPixels !== null && pixels === lastPixels) {
              frozenCount++;
              if (frozenCount >= 3) {
                clearInterval(mjpegWatchdogTimer);
                scheduleReconnect(1000);
              }
            } else {
              frozenCount = 0;
            }
            lastPixels = pixels;
          } catch (_) {}
        }, 3000);
      }

      function startHlsStallWatcher() {
        clearInterval(hlsStallTimer);
        let lastTime = -1;
        let sameCount = 0;
        hlsStallTimer = setInterval(() => {
          if (!autoReconnect) { clearInterval(hlsStallTimer); return; }
          const t = videoPlayer.currentTime;
          if (!videoPlayer.paused && t === lastTime) {
            sameCount++;
            if (sameCount >= 2) { // ~12 s of no progress
              clearInterval(hlsStallTimer);
              scheduleReconnect();
            }
          } else {
            sameCount = 0;
          }
          lastTime = t;
        }, 6000);
      }

      function updateStreamInfo(deviceId, device, method, url) {
        document.getElementById('deviceId').textContent = deviceId;
        document.getElementById('deviceName').textContent = device?.name || 'Unknown';
        document.getElementById('methodBadge').textContent = method === 'rtsp' ? 'RTSP/MJPEG' : 'HLS';
        document.getElementById('methodBadge').className = \`method-badge \${method}\`;
        
        // Truncate URL for display
        const displayUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
        document.getElementById('streamUrl').textContent = displayUrl;
        document.getElementById('streamStatus').textContent = 'Connected';
      }

      function showStreamUI() {
        streamContainer.style.display = 'block';
        infoPanel.style.display = 'block';
        emptyState.style.display = 'none';
        loadStreamBtn.disabled = true;
        stopStreamBtn.disabled = false;
      }

      loadStreamBtn.addEventListener('click', async () => {
        const deviceId = deviceSelect.value;
        if (!deviceId) {
          showStatus('Please select a device', 'error');
          return;
        }

        autoReconnect = true;

        currentStreamType = streamTypeSelect.value;
        const selectedDevice = devices.find(d => d.id === deviceId);
        await loadStreamWithMethod(deviceId, currentStreamType);
      });

      stopStreamBtn.addEventListener('click', async () => {
        autoReconnect = false;
        clearTimeout(reconnectTimer);
        clearInterval(hlsStallTimer);
        clearInterval(mjpegWatchdogTimer);
        // Stop HLS stream server-side if running
        if (currentDeviceId && currentStreamType === 'hls') {
          try {
            await fetch(\`/api/streams/\${currentDeviceId}/stop\`, { method: 'POST' });
          } catch (error) {
            console.error('Error stopping HLS stream:', error);
          }
        }

        // Clean up HLS instance
        if (hlsInstance) {
          hlsInstance.destroy();
          hlsInstance = null;
        }

        // Stop MJPEG by clearing the src (closes the HTTP connection)
        mjpegPlayer.src = '';
        mjpegPlayer.style.display = 'none';

        videoPlayer.src = '';
        videoPlayer.load();
        videoPlayer.style.display = 'none';

        streamContainer.style.display = 'none';
        infoPanel.style.display = 'none';
        emptyState.style.display = 'block';
        loadStreamBtn.disabled = !deviceSelect.value;
        stopStreamBtn.disabled = true;
        currentStreamUrl = null;
        currentDeviceId = null;
        showStatus('Stream stopped', 'info');
      });

      // Load devices on page load, then auto-select from URL param
      async function init() {
        await loadDevices();
        const params = new URLSearchParams(window.location.search);
        const deviceId = params.get('deviceId');
        if (deviceId) {
          deviceSelect.value = deviceId;
          if (deviceSelect.value === deviceId) {
            loadStreamBtn.disabled = false;
          }
        }
      }
      init();

      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        if (hlsInstance) {
          hlsInstance.destroy();
        }
      });
    </script>
  </body>
</html>
`;
}
