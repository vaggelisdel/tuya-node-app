import {
  completeSetup,
  createLoginControl,
  createQrCodePayload,
  normalizeSavePath,
  sessionFromLogin,
  summarizeSession,
} from "../services/tuya-service.js";
import { renderSetupPage } from "../views/setup-page.js";

function sendError(response, status, error, extra = {}) {
  response.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export function createSetupController(appState) {
  return {
    renderPage(_request, response) {
      response.type("html").send(renderSetupPage());
    },

    health(_request, response) {
      response.json({ success: true });
    },

    debugSession(_request, response) {
      const session = appState.getSession();
      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      response.json({
        success: true,
        session: summarizeSession(session),
      });
    },

    currentSession(_request, response) {
      const latestSetup = appState.getLatestSetup();
      if (!latestSetup?.session) {
        sendError(response, 404, "No active session");
        return;
      }

      response.json({
        success: true,
        has_session: true,
        username: latestSetup.username,
        session: summarizeSession(latestSetup.session),
        devices_count: latestSetup.devices?.length ?? 0,
      });
    },

    async createQrCode(request, response) {
      const userCode = request.body?.user_code;
      if (!userCode) {
        sendError(response, 400, "Missing required user_code");
        return;
      }

      try {
        const { payload, token, qrCodeUrl, qrCodeSvg } = await createQrCodePayload(userCode);
        if (!payload.success) {
          response.status(400).json(payload);
          return;
        }

        response.json({
          success: true,
          user_code: userCode,
          token,
          qr_code_url: qrCodeUrl,
          qr_code_svg: qrCodeSvg,
          result: payload.result,
          t: payload.t,
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    async loginResult(request, response) {
      const userCode = request.body?.user_code;
      const token = request.body?.token;
      if (!userCode || !token) {
        sendError(response, 400, "Missing required user_code or token");
        return;
      }

      try {
        const login = createLoginControl();
        const [ok, payload] = await login.loginResult(token, userCode);
        if (!ok) {
          response.status(400).json(payload);
          return;
        }

        const session = sessionFromLogin(userCode, payload);
        response.json({
          success: true,
          username: payload.username,
          session,
          saved_to: normalizeSavePath(request.body?.save),
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    async complete(request, response) {
      const userCode = request.body?.user_code;
      const token = request.body?.token;
      if (!userCode || !token) {
        sendError(response, 400, "Missing required user_code or token");
        return;
      }

      try {
        const result = await completeSetup(
          userCode,
          token,
          normalizeSavePath(request.body?.save),
        );
        if (!result.ok) {
          response.status(400).json(result.payload);
          return;
        }

        appState.setLatestSetup({
          username: result.payload.username,
          session: result.payload.session,
          devices: result.payload.devices,
          debug: result.payload.debug,
        });

        response.json({
          success: true,
          ...result.payload,
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },
  };
}
