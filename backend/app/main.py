"""Ada backend entrypoint. Run: uvicorn app.main:app --reload --port 8000"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import chat

app = FastAPI(title="Ada")

# Dev: Vite runs on 5173. Localhost only — Ada can run commands on your machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": settings.claude_model}
