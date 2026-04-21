import express from "express";

import { createDeviceController } from "./controllers/device-controller.js";
import { createSetupController } from "./controllers/setup-controller.js";
import { createStreamController } from "./controllers/stream-controller.js";
import { AppState } from "./models/app-state.js";
import { normalizeSavePath, restorePersistedSetup } from "./services/tuya-service.js";
import { renderCameraPage } from "./views/camera-page.js";

export async function createApp() {
  const app = express();
  const appState = new AppState(normalizeSavePath(null));
  const setupController = createSetupController(appState);
  const deviceController = createDeviceController(appState);
  const streamController = createStreamController(appState);

  const restored = await restorePersistedSetup(appState.getSessionPath());
  if (restored.ok) {
    appState.setLatestSetup(restored.setup);
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (request, response) => setupController.renderPage(request, response));
  app.get("/health", (request, response) => setupController.health(request, response));
  app.get("/api/session/current", (request, response) =>
    setupController.currentSession(request, response),
  );
  app.get("/debug/session", (request, response) =>
    setupController.debugSession(request, response),
  );
  app.post("/setup/qr-code", (request, response) =>
    setupController.createQrCode(request, response),
  );
  app.post("/setup/login-result", (request, response) =>
    setupController.loginResult(request, response),
  );
  app.post("/setup/complete", (request, response) =>
    setupController.complete(request, response),
  );

  app.get("/devices", (request, response) => deviceController.renderPage(request, response));
  app.get("/camera", (request, response) => response.type("html").send(renderCameraPage()));
  app.get("/api/devices", (request, response) => deviceController.getCurrent(request, response));
  app.post("/devices/list", (request, response) => deviceController.list(request, response));
  app.post("/api/devices/:deviceId/commands", (request, response) =>
    deviceController.sendCommands(request, response),
  );
  app.get("/api/devices/:deviceId/stream-url", (request, response) =>
    deviceController.getStreamUrl(request, response),
  );

  // HLS streaming routes
  app.post("/api/streams/:deviceId/start", (request, response) =>
    streamController.startHlsStream(request, response),
  );
  app.get("/api/streams/:deviceId/playlist.m3u8", (request, response) =>
    streamController.getPlaylist(request, response),
  );
  app.get("/api/streams/:deviceId/segment-:segmentName", (request, response) =>
    streamController.getSegment(request, response),
  );
  app.post("/api/streams/:deviceId/stop", (request, response) =>
    streamController.stopStream(request, response),
  );
  app.get("/api/streams/:deviceId/status", (request, response) =>
    streamController.getStreamStatus(request, response),
  );
  app.get("/api/streams/:deviceId/mjpeg", (request, response) =>
    streamController.mjpegStream(request, response),
  );

  return app;
}
