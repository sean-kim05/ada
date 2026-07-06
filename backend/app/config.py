from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repo root (ada/)
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    local_model: str = "qwen2.5:14b"
    claude_model: str = "claude-haiku-4-5"

    # claude_code agent (M3): runs the `claude` CLI headless on the Max plan.
    claude_bin: str = "claude"          # resolved on PATH
    claude_code_model: str = ""         # "" = use claude's configured default (Opus)
    sandbox_dir: str = str(_REPO_ROOT / "sandbox")  # blast-radius for coding runs

    postgres_dsn: str = "postgresql://ada:ada_dev@localhost:5432/ada"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"

    host: str = "127.0.0.1"
    port: int = 8000


settings = Settings()
