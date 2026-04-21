#!/usr/bin/env node

import { argv, exit } from "node:process";

import { TUYA_CLIENT_ID, TUYA_SCHEMA } from "./constants.js";
import { LoginControl } from "./login-control.js";
import { Manager } from "./manager.js";
import { readJsonFile, writeJsonFile } from "./utils.js";

function parseArgs(input) {
  const args = { _: [] };
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = input[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function required(args, name) {
  const value = args[name];
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function loadManager(configPath) {
  const entryData = await readJsonFile(configPath);
  return Manager.fromEntryData(entryData, {
    async updateToken(tokenInfo) {
      entryData.token_info = tokenInfo;
      await writeJsonFile(configPath, entryData);
    },
  });
}

function sessionFromLogin(userCode, info) {
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

function usage() {
  return `
Commands:
  qr-code --user-code CODE
  login-result --user-code CODE --token TOKEN [--save FILE]
  list-devices --config FILE
  send-commands --config FILE --device-id ID --commands JSON
  refresh-mq --config FILE
  report-version --config FILE --system-version X --plugin-version Y --sdk-version Z
  unload --config FILE
`;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const command = args._[0];

  if (!command) {
    console.error(usage().trim());
    exit(1);
  }

  if (command === "qr-code") {
    const login = new LoginControl({
      clientId: TUYA_CLIENT_ID,
      schema: TUYA_SCHEMA,
    });
    const result = await login.qrCode(required(args, "user-code"));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "login-result") {
    const userCode = required(args, "user-code");
    const login = new LoginControl({
      clientId: TUYA_CLIENT_ID,
      schema: TUYA_SCHEMA,
    });
    const [ok, info] = await login.loginResult(required(args, "token"), userCode);
    const payload = ok ? sessionFromLogin(userCode, info) : info;
    if (ok && args.save) {
      await writeJsonFile(args.save, payload);
    }
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === "list-devices") {
    const manager = await loadManager(required(args, "config"));
    await manager.updateDeviceCache();
    console.log(JSON.stringify([...manager.deviceMap.values()], null, 2));
    return;
  }

  if (command === "send-commands") {
    const manager = await loadManager(required(args, "config"));
    const result = await manager.sendCommands(
      required(args, "device-id"),
      JSON.parse(required(args, "commands")),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "refresh-mq") {
    const manager = await loadManager(required(args, "config"));
    await manager.updateDeviceCache();
    for (const device of manager.deviceMap.values()) {
      device.set_up = true;
    }
    manager.addDeviceListener({
      updateDevice(device, updatedStatusProperties, dpTimestamps) {
        console.log(
          JSON.stringify(
            {
              type: "update_device",
              device_id: device.id,
              updated_status_properties: updatedStatusProperties,
              dp_timestamps: dpTimestamps,
              status: device.status,
              online: device.online,
            },
            null,
            2,
          ),
        );
      },
      addDevice(device) {
        console.log(JSON.stringify({ type: "add_device", device }, null, 2));
      },
      removeDevice(deviceId) {
        console.log(JSON.stringify({ type: "remove_device", device_id: deviceId }, null, 2));
      },
    });
    await manager.refreshMq();
    console.log("MQTT connected. Press Ctrl+C to exit.");
    return new Promise(() => {});
  }

  if (command === "report-version") {
    const manager = await loadManager(required(args, "config"));
    const result = await manager.reportVersion(
      required(args, "system-version"),
      required(args, "plugin-version"),
      required(args, "sdk-version"),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "unload") {
    const manager = await loadManager(required(args, "config"));
    const result = await manager.unload();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  exit(1);
});
