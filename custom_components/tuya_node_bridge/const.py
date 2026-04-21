DOMAIN = "tuya_node_bridge"
PLATFORMS = ["camera"]

CONF_USER_CODE = "user_code"
CONF_TERMINAL_ID = "terminal_id"
CONF_ENDPOINT = "endpoint"
CONF_TOKEN_INFO = "token_info"

DEFAULT_NAME = "Tuya Node Bridge"
TUYA_CLIENT_ID = "HA_3y9q4ak7g4ephrvke"
TUYA_SCHEMA = "haauthorize"
LOGIN_BASE_URL = "https://apigw.iotbing.com"
REQUEST_TIMEOUT = 15

CAMERA_CATEGORIES = {"sp", "dghsxj", "sgbj", "jtmspbj", "wsdcg"}


def path_qr_code_token() -> str:
	return "/v1.0/m/life/home-assistant/qrcode/tokens"


def path_qr_code_login(token: str) -> str:
	return f"/v1.0/m/life/home-assistant/qrcode/tokens/{token}"


def path_refresh_token(refresh_token: str) -> str:
	return f"/v1.0/m/token/{refresh_token}"


PATH_HOMES = "/v1.0/m/life/users/homes"
PATH_HOME_DEVICES = "/v1.0/m/life/ha/home/devices"
PATH_DEVICE_DETAILS = "/v1.0/m/life/ha/devices/detail"


def path_device_specifications(device_id: str) -> str:
	return f"/v1.1/m/life/{device_id}/specifications"


def path_device_status_strategy(device_id: str) -> str:
	return f"/v1.0/m/life/devices/{device_id}/status"


def path_device_report_types(device_id: str) -> str:
	return f"/v1.0/m/life/ha/{device_id}/dp-report-types"


def path_stream_allocation(device_id: str) -> str:
	return f"/v1.0/m/ipc/{device_id}/stream/actions/allocate"
