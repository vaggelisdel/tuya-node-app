from __future__ import annotations

from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .tuya_cloud import TuyaCloudApi
from .const import DOMAIN


class TuyaNodeCoordinator(DataUpdateCoordinator[list[dict[str, Any]]]):
    def __init__(self, hass: HomeAssistant, api: TuyaCloudApi) -> None:
        super().__init__(
            hass,
            logger=hass.data[DOMAIN]["logger"],
            name=DOMAIN,
            update_interval=timedelta(minutes=2),
        )
        self.api = api

    async def _async_update_data(self) -> list[dict[str, Any]]:
        try:
            return await self.api.async_query_devices()
        except Exception as err:  # noqa: BLE001
            raise UpdateFailed(str(err)) from err
