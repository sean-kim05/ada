from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> repo root (ada/)
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    local_model: str = "qwen2.5:7b-instruct"
    claude_model: str = "claude-haiku-4-5"

    # claude_code agent (M3): runs the `claude` CLI headless on the Max plan.
    claude_bin: str = "claude"          # resolved on PATH
    claude_code_model: str = ""         # "" = use claude's configured default (Opus)
    sandbox_dir: str = str(_REPO_ROOT / "sandbox")  # blast-radius for coding runs

    postgres_dsn: str = "postgresql://ada:ada_dev@localhost:5432/ada"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"

    # Google Calendar (M1 secretary tool). client_secret.json is the OAuth client Sean
    # downloads from Google Cloud; token.json is minted by authorize_google.py after he
    # consents once. Both live in backend/.google/ (gitignored).
    google_client_secret: str = str(_REPO_ROOT / "backend" / ".google" / "client_secret.json")
    google_token: str = str(_REPO_ROOT / "backend" / ".google" / "token.json")

    host: str = "127.0.0.1"
    port: int = 8000

    # Morning brief scheduler — generates the Gmail brief daily at this local time.
    brief_hour: int = 7
    brief_minute: int = 0


settings = Settings()
