from __future__ import annotations

from typing import Any

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CAMERA_CATEGORIES, DOMAIN
from .coordinator import TuyaNodeCoordinator


def _looks_like_camera(device: dict[str, Any]) -> bool:
    category = (device.get("category") or "").lower()
    name = (device.get("name") or "").lower()
    if category in CAMERA_CATEGORIES:
        return True
    return "cam" in name or "camera" in name or "eye" in name


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    runtime = hass.data[DOMAIN][entry.entry_id]
    coordinator: TuyaNodeCoordinator = runtime["coordinator"]

    entities: dict[str, TuyaNodeCameraEntity] = {}

    def build_entities() -> list[TuyaNodeCameraEntity]:
        new_entities: list[TuyaNodeCameraEntity] = []
        for device in coordinator.data or []:
            if not _looks_like_camera(device):
                continue
            device_id = device.get("id")
            if not device_id or device_id in entities:
                continue
            entity = TuyaNodeCameraEntity(coordinator, device)
            entities[device_id] = entity
            new_entities.append(entity)
        return new_entities

    first_batch = build_entities()
    if first_batch:
        async_add_entities(first_batch)

    def _handle_coordinator_update() -> None:
        batch = build_entities()
        if batch:
            async_add_entities(batch)

    entry.async_on_unload(coordinator.async_add_listener(_handle_coordinator_update))


class TuyaNodeCameraEntity(CoordinatorEntity[TuyaNodeCoordinator], Camera):
    _attr_supported_features = CameraEntityFeature.STREAM

    def __init__(self, coordinator: TuyaNodeCoordinator, device: dict[str, Any]) -> None:
        super().__init__(coordinator)
        self._device_id: str = device["id"]
        self._attr_unique_id = f"tuya_node_bridge_{self._device_id}"
        self._attr_name = device.get("name") or self._device_id
        self._attr_should_poll = False
        self._attr_is_streaming = True

    @property
    def available(self) -> bool:
        return super().available

    async def stream_source(self) -> str | None:
        return f"{self.coordinator.api.base_url}/api/streams/{self._device_id}/mjpeg"

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        return await self.coordinator.api.async_mjpeg_snapshot(self._device_id)
