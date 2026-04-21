from __future__ import annotations

from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_ENDPOINT,
    CONF_TERMINAL_ID,
    CONF_TOKEN_INFO,
    CONF_USER_CODE,
    DEFAULT_NAME,
    DOMAIN,
)
from .tuya_cloud import TuyaCloudApi, TuyaLoginApi


class TuyaNodeBridgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._user_code: str | None = None
        self._token: str | None = None
        self._qr_code_url: str | None = None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            user_code = user_input[CONF_USER_CODE].strip()

            session = async_get_clientsession(self.hass)
            login_api = TuyaLoginApi(session)

            try:
                payload = await login_api.async_create_qr(user_code)
                token = payload.get("result", {}).get("qrcode")
                if not payload.get("success") or not token:
                    errors["base"] = "invalid_qr"
                else:
                    self._user_code = user_code
                    self._token = token
                    self._qr_code_url = f"tuyaSmart--qrLogin?token={token}"
                    return await self.async_step_scan()
            except (aiohttp.ClientError, TimeoutError):
                errors["base"] = "cannot_connect"
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"

        schema = vol.Schema(
            {
                vol.Required(CONF_USER_CODE): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_scan(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            session = async_get_clientsession(self.hass)
            login_api = TuyaLoginApi(session)
            try:
                payload = await login_api.async_login_result(self._token or "", self._user_code or "")
                if not payload.get("success"):
                    errors["base"] = "login_failed"
                else:
                    result = payload.get("result", {})
                    token_info = {
                        "t": payload.get("t"),
                        "uid": result.get("uid"),
                        "expire_time": result.get("expire_time"),
                        "access_token": result.get("access_token"),
                        "refresh_token": result.get("refresh_token"),
                    }
                    endpoint = result.get("endpoint")
                    terminal_id = result.get("terminal_id")

                    if not endpoint or not terminal_id:
                        errors["base"] = "login_failed"
                    else:
                        unique = f"{result.get('uid')}::{terminal_id}"
                        await self.async_set_unique_id(unique)
                        self._abort_if_unique_id_configured()

                        # Validate with one cloud request before creating the entry.
                        cloud = TuyaCloudApi(
                            session=session,
                            user_code=self._user_code or "",
                            endpoint=endpoint,
                            token_info=token_info,
                            token_update_cb=lambda _: None,
                        )
                        await cloud.async_query_devices()

                        title = result.get("username") or DEFAULT_NAME
                        return self.async_create_entry(
                            title=title,
                            data={
                                CONF_USER_CODE: self._user_code,
                                CONF_TERMINAL_ID: terminal_id,
                                CONF_ENDPOINT: endpoint,
                                CONF_TOKEN_INFO: token_info,
                            },
                        )
            except (aiohttp.ClientError, TimeoutError):
                errors["base"] = "cannot_connect"
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"

        schema = vol.Schema({vol.Required("confirm", default=True): bool})
        return self.async_show_form(
            step_id="scan",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "qr_code_url": self._qr_code_url or "",
            },
        )
