"""Ada backend entrypoint. Run: uvicorn app.main:app --reload --port 8000"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import close_db, init_db
from app.routers import calendar, chat, memory, router, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bring up the Postgres pool + schema before serving; close it on shutdown.
    await init_db()
    yield
    await close_db()


app = FastAPI(title="Ada", lifespan=lifespan)

# Dev: Vite runs on 5173. Localhost only — Ada can run commands on your machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(tasks.router)
app.include_router(calendar.router)
app.include_router(memory.router)
app.include_router(router.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": settings.claude_model}
