from __future__ import annotations

from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TuyaNodeApi
from .const import CONF_BASE_URL, CONF_USER_CODE, DEFAULT_NAME, DOMAIN


class TuyaNodeBridgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._base_url: str | None = None
        self._user_code: str | None = None
        self._token: str | None = None
        self._setup_url: str | None = None
        self._qr_code_url: str | None = None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            base_url = user_input[CONF_BASE_URL].rstrip("/")
            user_code = user_input[CONF_USER_CODE].strip()

            await self.async_set_unique_id(base_url)
            self._abort_if_unique_id_configured()

            session = async_get_clientsession(self.hass)
            api = TuyaNodeApi(session, base_url)

            try:
                healthy = await api.async_health()
                if not healthy:
                    errors["base"] = "cannot_connect"
                else:
                    payload = await api.async_create_qr(user_code)
                    if not payload.get("success") or not payload.get("token"):
                        errors["base"] = "invalid_qr"
                    else:
                        self._base_url = base_url
                        self._user_code = user_code
                        self._token = payload["token"]
                        self._setup_url = f"{base_url}/"
                        self._qr_code_url = payload.get("qr_code_url", "")
                        return await self.async_step_scan()
            except (aiohttp.ClientError, TimeoutError):
                errors["base"] = "cannot_connect"
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"

        schema = vol.Schema(
            {
                vol.Required(CONF_BASE_URL): str,
                vol.Required(CONF_USER_CODE): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_scan(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            session = async_get_clientsession(self.hass)
            api = TuyaNodeApi(session, self._base_url or "")
            try:
                payload = await api.async_complete_setup(self._user_code or "", self._token or "")
                if payload.get("success"):
                    title = payload.get("username") or DEFAULT_NAME
                    return self.async_create_entry(
                        title=title,
                        data={
                            CONF_BASE_URL: self._base_url,
                            CONF_USER_CODE: self._user_code,
                        },
                    )
                errors["base"] = "login_failed"
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
                "setup_url": self._setup_url or "",
                "qr_code_url": self._qr_code_url or "",
            },
        )
