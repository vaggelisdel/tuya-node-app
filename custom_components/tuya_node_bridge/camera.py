from __future__ import annotations

from typing import Any

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
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
        self._device = dict(device)
        self._device_id: str = device["id"]
        self._attr_unique_id = f"tuya_node_bridge_{self._device_id}"
        self._attr_name = device.get("name") or self._device_id
        self._attr_should_poll = False
        self._attr_is_streaming = True
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, self._device_id)},
            name=device.get("name") or self._device_id,
            manufacturer="Tuya",
            model=device.get("product_name") or device.get("product_id"),
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "category": self._device.get("category"),
            "product_id": self._device.get("product_id"),
            "online": self._device.get("online"),
        }

    @property
    def is_on(self) -> bool:
        return bool(self._device.get("online", True))

    def _find_device(self) -> dict[str, Any] | None:
        for item in self.coordinator.data or []:
            if item.get("id") == self._device_id:
                return item
        return None

    @property
    def available(self) -> bool:
        if not super().available:
            return False
        current = self._find_device()
        if current:
            self._device = current
        return True

    async def stream_source(self) -> str | None:
        current = self._find_device()
        if current:
            self._device = current
        # Fetch a fresh tokenized stream URL each time HA requests stream source.
        return await self.coordinator.api.async_get_device_stream_url(self._device_id, "rtsp")

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        return None
