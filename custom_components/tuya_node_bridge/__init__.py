from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_ENDPOINT, CONF_TOKEN_INFO, CONF_USER_CODE, DOMAIN
from .coordinator import TuyaNodeCoordinator
from .tuya_cloud import TuyaCloudApi

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["logger"] = _LOGGER
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    session = async_get_clientsession(hass)

    async def _update_token(new_token: dict) -> None:
        data = {**entry.data, CONF_TOKEN_INFO: new_token}
        hass.config_entries.async_update_entry(entry, data=data)

    api = TuyaCloudApi(
        session=session,
        user_code=entry.data[CONF_USER_CODE],
        endpoint=entry.data[CONF_ENDPOINT],
        token_info=entry.data[CONF_TOKEN_INFO],
        token_update_cb=_update_token,
    )

    coordinator = TuyaNodeCoordinator(hass, api)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "api": api,
        "coordinator": coordinator,
    }

    await hass.config_entries.async_forward_entry_setups(entry, [Platform.CAMERA])
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, [Platform.CAMERA])
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
