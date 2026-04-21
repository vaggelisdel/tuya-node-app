import { DEFAULT_TIMEOUT_MS, LOGIN_BASE_URL, PATHS, TUYA_SCHEMA } from "./constants.js";
import { withTimeoutSignal } from "./utils.js";

export class LoginControl {
  constructor({
    clientId,
    schema = TUYA_SCHEMA,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.clientId = clientId;
    this.schema = schema;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async qrCode(userCode) {
    const url = new URL(PATHS.qrCodeToken, LOGIN_BASE_URL);
    url.searchParams.set("clientid", this.clientId);
    url.searchParams.set("usercode", userCode);
    url.searchParams.set("schema", this.schema);

    const response = await this.fetchImpl(url, {
      method: "POST",
      signal: withTimeoutSignal(this.timeoutMs),
    });

    return response.json();
  }

  async loginResult(token, userCode) {
    const url = new URL(PATHS.qrCodeLogin(token), LOGIN_BASE_URL);
    url.searchParams.set("clientid", this.clientId);
    url.searchParams.set("usercode", userCode);

    const response = await this.fetchImpl(url, {
      method: "GET",
      signal: withTimeoutSignal(this.timeoutMs),
    });

    const payload = await response.json();
    if (!payload.success) {
      return [false, payload];
    }

    return [
      true,
      {
        ...payload.result,
        t: payload.t,
      },
    ];
  }
}
