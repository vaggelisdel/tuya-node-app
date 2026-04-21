"""Constants for the Tuya Node Bridge integration."""

from __future__ import annotations

import logging

from homeassistant.const import Platform

DOMAIN = "tuya_node_bridge"
LOGGER = logging.getLogger(__package__)

PLATFORMS = [Platform.CAMERA]

CONF_USER_CODE = "user_code"
CONF_TERMINAL_ID = "terminal_id"
CONF_ENDPOINT = "endpoint"
CONF_TOKEN_INFO = "token_info"

TUYA_CLIENT_ID = "HA_3y9q4ak7g4ephrvke"
TUYA_SCHEMA = "haauthorize"

TUYA_RESPONSE_CODE = "code"
TUYA_RESPONSE_MSG = "msg"
TUYA_RESPONSE_QR_CODE = "qrcode"
TUYA_RESPONSE_RESULT = "result"
TUYA_RESPONSE_SUCCESS = "success"

TUYA_DISCOVERY_NEW = "tuya_node_bridge_discovery_new"
TUYA_HA_SIGNAL_UPDATE_ENTITY = "tuya_node_bridge_entry_update"
