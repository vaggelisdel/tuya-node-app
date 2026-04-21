from __future__ import annotations

import asyncio
from typing import Any

import aiohttp


class TuyaNodeApi:
    def __init__(self, session: aiohttp.ClientSession, base_url: str) -> None:
        self._session = session
        self.base_url = base_url.rstrip("/")

    async def async_health(self) -> bool:
        data = await self.async_get_json("/health")
        return bool(data.get("success"))

    async def async_get_devices(self) -> list[dict[str, Any]]:
        data = await self.async_get_json("/api/devices")
        if not data.get("success"):
            raise RuntimeError(data.get("error", "Failed to load devices"))
        return data.get("devices", [])

    async def async_create_qr(self, user_code: str) -> dict[str, Any]:
        return await self.async_post_json("/setup/qr-code", {"user_code": user_code})

    async def async_complete_setup(self, user_code: str, token: str) -> dict[str, Any]:
        return await self.async_post_json(
            "/setup/complete",
            {
                "user_code": user_code,
                "token": token,
                "save": "./tuya-session.json",
            },
        )

    async def async_get_json(self, path: str) -> dict[str, Any]:
        async with self._session.get(f"{self.base_url}{path}", timeout=15) as response:
            response.raise_for_status()
            return await response.json()

    async def async_post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._session.post(
            f"{self.base_url}{path}",
            json=payload,
            timeout=20,
        ) as response:
            response.raise_for_status()
            return await response.json()

    async def async_mjpeg_snapshot(self, device_id: str) -> bytes | None:
        url = f"{self.base_url}/api/streams/{device_id}/mjpeg"
        try:
            async with self._session.get(url, timeout=15) as response:
                response.raise_for_status()
                return await self._extract_jpeg_frame(response)
        except (TimeoutError, aiohttp.ClientError):
            return None

    async def _extract_jpeg_frame(self, response: aiohttp.ClientResponse) -> bytes | None:
        buffer = bytearray()
        max_size = 1_500_000

        async for chunk in response.content.iter_chunked(4096):
            buffer.extend(chunk)
            if len(buffer) > max_size:
                del buffer[: len(buffer) - max_size]

            start = buffer.find(b"\xff\xd8")
            if start == -1:
                continue
            end = buffer.find(b"\xff\xd9", start + 2)
            if end == -1:
                continue

            return bytes(buffer[start : end + 2])

        return None
