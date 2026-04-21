export function renderSetupPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tuya Setup</title>
    <style>
      :root {
        --bg: #f4f7fb;
        --card: #ffffff;
        --ink: #18212f;
        --muted: #5d6c81;
        --line: #cdd8e5;
        --accent: #152033;
        --accent-2: #0f6dff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, #e6eefc 0, transparent 30%),
          linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
        color: var(--ink);
        min-height: 100vh;
      }
      main {
        width: min(980px, calc(100vw - 32px));
        margin: 32px auto;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(205,216,229,0.7);
        border-radius: 24px;
        box-shadow: 0 22px 60px rgba(18, 28, 45, 0.08);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 4vw, 44px);
      }
      p { color: var(--muted); }
      form, .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      input, button, textarea, select {
        font: inherit;
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 12px 14px;
      }
      input {
        flex: 1 1 280px;
        min-width: 220px;
      }
      button, .link-button {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .link-button.secondary, button.secondary {
        background: #fff;
        color: var(--ink);
      }
      .panel {
        margin-top: 22px;
        background: #f8fbff;
        border: 1px solid #e2eaf4;
        border-radius: 18px;
        padding: 18px;
      }
      .qr {
        background: #fff;
        border-radius: 16px;
        padding: 14px;
        max-width: 420px;
      }
      pre, code {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Tuya QR Setup</h1>
      <p>Enter the User Code from Tuya Smart or Smart Life under Settings > Account and Security, then scan the QR code and continue on the same page.</p>
      <form id="setup-form">
        <input id="user_code" name="user_code" placeholder="User Code from the Tuya app" required>
        <button type="submit">Generate QR Code</button>
      </form>
      <div id="result"></div>
    </main>
    <script>
      const form = document.getElementById("setup-form");
      const result = document.getElementById("result");
      let pendingSetup = null;

      function renderError(title, payload) {
        result.innerHTML = '<div class="panel"><strong>' + title + '</strong><pre>' +
          JSON.stringify(payload, null, 2) +
          '</pre></div>';
      }

      async function completeLogin() {
        if (!pendingSetup) {
          return;
        }

        result.innerHTML = '<div class="panel">Checking login result and fetching devices...</div>';

        const response = await fetch("/setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_code: pendingSetup.userCode,
            token: pendingSetup.token,
            save: "./tuya-session.json",
          }),
        });
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          renderError("Setup failed", payload);
          return;
        }

        result.innerHTML =
          '<div class="panel">' +
          '<p><strong>Login complete</strong></p>' +
          '<p>Fetched ' + payload.devices.length + ' device(s).</p>' +
          '<div class="actions">' +
          '<a class="link-button" href="/devices">Open Devices Page</a>' +
          '<button class="secondary" id="toggle-debug" type="button">Toggle Debug</button>' +
          '</div>' +
          '<div id="debug-block" style="display:none;margin-top:16px;"><pre>' +
          JSON.stringify(payload.debug, null, 2) +
          '</pre></div>' +
          '</div>';

        document.getElementById("toggle-debug").addEventListener("click", () => {
          const block = document.getElementById("debug-block");
          block.style.display = block.style.display === "none" ? "block" : "none";
        });
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.innerHTML = '<div class="panel">Generating QR code...</div>';

        try {
          const userCode = document.getElementById("user_code").value.trim();
          const response = await fetch("/setup/qr-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_code: userCode }),
          });
          const payload = await response.json();

          if (!response.ok || !payload.success) {
            renderError("Request failed", payload);
            return;
          }

          pendingSetup = { userCode, token: payload.token };
          result.innerHTML =
            '<div class="panel">' +
            '<p><strong>Token</strong></p>' +
            '<code>' + payload.token + '</code>' +
            '<p><strong>QR code</strong></p>' +
            '<div class="qr">' + payload.qr_code_svg + '</div>' +
            '<p><strong>Deep link</strong></p>' +
            '<code>' + payload.qr_code_url + '</code>' +
            '<div class="actions">' +
            '<button id="complete-login" type="button">I Scanned It, Fetch Devices</button>' +
            '</div>' +
            '</div>';

          document.getElementById("complete-login").addEventListener("click", async () => {
            try {
              await completeLogin();
            } catch (error) {
              renderError("Request failed", { error: String(error) });
            }
          });
        } catch (error) {
          renderError("Request failed", { error: String(error) });
        }
      });

      async function loadCurrentSession() {
        try {
          const response = await fetch("/api/session/current");
          if (!response.ok) {
            return;
          }

          const payload = await response.json();
          if (!payload.success || !payload.has_session) {
            return;
          }

          result.innerHTML =
            '<div class="panel">' +
            '<p><strong>Saved session loaded</strong></p>' +
            '<p>Signed in as ' + payload.username + ' with ' + payload.devices_count + ' cached device(s).</p>' +
            '<div class="actions">' +
            '<a class="link-button" href="/devices">Open Devices Page</a>' +
            '<button class="secondary" id="show-session" type="button">Show Session Summary</button>' +
            '</div>' +
            '<div id="session-summary" style="display:none;margin-top:16px;"><pre>' +
            JSON.stringify(payload.session, null, 2) +
            '</pre></div>' +
            '</div>';

          document.getElementById("show-session").addEventListener("click", () => {
            const block = document.getElementById("session-summary");
            block.style.display = block.style.display === "none" ? "block" : "none";
          });
        } catch {
          // Ignore missing session and keep QR setup available.
        }
      }

      loadCurrentSession();
    </script>
  </body>
</html>`;
}
