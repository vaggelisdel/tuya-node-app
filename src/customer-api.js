import crypto from "node:crypto";

import { DEFAULT_TIMEOUT_MS, PATHS } from "./constants.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  formToJson,
  md5Hex,
  restfulSign,
  secretGenerating,
  withTimeoutSignal,
} from "./utils.js";

export class CustomerTokenInfo {
  constructor(tokenInfo = {}) {
    this.expireTime = (tokenInfo.t ?? 0) + (tokenInfo.expire_time ?? 0) * 1000;
    this.uid = tokenInfo.uid ?? "";
    this.accessToken = tokenInfo.access_token ?? "";
    this.refreshToken = tokenInfo.refresh_token ?? "";
  }
}

export class CustomerApi {
  constructor({
    tokenInfo,
    clientId,
    userCode,
    endpoint,
    tokenListener = null,
    requestTracer = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  }) {
    this.tokenInfo = new CustomerTokenInfo(tokenInfo);
    this.clientId = clientId;
    this.userCode = userCode;
    this.endpoint = endpoint;
    this.tokenListener = tokenListener;
    this.requestTracer = requestTracer;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.refreshingToken = null;
  }

  async request(method, path, params = null, body = null) {
    await this.refreshAccessTokenIfNeeded();

    const requestId = crypto.randomUUID();
    const sid = "";
    const hashKey = md5Hex(`${requestId}${this.tokenInfo.refreshToken}`);
    const secret = secretGenerating(requestId, sid, hashKey);

    let queryEncdata = "";
    let encodedParams = undefined;
    if (params && Object.keys(params).length > 0) {
      const serialized = formToJson(params);
      const encrypted = aesGcmEncrypt(serialized, secret);
      queryEncdata = encrypted;
      encodedParams = new URLSearchParams({ encdata: encrypted });
    }

    let bodyEncdata = "";
    let encodedBody = undefined;
    if (body && Object.keys(body).length > 0) {
      const serialized = formToJson(body);
      const encrypted = aesGcmEncrypt(serialized, secret);
      bodyEncdata = encrypted;
      encodedBody = { encdata: encrypted };
    }

    const headers = {
      "X-appKey": this.clientId,
      "X-requestId": requestId,
      "X-sid": sid,
      "X-time": String(Date.now()),
    };

    if (encodedBody) {
      headers["Content-Type"] = "application/json";
    }

    if (this.tokenInfo.accessToken) {
      headers["X-token"] = this.tokenInfo.accessToken;
    }

    headers["X-sign"] = restfulSign(hashKey, queryEncdata, bodyEncdata, headers);

    const url = new URL(path, this.endpoint);
    if (encodedParams) {
      url.search = encodedParams.toString();
    }

    this.requestTracer?.({
      phase: "request",
      method,
      path,
      url: url.toString(),
      headers: { ...headers, "X-token": headers["X-token"] ? "[redacted]" : undefined },
      query_encdata: queryEncdata || undefined,
      body_encdata: bodyEncdata || undefined,
      params,
      body,
    });

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: encodedBody ? JSON.stringify(encodedBody) : undefined,
      signal: withTimeoutSignal(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const payload = await response.json();
    this.requestTracer?.({
      phase: "response",
      method,
      path,
      url: url.toString(),
      status: response.status,
      payload,
    });

    if (!payload.success) {
      throw new Error(`network error:(${payload.code}) ${payload.msg}`);
    }

    if (payload.result !== undefined && payload.result !== null && payload.result !== "") {
      const decrypted = aesGcmDecrypt(payload.result, secret);
      try {
        payload.result = JSON.parse(decrypted);
      } catch {
        payload.result = decrypted;
      }
    }

    return payload;
  }

  async refreshAccessTokenIfNeeded() {
    if (this.refreshingToken) {
      await this.refreshingToken;
      return;
    }

    const now = Date.now();
    if (this.tokenInfo.expireTime - 60_000 > now) {
      return;
    }

    this.refreshingToken = (async () => {
      try {
        const response = await this.get(PATHS.refreshToken(this.tokenInfo.refreshToken));
        const result = response.result ?? {};
        const tokenInfo = {
          t: response.t,
          expire_time: result.expireTime,
          uid: result.uid,
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        };

        this.tokenInfo = new CustomerTokenInfo(tokenInfo);
        if (this.tokenListener?.updateToken) {
          await this.tokenListener.updateToken(tokenInfo);
        }
      } finally {
        this.refreshingToken = null;
      }
    })();

    await this.refreshingToken;
  }

  get(path, params = null) {
    return this.request("GET", path, params, null);
  }

  post(path, params = null, body = null) {
    return this.request("POST", path, params, body);
  }

  put(path, body = null) {
    return this.request("PUT", path, null, body);
  }

  delete(path, params = null) {
    return this.request("DELETE", path, params, null);
  }
}
