import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("capmonster_mcp")

API_KEY_ENV = "CAPMONSTER_API_KEY"
LEGACY_API_KEY_ENV = "CM_API_KEY"

LEGACY_KEY_WARNING = (
    f"{LEGACY_API_KEY_ENV} is deprecated: rename it to {API_KEY_ENV}. "
    f"{LEGACY_API_KEY_ENV} still works for now but will be removed in a future release."
)


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    mcp_server_name: str = "capmonster-mcp"
    capmonster_api_key: str = ""
    # Deprecated name, read only when CAPMONSTER_API_KEY is not set.
    cm_api_key: str = ""

    @property
    def api_key(self) -> str:
        return self.capmonster_api_key or self.cm_api_key

    @property
    def uses_legacy_api_key(self) -> bool:
        return not self.capmonster_api_key and bool(self.cm_api_key)


_legacy_warning_emitted = False


def warn_if_legacy_api_key(settings: AppSettings) -> None:
    """Log the deprecation warning once per process (stderr, never stdout:
    stdout carries the MCP protocol)."""
    global _legacy_warning_emitted
    if settings.uses_legacy_api_key and not _legacy_warning_emitted:
        _legacy_warning_emitted = True
        logger.warning(LEGACY_KEY_WARNING)
