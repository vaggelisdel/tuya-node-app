"""Support for Tuya Node Bridge cameras."""

from __future__ import annotations

import asyncio

from tuya_sharing import CustomerDevice, Manager

from homeassistant.components import ffmpeg
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN, LOGGER, TUYA_DISCOVERY_NEW
from .coordinator import TuyaNodeConfigEntry

CAMERA_CATEGORIES = {"sp", "dghsxj"}
# Tuya RTSP URLs expire around 2.5 minutes; rotate source before expiry.
_STREAM_RESTART_SECONDS = 90


async def async_setup_entry(
    hass: HomeAssistant,
    entry: TuyaNodeConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Tuya Node Bridge cameras dynamically through Tuya discovery."""
    manager = entry.runtime_data.manager

    @callback
    def async_discover_device(device_ids: list[str]) -> None:
        """Discover and add a discovered Tuya camera."""
        entities: list[TuyaNodeCameraEntity] = []
        for device_id in device_ids:
            device = manager.device_map[device_id]
            if device.category in CAMERA_CATEGORIES:
                entities.append(TuyaNodeCameraEntity(device, manager))
        async_add_entities(entities)

    async_discover_device([*manager.device_map])

    entry.async_on_unload(
        async_dispatcher_connect(hass, TUYA_DISCOVERY_NEW, async_discover_device)
    )


class TuyaNodeCameraEntity(Camera):
    """Tuya Node Bridge Camera Entity."""

    _attr_supported_features = CameraEntityFeature.STREAM
    _attr_brand = "Tuya"
    _attr_name = None
    _attr_has_entity_name = True

    def __init__(self, device: CustomerDevice, manager: Manager) -> None:
        """Init Tuya Node Bridge camera."""
        super().__init__()
        self._device = device
        self._manager = manager
        self._restart_task: asyncio.Task | None = None
        self._last_source: str | None = None
        self._attr_unique_id = f"tuya_node_bridge_{device.id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, device.id)},
            name=device.name,
            manufacturer="Tuya",
            model=device.product_name,
            model_id=device.product_id,
        )

    async def async_added_to_hass(self) -> None:
        """Start stream restart task when entity is added."""
        await super().async_added_to_hass()
        self._restart_task = self.hass.async_create_task(
            self._stream_restart_loop(), eager_start=False
        )

    async def async_will_remove_from_hass(self) -> None:
        """Cancel stream restart task on removal."""
        if self._restart_task:
            self._restart_task.cancel()
            self._restart_task = None

    async def _stream_restart_loop(self) -> None:
        """Periodically refresh RTSP source URL and hot-swap stream input."""
        while True:
            await asyncio.sleep(_STREAM_RESTART_SECONDS)
            try:
                if self.stream is None:
                    continue

                new_source = await self.hass.async_add_executor_job(
                    self._manager.get_device_stream_allocate,
                    self._device.id,
                    "rtsp",
                )
                if not new_source:
                    continue

                if new_source != self._last_source:
                    LOGGER.debug(
                        "Updating RTSP source for %s before token expiry",
                        self._device.id,
                    )
                    self.stream.update_source(new_source)
                    self._last_source = new_source
            except Exception as err:  # noqa: BLE001
                LOGGER.debug("Error refreshing stream for %s: %s", self._device.id, err)

    async def stream_source(self) -> str | None:
        """Return the source of the RTSP stream."""
        try:
            source = await self.hass.async_add_executor_job(
                self._manager.get_device_stream_allocate,
                self._device.id,
                "rtsp",
            )
            self._last_source = source
            return source
        except Exception as err:  # noqa: BLE001
            LOGGER.warning("Failed to allocate RTSP stream for %s: %s", self._device.id, err)
            return None

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return a still image response from the camera."""
        stream_source = await self.stream_source()
        if not stream_source:
            return None
        return await ffmpeg.async_get_image(
            self.hass,
            stream_source,
            width=width,
            height=height,
        )

