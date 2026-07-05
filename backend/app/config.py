from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    local_model: str = "qwen2.5:14b"
    claude_model: str = "claude-haiku-4-5"

    postgres_dsn: str = "postgresql://ada:ada_dev@localhost:5432/ada"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"

    host: str = "127.0.0.1"
    port: int = 8000


settings = Settings()
