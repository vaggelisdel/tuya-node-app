"""Support for Tuya Node Bridge cameras."""

from __future__ import annotations

import asyncio

from aiohttp import web
from haffmpeg.camera import CameraMjpeg
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
_MJPEG_BUFFER_SIZE = 64 * 1024
_MJPEG_READ_TIMEOUT = 12
_MJPEG_RECONNECT_DELAY = 1
_FFMPEG_MJPEG_EXTRA_CMD = (
    "-fflags nobuffer -flags low_delay -analyzeduration 0 -probesize 32 "
    "-r 10 -q:v 5"
)


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

    # Deliberately avoid HA's stream pipeline so the frontend falls back to
    # MJPEG via /api/camera_proxy_stream, which we can watchdog and reconnect.
    _attr_supported_features = CameraEntityFeature(0)
    _attr_brand = "Tuya"
    _attr_name = None
    _attr_has_entity_name = True

    def __init__(self, device: CustomerDevice, manager: Manager) -> None:
        """Init Tuya Node Bridge camera."""
        super().__init__()
        self._device = device
        self._manager = manager
        self._attr_unique_id = f"tuya_node_bridge_{device.id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, device.id)},
            name=device.name,
            manufacturer="Tuya",
            model=device.product_name,
            model_id=device.product_id,
        )

    async def _async_get_rtsp_source(self) -> str | None:
        """Allocate a fresh RTSP source from Tuya."""
        try:
            return await self.hass.async_add_executor_job(
                self._manager.get_device_stream_allocate,
                self._device.id,
                "rtsp",
            )
        except Exception as err:  # noqa: BLE001
            LOGGER.warning("Failed to allocate RTSP stream for %s: %s", self._device.id, err)
            return None

    async def handle_async_mjpeg_stream(
        self, request: web.Request
    ) -> web.StreamResponse | None:
        """Serve a watchdog-backed MJPEG stream with automatic RTSP reconnect."""
        manager = ffmpeg.get_ffmpeg_manager(self.hass)
        response = web.StreamResponse()
        response.content_type = manager.ffmpeg_stream_content_type
        await response.prepare(request)

        while self.hass.is_running:
            source = await self._async_get_rtsp_source()
            if not source:
                break

            stream = CameraMjpeg(manager.binary)
            opened = False
            try:
                opened = await stream.open_camera(
                    source,
                    extra_cmd=_FFMPEG_MJPEG_EXTRA_CMD,
                )
                if not opened:
                    LOGGER.debug("FFmpeg failed to open MJPEG stream for %s", self._device.id)
                    await asyncio.sleep(_MJPEG_RECONNECT_DELAY)
                    continue

                LOGGER.debug("Started MJPEG proxy for %s", self._device.id)
                reader = await stream.get_reader()
                while self.hass.is_running:
                    try:
                        async with asyncio.timeout(_MJPEG_READ_TIMEOUT):
                            data = await reader.read(_MJPEG_BUFFER_SIZE)
                    except TimeoutError:
                        LOGGER.debug(
                            "MJPEG watchdog timeout for %s, reconnecting",
                            self._device.id,
                        )
                        break

                    if not data:
                        LOGGER.debug("MJPEG stream ended for %s, reconnecting", self._device.id)
                        break

                    await response.write(data)
            except (ConnectionResetError, RuntimeError):
                return response
            except Exception as err:  # noqa: BLE001
                LOGGER.debug("MJPEG proxy error for %s: %s", self._device.id, err)
            finally:
                if opened:
                    await stream.close()

            await asyncio.sleep(_MJPEG_RECONNECT_DELAY)

        return response

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return a still image response from the camera."""
        stream_source = await self._async_get_rtsp_source()
        if not stream_source:
            return None
        return await ffmpeg.async_get_image(
            self.hass,
            stream_source,
            width=width,
            height=height,
        )

