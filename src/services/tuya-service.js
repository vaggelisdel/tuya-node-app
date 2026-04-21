import { resolve } from "node:path";

import QRCode from "qrcode";

import { PATHS, TUYA_CLIENT_ID, TUYA_SCHEMA } from "../constants.js";
import { LoginControl } from "../login-control.js";
import { Manager } from "../manager.js";
import { readJsonFile, writeJsonFile } from "../utils.js";

const DEFAULT_SESSION_FILE = resolve("./tuya-session.json");

export function createLoginControl() {
  return new LoginControl({
    clientId: TUYA_CLIENT_ID,
    schema: TUYA_SCHEMA,
  });
}

export function sessionFromLogin(userCode, info) {
  return {
    user_code: userCode,
    terminal_id: info.terminal_id,
    endpoint: info.endpoint,
    token_info: {
      t: info.t,
      uid: info.uid,
      expire_time: info.expire_time,
      access_token: info.access_token,
      refresh_token: info.refresh_token,
    },
  };
}

export function redactToken(token) {
  if (!token) {
    return token;
  }

  if (token.length <= 12) {
    return `${token.slice(0, 4)}...${token.slice(-2)}`;
  }

  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

export function summarizeSession(session) {
  return {
    user_code: session.user_code,
    terminal_id: session.terminal_id,
    endpoint: session.endpoint,
    token_info: {
      t: session.token_info?.t,
      uid: session.token_info?.uid,
      expire_time: session.token_info?.expire_time,
      access_token: redactToken(session.token_info?.access_token),
      refresh_token: redactToken(session.token_info?.refresh_token),
    },
  };
}

export function normalizeSavePath(savePath) {
  return savePath ? resolve(savePath) : DEFAULT_SESSION_FILE;
}

export async function createQrCodePayload(userCode) {
  const login = createLoginControl();
  const payload = await login.qrCode(userCode);
  const token = payload.result?.qrcode;
  const qrCodeUrl = `tuyaSmart--qrLogin?token=${token}`;
  const qrCodeSvg = await QRCode.toString(qrCodeUrl, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 1,
    scale: 5,
  });

  return {
    payload,
    token,
    qrCodeUrl,
    qrCodeSvg,
  };
}

export async function loadManager(configPath) {
  const entryData = await readJsonFile(configPath);
  return Manager.fromEntryData(entryData, {
    async updateToken(tokenInfo) {
      entryData.token_info = tokenInfo;
      await writeJsonFile(configPath, entryData);
    },
  });
}

export async function createPersistentManager(sessionPath, session = null) {
  const entryData = session ?? (await readJsonFile(sessionPath));
  return Manager.fromEntryData(entryData, {
    async updateToken(tokenInfo) {
      entryData.token_info = tokenInfo;
      await writeJsonFile(sessionPath, entryData);
    },
  });
}

export function managerFromEntryData(entryData, requestTracer = null) {
  const manager = Manager.fromEntryData(entryData);
  if (requestTracer) {
    manager.customerApi.requestTracer = requestTracer;
  }
  return manager;
}

export async function debugDeviceFetch(session) {
  const requestTrace = [];
  const manager = managerFromEntryData(session, (event) => {
    requestTrace.push(event);
  });
  const debug = {
    manager_input: summarizeSession(session),
    steps: [],
    request_trace: requestTrace,
  };

  try {
    debug.steps.push({ step: "query_homes", status: "started" });
    const homes = await manager.homeRepository.queryHomes();
    debug.steps[debug.steps.length - 1] = {
      step: "query_homes",
      status: "ok",
      homes_count: homes.length,
      home_ids: homes.map((home) => home.id),
    };

    manager.userHomes = homes;
    manager.deviceMap.clear();

    for (const home of homes) {
      debug.steps.push({
        step: "home_devices_api",
        status: "started",
        home_id: home.id,
        path: PATHS.homeDevices,
      });
      const homeDevicesResponse = await manager.customerApi.get(PATHS.homeDevices, {
        homeId: home.id,
      });
      debug.steps[debug.steps.length - 1] = {
        step: "home_devices_api",
        status: "ok",
        home_id: home.id,
        result_count: (homeDevicesResponse.result ?? []).length,
      };

      debug.steps.push({
        step: "query_devices_by_home",
        status: "started",
        home_id: home.id,
      });
      const devices = await manager.deviceRepository.queryDevicesByHome(home.id);
      for (const device of devices) {
        manager.deviceMap.set(device.id, device);
      }
      debug.steps[debug.steps.length - 1] = {
        step: "query_devices_by_home",
        status: "ok",
        home_id: home.id,
        devices_count: devices.length,
        device_ids: devices.map((device) => device.id),
      };

      for (const device of devices) {
        debug.steps.push({
          step: "device_specifications",
          status: "started",
          device_id: device.id,
        });
        await manager.customerApi.get(PATHS.deviceSpecifications(device.id));
        debug.steps[debug.steps.length - 1] = {
          step: "device_specifications",
          status: "ok",
          device_id: device.id,
        };

        debug.steps.push({
          step: "device_status_strategy",
          status: "started",
          device_id: device.id,
        });
        await manager.customerApi.get(PATHS.deviceStatusStrategy(device.id));
        debug.steps[debug.steps.length - 1] = {
          step: "device_status_strategy",
          status: "ok",
          device_id: device.id,
        };

        debug.steps.push({
          step: "device_report_types",
          status: "started",
          device_id: device.id,
        });
        await manager.customerApi.get(PATHS.deviceReportTypes(device.id));
        debug.steps[debug.steps.length - 1] = {
          step: "device_report_types",
          status: "ok",
          device_id: device.id,
        };
      }
    }

    return {
      ok: true,
      manager,
      debug,
    };
  } catch (error) {
    debug.steps.push({
      step: "device_fetch_error",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error,
      debug,
    };
  }
}

export async function completeSetup(userCode, token, savePath = null) {
  const login = createLoginControl();
  const [ok, payload] = await login.loginResult(token, userCode);
  if (!ok) {
    return {
      ok: false,
      payload: {
        success: false,
        step: "login_result",
        debug: {
          user_code: userCode,
          token: redactToken(token),
          response: payload,
        },
        ...payload,
      },
    };
  }

  const session = sessionFromLogin(userCode, payload);
  if (savePath) {
    await writeJsonFile(savePath, session);
  }

  const deviceFetch = await debugDeviceFetch(session);
  if (!deviceFetch.ok) {
    return {
      ok: false,
      payload: {
        success: false,
        step: "update_device_cache",
        error:
          deviceFetch.error instanceof Error
            ? deviceFetch.error.message
            : String(deviceFetch.error),
        session: summarizeSession(session),
        debug: {
          login_result: {
            username: payload.username,
            terminal_id: payload.terminal_id,
            endpoint: payload.endpoint,
          },
          device_fetch: deviceFetch.debug,
        },
      },
    };
  }

  const manager = deviceFetch.manager;
  return {
    ok: true,
    payload: {
      username: payload.username,
      session,
      saved_to: savePath,
      devices: [...manager.deviceMap.values()],
      debug: {
        login_result: {
          username: payload.username,
          terminal_id: payload.terminal_id,
          endpoint: payload.endpoint,
        },
        device_fetch: deviceFetch.debug,
      },
    },
  };
}

export async function listDevices({ configPath = null, session = null }) {
  const manager = configPath
    ? await loadManager(configPath)
    : managerFromEntryData(session);
  await manager.updateDeviceCache();
  return [...manager.deviceMap.values()];
}

export async function sendDeviceCommands(session, deviceId, commands, sessionPath = null) {
  const manager = sessionPath
    ? await createPersistentManager(sessionPath, session)
    : managerFromEntryData(session);
  const result = await manager.sendCommands(deviceId, commands);
  await manager.updateDeviceCache();
  return {
    result,
    devices: [...manager.deviceMap.values()],
  };
}

export async function restorePersistedSetup(sessionPath = DEFAULT_SESSION_FILE) {
  try {
    const session = await readJsonFile(sessionPath);
    const manager = await createPersistentManager(sessionPath, session);
    await manager.updateDeviceCache();
    return {
      ok: true,
      setup: {
        username: session.token_info?.uid ?? "Saved Session",
        session,
        devices: [...manager.deviceMap.values()],
        debug: null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}
