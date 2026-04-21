"""Tuya Node Bridge integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed

from .const import DOMAIN, LOGGER, PLATFORMS
from .coordinator import (
    DeviceListener,
    HomeAssistantTuyaNodeData,
    TokenListener,
    TuyaNodeConfigEntry,
    create_manager,
)


async def async_setup_entry(hass: HomeAssistant, entry: TuyaNodeConfigEntry) -> bool:
    """Async setup hass config entry."""
    token_listener = TokenListener(hass, entry)

    manager = await hass.async_add_executor_job(create_manager, entry, token_listener)

    listener = DeviceListener(hass, manager)
    manager.add_device_listener(listener)

    try:
        await hass.async_add_executor_job(manager.update_device_cache)
    except Exception as exc:
        if "sign invalid" in str(exc):
            msg = "Authentication failed. Please re-authenticate"
            raise ConfigEntryAuthFailed(msg) from exc
        raise

    entry.runtime_data = HomeAssistantTuyaNodeData(manager=manager, listener=listener)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    await hass.async_add_executor_job(manager.refresh_mq)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TuyaNodeConfigEntry) -> bool:
    """Unloading the Tuya Node Bridge platforms."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        tuya = entry.runtime_data
        if tuya.manager.mq is not None:
            tuya.manager.mq.stop()
        tuya.manager.remove_device_listener(tuya.listener)
    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: TuyaNodeConfigEntry) -> None:
    """Remove a config entry."""
    from .const import CONF_USER_CODE, CONF_TERMINAL_ID, CONF_ENDPOINT, CONF_TOKEN_INFO, TUYA_CLIENT_ID
    from tuya_sharing import Manager

    manager = Manager(
        TUYA_CLIENT_ID,
        entry.data[CONF_USER_CODE],
        entry.data[CONF_TERMINAL_ID],
        entry.data[CONF_ENDPOINT],
        entry.data[CONF_TOKEN_INFO],
    )
    await hass.async_add_executor_job(manager.unload)
