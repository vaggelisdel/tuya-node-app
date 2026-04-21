export function renderDevicesPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tuya Devices</title>
    <style>
      :root {
        --bg: #f1f5fb;
        --card: #ffffff;
        --ink: #18212f;
        --muted: #607087;
        --line: #d7e1ec;
        --accent: #142035;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top right, #e4edff 0, transparent 28%),
          linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
      }
      main {
        width: min(1200px, calc(100vw - 32px));
        margin: 24px auto;
        display: grid;
        gap: 20px;
      }
      .header, .panel {
        background: rgba(255,255,255,0.94);
        border: 1px solid rgba(215,225,236,0.85);
        border-radius: 22px;
        box-shadow: 0 18px 48px rgba(21, 32, 53, 0.08);
      }
      .header {
        padding: 24px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 20px;
      }
      .panel { padding: 20px; }
      .device-list {
        display: grid;
        gap: 10px;
        max-height: 68vh;
        overflow: auto;
      }
      .device-button {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fff;
        padding: 12px 14px;
        cursor: pointer;
      }
      .device-button.active {
        border-color: #142035;
        background: #eef4ff;
      }
      .meta { color: var(--muted); font-size: 14px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .chip {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fff;
        padding: 14px;
      }
      textarea, button, select {
        font: inherit;
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 12px 14px;
      }
      textarea {
        width: 100%;
        min-height: 180px;
        resize: vertical;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 14px;
      }
      button, .link {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
        cursor: pointer;
        text-decoration: none;
      }
      button.secondary, .link.secondary {
        background: #fff;
        color: var(--ink);
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #0f172a;
        color: #dbeafe;
        border-radius: 16px;
        padding: 16px;
      }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="header">
        <div>
          <h1 style="margin:0 0 8px;">Fetched Devices</h1>
          <div class="meta">Select a device, edit commands, and send them with the current Tuya session.</div>
        </div>
        <div class="actions">
          <a class="link secondary" href="/">Back To Setup</a>
          <a class="link secondary" href="/camera">📹 Camera Stream</a>
          <button id="refresh" class="secondary" type="button">Refresh Devices</button>
        </div>
      </section>
      <section class="layout">
        <aside class="panel">
          <div id="device-list" class="device-list"></div>
        </aside>
        <section class="panel">
          <div id="device-empty" class="meta">Choose a device to inspect and control it.</div>
          <div id="device-view" style="display:none;">
            <div class="grid" id="device-summary"></div>
            <h3>Status</h3>
            <pre id="device-status"></pre>
            <div id="camera-action" style="display:none;margin-bottom:18px;">
              <a id="watch-stream-link" class="link" href="/camera" style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:12px;text-decoration:none;">📹 Watch Live Stream</a>
            </div>
            <h3>Commands</h3>
            <textarea id="commands-editor"></textarea>
            <div class="actions" id="quick-actions"></div>
            <div class="actions">
              <button id="send-commands" type="button">Send Commands</button>
            </div>
            <h3>Result</h3>
            <pre id="command-result">No command sent yet.</pre>
          </div>
        </section>
      </section>
    </main>
    <script>
      let devices = [];
      let selectedDeviceId = null;

      function pretty(value) {
        return JSON.stringify(value, null, 2);
      }

      function getQuickCommands(device) {
        const entries = [];
        for (const [code, value] of Object.entries(device.status || {})) {
          if (typeof value === "boolean") {
            entries.push({
              label: value ? "Turn " + code + " Off" : "Turn " + code + " On",
              commands: [{ code, value: !value }],
            });
          }
        }
        return entries.slice(0, 4);
      }

      function renderDeviceList() {
        const list = document.getElementById("device-list");
        list.innerHTML = "";

        if (devices.length === 0) {
          list.innerHTML = '<div class="meta">No devices loaded yet. Go back to setup and fetch devices first.</div>';
          return;
        }

        for (const device of devices) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "device-button" + (device.id === selectedDeviceId ? " active" : "");
          button.innerHTML =
            '<strong>' + device.name + '</strong><div class="meta">' +
            device.product_name + ' · ' + (device.online ? "online" : "offline") +
            '</div>';
          button.addEventListener("click", () => {
            selectedDeviceId = device.id;
            renderDeviceList();
            renderSelectedDevice();
          });
          list.appendChild(button);
        }
      }

      function renderSelectedDevice() {
        const device = devices.find((entry) => entry.id === selectedDeviceId);
        const empty = document.getElementById("device-empty");
        const view = document.getElementById("device-view");
        if (!device) {
          empty.style.display = "block";
          view.style.display = "none";
          return;
        }

        empty.style.display = "none";
        view.style.display = "block";

        document.getElementById("device-summary").innerHTML = [
          ["Name", device.name],
          ["Product", device.product_name],
          ["Category", device.category],
          ["Online", String(device.online)],
          ["Device ID", device.id],
          ["IP", device.ip || "n/a"],
        ].map(([label, value]) => '<div class="chip"><div class="meta">' + label + '</div><strong>' + value + '</strong></div>').join("");

        document.getElementById("device-status").textContent = pretty(device.status || {});
        document.getElementById("commands-editor").value = pretty(
          Object.entries(device.status || {}).slice(0, 1).map(([code, value]) => ({ code, value }))
        );

        // Show camera stream button for camera-type devices
        const cameraAction = document.getElementById("camera-action");
        const CAMERA_CATEGORIES = ["sp", "dghsxj", "msd"];
        const isCamera = CAMERA_CATEGORIES.includes((device.category || "").toLowerCase()) ||
          /cam|camera|eye/i.test(device.name || "") ||
          /cam|camera|eye/i.test(device.product_name || "");
        if (isCamera) {
          document.getElementById("watch-stream-link").href = "/camera?deviceId=" + encodeURIComponent(device.id);
          cameraAction.style.display = "block";
        } else {
          cameraAction.style.display = "none";
        }

        const quickActions = document.getElementById("quick-actions");
        quickActions.innerHTML = "";
        for (const action of getQuickCommands(device)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = action.label;
          button.addEventListener("click", () => {
            document.getElementById("commands-editor").value = pretty(action.commands);
          });
          quickActions.appendChild(button);
        }
      }

      async function loadDevices(refresh = false) {
        const response = await fetch("/api/devices" + (refresh ? "?refresh=1" : ""));
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          document.getElementById("device-list").innerHTML = '<div class="meta">' + (payload.error || "Failed to load devices") + '</div>';
          return;
        }
        devices = payload.devices;
        if (!selectedDeviceId && devices.length > 0) {
          selectedDeviceId = devices[0].id;
        }
        renderDeviceList();
        renderSelectedDevice();
      }

      async function sendCommands() {
        const editor = document.getElementById("commands-editor");
        const commands = JSON.parse(editor.value);
        const response = await fetch("/api/devices/" + encodeURIComponent(selectedDeviceId) + "/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands }),
        });
        const payload = await response.json();
        document.getElementById("command-result").textContent = pretty(payload);
        if (response.ok && payload.success) {
          devices = payload.devices;
          renderDeviceList();
          renderSelectedDevice();
        }
      }

      document.getElementById("refresh").addEventListener("click", async () => {
        await loadDevices(true);
      });

      document.getElementById("send-commands").addEventListener("click", async () => {
        try {
          await sendCommands();
        } catch (error) {
          document.getElementById("command-result").textContent = pretty({ error: String(error) });
        }
      });

      loadDevices();
    </script>
  </body>
</html>`;
}
