import { PATHS } from "./constants.js";

class Filter {
  constructor(timeLimitSeconds) {
    this.timeLimitMs = timeLimitSeconds * 1000;
    this.lastCallTime = new Map();
    this.lastCleanTime = 0;
  }

  cleanExpiredKeys() {
    const currentTime = Date.now();
    if (currentTime - this.lastCleanTime < 10_000) {
      return;
    }

    for (const [key, [, lastTime]] of this.lastCallTime.entries()) {
      if (currentTime - lastTime >= 10_000) {
        this.lastCallTime.delete(key);
      }
    }

    this.lastCleanTime = currentTime;
  }

  call(deviceId, param) {
    this.cleanExpiredKeys();
    const currentTime = Date.now();
    const previous = this.lastCallTime.get(deviceId);

    if (!previous) {
      this.lastCallTime.set(deviceId, [param, currentTime]);
      return true;
    }

    const [lastParam, lastTime] = previous;
    if (
      JSON.stringify(lastParam) !== JSON.stringify(param) ||
      currentTime - lastTime >= this.timeLimitMs
    ) {
      this.lastCallTime.set(deviceId, [param, currentTime]);
      return true;
    }

    return false;
  }
}

export class DeviceRepository {
  constructor(customerApi) {
    this.api = customerApi;
    this.filter = new Filter(10);
  }

  async queryDevicesByHome(homeId) {
    const response = await this.api.get(PATHS.homeDevices, { homeId });
    return this.#queryDevices(response);
  }

  async queryDevicesByIds(ids) {
    const response = await this.api.get(PATHS.deviceDetails, {
      devIds: ids.join(","),
    });
    return this.#queryDevices(response);
  }

  async #queryDevices(response) {
    const devices = [];
    for (const item of response.result ?? []) {
      const device = { ...item };
      const status = {};
      for (const statusItem of device.status ?? []) {
        if ("code" in statusItem && "value" in statusItem) {
          status[statusItem.code] = statusItem.value;
        }
      }
      device.status = status;
      await this.updateDeviceSpecification(device);
      await this.updateDeviceStrategyInfo(device);
      await this.updateDeviceReportType(device);
      devices.push(device);
    }
    return devices;
  }

  async updateDeviceSpecification(device) {
    const response = await this.api.get(PATHS.deviceSpecifications(device.id));
    if (!response.success) {
      return;
    }

    const result = response.result ?? {};
    device.function = Object.fromEntries(
      (result.functions ?? []).map((item) => [item.code, item]),
    );
    device.status_range = Object.fromEntries(
      (result.status ?? []).map((item) => [item.code, item]),
    );
  }

  async updateDeviceStrategyInfo(device) {
    const response = await this.api.get(PATHS.deviceStatusStrategy(device.id));
    if (!response.success) {
      return;
    }

    const result = response.result ?? {};
    const pid = result.productKey;
    const dpIdMap = {};
    let supportLocal = true;

    for (const item of result.dpStatusRelationDTOS ?? []) {
      if (!item.supportLocal) {
        supportLocal = false;
        break;
      }

      dpIdMap[item.dpId] = {
        value_convert: item.valueConvert,
        status_code: item.statusCode,
        config_item: {
          statusFormat: item.statusFormat,
          valueDesc: item.valueDesc,
          valueType: item.valueType,
          enumMappingMap: item.enumMappingMap,
          pid,
        },
      };
    }

    device.support_local = supportLocal;
    if (supportLocal) {
      device.local_strategy = dpIdMap;
    }
  }

  async updateDeviceReportType(device) {
    const response = await this.api.get(PATHS.deviceReportTypes(device.id));
    if (!response.success) {
      return;
    }

    for (const item of response.result ?? []) {
      const dpCode = item.dp_code;
      if (dpCode && device.status_range?.[dpCode]) {
        device.status_range[dpCode].report_type = item.report_type;
      }
    }
  }

  async sendCommands(deviceId, commands) {
    if (!this.filter.call(deviceId, commands)) {
      return { filtered: true };
    }

    return this.api.post(PATHS.sendCommands(deviceId), null, { commands });
  }
}
