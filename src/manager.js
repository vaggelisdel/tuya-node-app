import {
  BIZ_CODES,
  PATHS,
  PROTOCOL_DEVICE_REPORT,
  PROTOCOL_OTHER,
  TUYA_CLIENT_ID,
} from "./constants.js";
import { CustomerApi } from "./customer-api.js";
import { DeviceRepository } from "./device-repository.js";
import { HomeRepository } from "./home-repository.js";
import { SharingMq } from "./mq.js";

export class Manager {
  constructor(
    clientId,
    userCode,
    terminalId,
    endpoint,
    tokenInfo = null,
    tokenListener = null,
  ) {
    this.terminalId = terminalId;
    this.customerApi = new CustomerApi({
      tokenInfo,
      clientId,
      userCode,
      endpoint,
      tokenListener,
    });
    this.deviceMap = new Map();
    this.userHomes = [];
    this.homeRepository = new HomeRepository(this.customerApi);
    this.deviceRepository = new DeviceRepository(this.customerApi);
    this.deviceListeners = new Set();
    this.mq = null;
  }

  static fromEntryData(entryData, tokenListener = null, clientId = TUYA_CLIENT_ID) {
    return new Manager(
      clientId,
      entryData.user_code,
      entryData.terminal_id,
      entryData.endpoint,
      entryData.token_info,
      tokenListener,
    );
  }

  async updateDeviceCache() {
    this.deviceMap.clear();
    this.userHomes = await this.homeRepository.queryHomes();

    for (const home of this.userHomes) {
      const devices = await this.deviceRepository.queryDevicesByHome(home.id);
      for (const device of devices) {
        this.deviceMap.set(device.id, device);
      }
    }
  }

  async refreshMq() {
    if (this.mq) {
      this.mq.stop();
      this.mq = null;
    }

    const homeIds = this.userHomes.map((home) => home.id);
    const devices = [...this.deviceMap.values()].filter((device) => device.set_up);
    const mq = new SharingMq(this.customerApi, homeIds, devices);
    mq.addMessageListener((message) => this.onMessage(message));
    await mq.start();
    this.mq = mq;
  }

  sendCommands(deviceId, commands) {
    return this.deviceRepository.sendCommands(deviceId, commands);
  }

  async getDeviceStreamUrl(deviceId, streamType = "rtsp") {
    const response = await this.customerApi.post(PATHS.streamAllocation(deviceId), null, {
      type: streamType,
    });
    return response?.result?.url ?? null;
  }

  async reportVersion(systemVersion, pluginVersion, sdkVersion) {
    return this.customerApi.post(PATHS.versionReport, null, {
      system_version: systemVersion,
      ty_plugin_version: pluginVersion,
      ty_sdk_version: sdkVersion,
    });
  }

  async unload() {
    await this.customerApi.refreshAccessTokenIfNeeded();
    return this.customerApi.post(PATHS.unloadTerminal, null, {
      accessToken: this.customerApi.tokenInfo.accessToken,
      terminalId: this.terminalId,
    });
  }

  addDeviceListener(listener) {
    this.deviceListeners.add(listener);
  }

  removeDeviceListener(listener) {
    this.deviceListeners.delete(listener);
  }

  onMessage(message) {
    const protocol = message?.protocol ?? 0;
    const data = message?.data ?? {};

    if (protocol === PROTOCOL_DEVICE_REPORT) {
      this.#onDeviceReport(data.devId, data.status);
    }

    if (
      protocol === PROTOCOL_OTHER &&
      [
        BIZ_CODES.delete,
        BIZ_CODES.bindUser,
        BIZ_CODES.dpNameUpdate,
        BIZ_CODES.nameUpdate,
        BIZ_CODES.offline,
        BIZ_CODES.online,
      ].includes(data.bizCode)
    ) {
      this.#onDeviceOther(data.bizData?.devId, data.bizCode, data);
    }
  }

  #updateDevice(device, updatedStatusProperties = null, dpTimestamps = null) {
    for (const listener of this.deviceListeners) {
      listener.updateDevice?.(device, updatedStatusProperties, dpTimestamps);
    }
  }

  #onDeviceReport(deviceId, status) {
    const device = this.deviceMap.get(deviceId);
    if (!device) {
      return;
    }

    const updatedStatusProperties = [];
    const dpTimestamps = {};

    for (const item of status ?? []) {
      if ("code" in item && "value" in item) {
        device.status[item.code] = item.value;
        updatedStatusProperties.push(item.code);
      }

      if ("t" in item && "code" in item) {
        dpTimestamps[item.code] = item.t;
      }
    }

    this.#updateDevice(device, updatedStatusProperties, dpTimestamps);
  }

  async #onDeviceOther(deviceId, bizCode, data) {
    if (bizCode === BIZ_CODES.bindUser && deviceId) {
      const [device] = await this.deviceRepository.queryDevicesByIds([deviceId]);
      if (device) {
        this.deviceMap.set(device.id, device);
        this.mq?.subscribeDevice(device);
        for (const listener of this.deviceListeners) {
          listener.addDevice?.(device);
        }
      }
      return;
    }

    const device = this.deviceMap.get(deviceId);
    if (!device) {
      return;
    }

    if (bizCode === BIZ_CODES.online) {
      device.online = true;
      this.#updateDevice(device);
      return;
    }

    if (bizCode === BIZ_CODES.offline) {
      device.online = false;
      this.#updateDevice(device);
      return;
    }

    if (bizCode === BIZ_CODES.nameUpdate) {
      device.name = data.bizData?.name;
      this.#updateDevice(device);
      return;
    }

    if (bizCode === BIZ_CODES.delete) {
      this.deviceMap.delete(deviceId);
      this.mq?.unsubscribeDevice(deviceId, device.support_local);
      for (const listener of this.deviceListeners) {
        listener.removeDevice?.(deviceId);
      }
    }
  }
}
