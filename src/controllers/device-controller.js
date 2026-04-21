import { createPersistentManager, listDevices, sendDeviceCommands } from "../services/tuya-service.js";
import { renderDevicesPage } from "../views/devices-page.js";

function sendError(response, status, error, extra = {}) {
  response.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export function createDeviceController(appState) {
  return {
    renderPage(_request, response) {
      response.type("html").send(renderDevicesPage());
    },

    async list(request, response) {
      const configPath = request.body?.config;
      const session = request.body?.session ?? appState.getSession();
      if (!configPath && !session) {
        sendError(response, 400, "Missing active session or config");
        return;
      }

      try {
        const devices = await listDevices({ configPath, session });
        if (session) {
          appState.setLatestSetup({
            ...appState.getLatestSetup(),
            session,
            devices,
          });
        }
        response.json({ success: true, devices });
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    async getCurrent(request, response) {
      const session = appState.getSession();
      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      if (request.query.refresh === "1") {
        try {
          const manager = await createPersistentManager(appState.getSessionPath(), session);
          await manager.updateDeviceCache();
          const devices = [...manager.deviceMap.values()];
          appState.setLatestSetup({
            ...appState.getLatestSetup(),
            session,
            devices,
          });
        } catch (error) {
          sendError(response, 500, error);
          return;
        }
      }

      response.json({
        success: true,
        devices: appState.getDevices(),
      });
    },

    async sendCommands(request, response) {
      const session = appState.getSession();
      const deviceId = request.params.deviceId;
      const commands = request.body?.commands;

      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      if (!deviceId || !Array.isArray(commands) || commands.length === 0) {
        sendError(response, 400, "Missing required deviceId or commands");
        return;
      }

      try {
        const { result, devices } = await sendDeviceCommands(
          session,
          deviceId,
          commands,
          appState.getSessionPath(),
        );
        appState.setLatestSetup({
          ...appState.getLatestSetup(),
          session,
          devices,
        });
        response.json({
          success: true,
          result,
          devices,
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    async getStreamUrl(request, response) {
      const session = appState.getSession();
      const deviceId = request.params.deviceId;

      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      if (!deviceId) {
        sendError(response, 400, "Missing required deviceId");
        return;
      }

      try {
        const manager = await createPersistentManager(appState.getSessionPath(), session);
        const streamUrl = await manager.getDeviceStreamUrl(deviceId);
        
        if (!streamUrl) {
          sendError(response, 404, "No stream available for this device");
          return;
        }

        response.json({
          success: true,
          streamUrl,
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },
  };
}
