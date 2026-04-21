# Tuya Node App

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)

Live Tuya camera grid for your Home Assistant dashboard, powered by a Node.js server that handles RTSP streaming, token refresh and device discovery.

---

## Home Assistant — Lovelace Card (HACS)

### 1. Run the server

The card talks to a **tuya-node-app** server you host on the same network (e.g. on the machine running HA, an add-on, or any always-on device).

```bash
npm install
npm start          # listens on http://0.0.0.0:3000
```

Open `http://<server-ip>:3000` in a browser, scan the QR code with the Tuya / Smart Life app, and complete setup. The session is saved automatically.

### 2. Add via HACS

1. Open HACS → **Frontend** → ⋮ menu → **Custom repositories**
2. Add `https://github.com/YOUR_USER/tuya-node-app` — category **Lovelace**
3. Install **Tuya Camera Card**
4. Hard-refresh the browser (`Ctrl+Shift+R`)

### 3. Add the card to your dashboard

Go to a dashboard → **Edit** → **Add card** → search for **Tuya Camera Card**, or add it manually in YAML:

```yaml
type: custom:tuya-camera-card
server_url: http://192.168.1.100:3000   # IP of the machine running npm start
stream_method: mjpeg                    # mjpeg (default, lowest latency) | hls
columns: 2                              # cameras per row
title: My Cameras                       # optional header
device_ids:                             # optional: restrict to specific cameras
  - bf123abc456
  - bf789def012
```

The card will:
- Fetch all Tuya devices from your server and filter camera-type devices automatically
- Display each camera as a live video tile in a responsive grid
- Reconnect automatically if the stream freezes or the RTSP token expires

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach tuya-node-app server" | Check `server_url`, make sure the server is running and reachable from the HA browser |
| Black tiles / spinner forever | Ensure the camera supports RTSP streaming in the Tuya app |
| Stream freezes after ~2 min | The RTSP token expired and the server is reconnecting — this should self-heal within a few seconds |
| No cameras shown | Add `device_ids` to the card config to force-include specific device IDs |

---

## Node.js server — background

This app ports the Home Assistant Tuya integration's cloud-sharing flow to Node.js.

It mirrors the same major pieces used by Home Assistant:

- `LoginControl`
- `CustomerApi`
- `HomeRepository`
- `DeviceRepository`
- `Manager`
- optional `SharingMq`

The implementation is based on:

- Home Assistant's Tuya integration in this repo
- Tuya's Python `tuya-device-sharing-sdk`
- Tuya's published QR login and cloud command docs

## What matches the Home Assistant flow

- QR-code login against `apigw.iotbing.com`
- config-entry compatible session data:
  - `user_code`
  - `terminal_id`
  - `endpoint`
  - `token_info`
- encrypted/signed API requests used by Tuya's sharing SDK
- device cache loading by home
- command dispatch via `/v1.1/m/thing/{device_id}/commands`
- token refresh
- terminal unload

## What is not fully identical

- Home Assistant entity generation and DP wrappers are not included here.
- MQTT support is optional. Install `mqtt` first if you want realtime updates.

## Session file format

Use a JSON file shaped like Home Assistant's `entry.data`:

```json
{
  "user_code": "30",
  "terminal_id": "xxxx",
  "endpoint": "https://apigw.tuyaeu.com",
  "token_info": {
    "t": 1710000000000,
    "uid": "eu123",
    "expire_time": 7200,
    "access_token": "xxxx",
    "refresh_token": "yyyy"
  }
}
```

## CLI

Generate a QR token:

```bash
node src/cli.js qr-code --user-code 30
```

Check login result and optionally save a session file:

```bash
node src/cli.js login-result --user-code 30 --token TOKEN --save ./tuya-session.json
```

List devices:

```bash
node src/cli.js list-devices --config ./tuya-session.json
```

Send commands:

```bash
node src/cli.js send-commands \
  --config ./tuya-session.json \
  --device-id DEVICE_ID \
  --commands '[{"code":"switch_1","value":true}]'
```

Start realtime MQTT updates:

```bash
npm install
node src/cli.js refresh-mq --config ./tuya-session.json
```

Unload terminal credentials:

```bash
node src/cli.js unload --config ./tuya-session.json
```

## Express Setup Server

Start the HTTP server:

```bash
npm install
npm start
```

Default bind is `http://127.0.0.1:3000`.

The app persists the active Tuya session to `./tuya-session.json` and reloads it on startup. If that session is still valid, opening the app does not require scanning the QR code again.

The server now uses a simple MVC split:

- `models/` for state
- `services/` for Tuya flow and API work
- `controllers/` for request handling
- `views/` for HTML pages

The browser flow now includes step-level debug data for:

- `login_result`
- `query_homes`
- `query_devices_by_home`

After setup succeeds, open the device control page:

```text
http://127.0.0.1:3000/devices
```

From there you can:

- select a fetched device
- inspect its current status
- prepare command JSON
- send commands with the active Tuya session

To inspect the currently loaded saved session:

```bash
curl -s http://127.0.0.1:3000/api/session/current
```

Request a Tuya QR login token:

```bash
curl -s http://127.0.0.1:3000/setup/qr-code \
  -H 'content-type: application/json' \
  -d '{"user_code":"30"}'
```

The response includes:

- `token`
- `qr_code_url` in Home Assistant's format: `tuyaSmart--qrLogin?token=...`
- `qr_code_svg` for direct rendering in a browser or frontend

Open a rendered QR page in the browser:

```bash
open http://127.0.0.1:3000/setup/qr-code/TOKEN
```

Finish login and optionally persist the Home Assistant-shaped session file:

```bash
curl -s http://127.0.0.1:3000/setup/login-result \
  -H 'content-type: application/json' \
  -d '{"user_code":"30","token":"TOKEN","save":"./tuya-session.json"}'
```

Run the Home Assistant-style setup completion in one request:

```bash
curl -s http://127.0.0.1:3000/setup/complete \
  -H 'content-type: application/json' \
  -d '{"user_code":"30","token":"TOKEN","save":"./tuya-session.json"}'
```

This does the same sequence Home Assistant does after QR approval:

- exchange the approved QR token for session credentials
- create a manager with `user_code`, `terminal_id`, `endpoint`, `token_info`
- call `update_device_cache`

If setup fails, the response includes:

- `step`
- `session` summary with redacted tokens
- `debug.login_result`
- `debug.device_fetch.steps`

Inspect the last saved session summary:

```bash
curl -s http://127.0.0.1:3000/debug/session
```
