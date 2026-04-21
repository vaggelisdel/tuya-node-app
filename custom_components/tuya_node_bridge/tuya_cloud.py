from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import inspect
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

import aiohttp
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .const import (
    LOGIN_BASE_URL,
    REQUEST_TIMEOUT,
    TUYA_CLIENT_ID,
    TUYA_SCHEMA,
    PATH_HOME_DEVICES,
    PATH_HOMES,
    path_device_report_types,
    path_device_specifications,
    path_device_status_strategy,
    path_qr_code_login,
    path_qr_code_token,
    path_refresh_token,
    path_stream_allocation,
)


def _md5_hex(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def _form_to_json(content: dict[str, Any]) -> str:
    return json.dumps(content, separators=(",", ":"))


def _random_nonce(length: int = 12) -> bytes:
    # Tuya expects a 12-byte nonce for AES-GCM.
    return uuid.uuid4().hex[:length].encode("utf-8")


def _secret_generating(request_id: str, sid: str, hash_key: str) -> str:
    message = hash_key
    mod = 16
    if sid:
        length = min(len(sid), mod)
        encoded = ""
        for i in range(length):
            idx = ord(sid[i]) % mod
            encoded += sid[idx]
        message += f"_{encoded}"

    digest = hmac.new(
        request_id.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest[:16]


def _aes_gcm_encrypt(raw_data: str, secret: str) -> str:
    nonce = _random_nonce(12)
    aes = AESGCM(secret.encode("utf-8"))
    ciphertext_and_tag = aes.encrypt(nonce, raw_data.encode("utf-8"), None)
    return base64.b64encode(nonce).decode("utf-8") + base64.b64encode(ciphertext_and_tag).decode("utf-8")


def _aes_gcm_decrypt(cipher_data: str, secret: str) -> str:
    decoded = base64.b64decode(cipher_data)
    nonce = decoded[:12]
    encrypted = decoded[12:]
    aes = AESGCM(secret.encode("utf-8"))
    plaintext = aes.decrypt(nonce, encrypted, None)
    return plaintext.decode("utf-8")


def _restful_sign(hash_key: str, query_encdata: str, body_encdata: str, headers: dict[str, str]) -> str:
    keys = ["X-appKey", "X-requestId", "X-sid", "X-time", "X-token"]
    header_sign = "||".join(
        f"{k}={headers[k]}" for k in keys if headers.get(k)
    )

    sign_str = header_sign
    if query_encdata:
        sign_str += query_encdata
    if body_encdata:
        sign_str += body_encdata

    return hmac.new(
        hash_key.encode("utf-8"),
        sign_str.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@dataclass
class CustomerTokenInfo:
    t: int
    expire_time: int
    uid: str
    access_token: str
    refresh_token: str

    @property
    def expire_at_ms(self) -> int:
        return int(self.t) + int(self.expire_time) * 1000


class TuyaLoginApi:
    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def _read_json(self, response: aiohttp.ClientResponse) -> dict[str, Any]:
        try:
            return await response.json(content_type=None)
        except Exception:  # noqa: BLE001
            text = await response.text()
            return {
                "success": False,
                "code": f"HTTP_{response.status}",
                "msg": text or "Unexpected response from Tuya login endpoint",
            }

    async def async_create_qr(self, user_code: str) -> dict[str, Any]:
        params = {
            "clientid": TUYA_CLIENT_ID,
            "usercode": user_code,
            "schema": TUYA_SCHEMA,
        }
        async with self._session.post(
            f"{LOGIN_BASE_URL}{path_qr_code_token()}",
            params=params,
            timeout=REQUEST_TIMEOUT,
        ) as response:
            payload = await self._read_json(response)
            if response.status >= 500:
                raise aiohttp.ClientResponseError(
                    request_info=response.request_info,
                    history=response.history,
                    status=response.status,
                    message="Tuya login server error",
                    headers=response.headers,
                )
            return payload

    async def async_login_result(self, token: str, user_code: str) -> dict[str, Any]:
        params = {
            "clientid": TUYA_CLIENT_ID,
            "usercode": user_code,
        }
        async with self._session.get(
            f"{LOGIN_BASE_URL}{path_qr_code_login(token)}",
            params=params,
            timeout=REQUEST_TIMEOUT,
        ) as response:
            payload = await self._read_json(response)
            if response.status >= 500:
                raise aiohttp.ClientResponseError(
                    request_info=response.request_info,
                    history=response.history,
                    status=response.status,
                    message="Tuya login server error",
                    headers=response.headers,
                )
            return payload


class TuyaCloudApi:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        user_code: str,
        endpoint: str,
        token_info: dict[str, Any],
        token_update_cb,
    ) -> None:
        self._session = session
        self._user_code = user_code
        self._endpoint = endpoint.rstrip("/")
        self._token_listener = token_update_cb
        self._token_info = CustomerTokenInfo(
            t=token_info.get("t", 0),
            expire_time=token_info.get("expire_time", 0),
            uid=token_info.get("uid", ""),
            access_token=token_info.get("access_token", ""),
            refresh_token=token_info.get("refresh_token", ""),
        )
        self._refresh_lock = False

    @property
    def token_info(self) -> dict[str, Any]:
        return {
            "t": self._token_info.t,
            "expire_time": self._token_info.expire_time,
            "uid": self._token_info.uid,
            "access_token": self._token_info.access_token,
            "refresh_token": self._token_info.refresh_token,
        }

    async def _refresh_access_token_if_needed(self) -> None:
        now = int(time.time() * 1000)
        if self._token_info.expire_at_ms - 60000 > now:
            return

        if self._refresh_lock:
            await asyncio.sleep(0.2)
            return await self._refresh_access_token_if_needed()

        self._refresh_lock = True
        try:
            payload = await self.get(path_refresh_token(self._token_info.refresh_token))
            result = payload.get("result", {})
            new_token = {
                "t": payload.get("t", now),
                "expire_time": result.get("expireTime", 0),
                "uid": result.get("uid", ""),
                "access_token": result.get("accessToken", ""),
                "refresh_token": result.get("refreshToken", ""),
            }
            self._token_info = CustomerTokenInfo(**new_token)
            maybe = self._token_listener(new_token)
            if inspect.isawaitable(maybe):
                await maybe
        finally:
            self._refresh_lock = False

    async def request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        await self._refresh_access_token_if_needed()

        request_id = str(uuid.uuid4())
        sid = ""
        hash_key = _md5_hex(f"{request_id}{self._token_info.refresh_token}")
        secret = _secret_generating(request_id, sid, hash_key)

        query_encdata = ""
        query_params = None
        if params:
            query_encdata = _aes_gcm_encrypt(_form_to_json(params), secret)
            query_params = {"encdata": query_encdata}

        body_encdata = ""
        payload_body = None
        if body:
            body_encdata = _aes_gcm_encrypt(_form_to_json(body), secret)
            payload_body = {"encdata": body_encdata}

        headers = {
            "X-appKey": TUYA_CLIENT_ID,
            "X-requestId": request_id,
            "X-sid": sid,
            "X-time": str(int(time.time() * 1000)),
        }

        if self._token_info.access_token:
            headers["X-token"] = self._token_info.access_token
        if payload_body is not None:
            headers["Content-Type"] = "application/json"

        headers["X-sign"] = _restful_sign(hash_key, query_encdata, body_encdata, headers)

        async with self._session.request(
            method,
            f"{self._endpoint}{path}",
            params=query_params,
            json=payload_body,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        ) as response:
            response.raise_for_status()
            payload = await response.json()

        if not payload.get("success"):
            raise RuntimeError(f"Tuya API error ({payload.get('code')}): {payload.get('msg')}")

        result = payload.get("result")
        if result not in (None, ""):
            decrypted = _aes_gcm_decrypt(result, secret)
            try:
                payload["result"] = json.loads(decrypted)
            except ValueError:
                payload["result"] = decrypted

        return payload

    async def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self.request("GET", path, params=params, body=None)

    async def post(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await self.request("POST", path, params=params, body=body)

    async def async_query_devices(self) -> list[dict[str, Any]]:
        homes_payload = await self.get(PATH_HOMES)
        homes = homes_payload.get("result", [])
        devices: list[dict[str, Any]] = []

        for home in homes:
            home_id = home.get("groupId") or home.get("id")
            if not home_id:
                continue

            response = await self.get(PATH_HOME_DEVICES, {"homeId": home_id})
            for item in response.get("result", []):
                device = dict(item)
                status = {}
                for st in device.get("status", []):
                    code = st.get("code")
                    if code is not None:
                        status[code] = st.get("value")
                device["status"] = status

                await self._enrich_device(device)
                devices.append(device)

        return devices

    async def _enrich_device(self, device: dict[str, Any]) -> None:
        device_id = device.get("id")
        if not device_id:
            return

        spec = await self.get(path_device_specifications(device_id))
        spec_res = spec.get("result", {})
        device["function"] = {x["code"]: x for x in spec_res.get("functions", []) if "code" in x}
        device["status_range"] = {x["code"]: x for x in spec_res.get("status", []) if "code" in x}

        strategy = await self.get(path_device_status_strategy(device_id))
        strategy_res = strategy.get("result", {})
        dp_status = strategy_res.get("dpStatusRelationDTOS", [])
        support_local = True
        local_strategy: dict[str, Any] = {}
        for item in dp_status:
            if not item.get("supportLocal", False):
                support_local = False
                break
            dp_id = item.get("dpId")
            if dp_id is None:
                continue
            local_strategy[dp_id] = {
                "value_convert": item.get("valueConvert"),
                "status_code": item.get("statusCode"),
                "config_item": {
                    "statusFormat": item.get("statusFormat"),
                    "valueDesc": item.get("valueDesc"),
                    "valueType": item.get("valueType"),
                    "enumMappingMap": item.get("enumMappingMap"),
                    "pid": strategy_res.get("productKey"),
                },
            }
        device["support_local"] = support_local
        if support_local:
            device["local_strategy"] = local_strategy

        report_types = await self.get(path_device_report_types(device_id))
        for item in report_types.get("result", []):
            code = item.get("dp_code")
            if code and code in device["status_range"]:
                device["status_range"][code]["report_type"] = item.get("report_type")

    async def async_get_device_stream_url(self, device_id: str, stream_type: str = "rtsp") -> str | None:
        response = await self.post(path_stream_allocation(device_id), body={"type": stream_type})
        return response.get("result", {}).get("url")
