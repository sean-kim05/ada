"""REST surface for the model router — feeds the cockpit's Router panel.

GET /api/router/stats   -> local vs cloud split, $ saved, latency, recent calls
GET /api/router/health  -> is the local model reachable / loaded
"""

from __future__ import annotations

from fastapi import APIRouter

from app.agents import router as engine

router = APIRouter(prefix="/api/router")


@router.get("/stats")
async def stats() -> dict:
    return engine.stats()


@router.get("/health")
async def health() -> dict:
    return await engine.health()
