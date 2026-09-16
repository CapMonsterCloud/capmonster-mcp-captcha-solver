from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    mcp_server_name: str = "capmonster-mcp"
    cm_api_key: str = ""
