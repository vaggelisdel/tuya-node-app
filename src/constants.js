export const DEFAULT_TIMEOUT_MS = 10_000;
export const TUYA_CLIENT_ID = "HA_3y9q4ak7g4ephrvke";
export const TUYA_SCHEMA = "haauthorize";
export const LOGIN_BASE_URL = "https://apigw.iotbing.com";

export const PATHS = {
  qrCodeToken: "/v1.0/m/life/home-assistant/qrcode/tokens",
  qrCodeLogin: (token) =>
    `/v1.0/m/life/home-assistant/qrcode/tokens/${encodeURIComponent(token)}`,
  refreshToken: (refreshToken) =>
    `/v1.0/m/token/${encodeURIComponent(refreshToken)}`,
  homes: "/v1.0/m/life/users/homes",
  homeDevices: "/v1.0/m/life/ha/home/devices",
  deviceDetails: "/v1.0/m/life/ha/devices/detail",
  deviceSpecifications: (deviceId) =>
    `/v1.1/m/life/${encodeURIComponent(deviceId)}/specifications`,
  deviceStatusStrategy: (deviceId) =>
    `/v1.0/m/life/devices/${encodeURIComponent(deviceId)}/status`,
  deviceReportTypes: (deviceId) =>
    `/v1.0/m/life/ha/${encodeURIComponent(deviceId)}/dp-report-types`,
  sendCommands: (deviceId) =>
    `/v1.1/m/thing/${encodeURIComponent(deviceId)}/commands`,
  streamAllocation: (deviceId) =>
    `/v1.0/m/ipc/${encodeURIComponent(deviceId)}/stream/actions/allocate`,
  mqttConfig: "/v1.0/m/life/ha/access/config",
  versionReport: "/v1.0/m/life/home-assistant/qrcode/versions",
  unloadTerminal: "/v1.0/m/token/terminal/expire",
};

export const PROTOCOL_DEVICE_REPORT = 4;
export const PROTOCOL_OTHER = 20;

export const BIZ_CODES = {
  online: "online",
  offline: "offline",
  nameUpdate: "nameUpdate",
  dpNameUpdate: "dpNameUpdate",
  bindUser: "bindUser",
  delete: "delete",
};
