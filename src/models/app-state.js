export class AppState {
  constructor(sessionPath = null) {
    this.latestSetup = null;
    this.sessionPath = sessionPath;
  }

  setLatestSetup(setup) {
    this.latestSetup = setup;
  }

  getLatestSetup() {
    return this.latestSetup;
  }

  getSession() {
    return this.latestSetup?.session ?? null;
  }

  getDevices() {
    return this.latestSetup?.devices ?? [];
  }

  getDevice(deviceId) {
    return this.getDevices().find((device) => device.id === deviceId) ?? null;
  }

  getSessionPath() {
    return this.sessionPath;
  }
}
