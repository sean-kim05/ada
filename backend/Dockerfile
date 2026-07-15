# Ada backend — FastAPI + Pydantic AI, single uvicorn worker (no --reload).
#
# NOTE ON SCOPE: this image runs the API, the secretary tools, tasks/memory,
# and the model router. It does NOT run Forge (the `claude` CLI subprocess) or
# the local Ollama GPU router from inside the container — both need host access
# (Max-plan auth + ~/dev repos; the 5080 GPU). For full-feature local dev, keep
# running the backend on the host. This image is the reproducible core / the
# foundation for a future user-facing deploy. See ARCHITECTURE.md / CLAUDE.md.
FROM python:3.12-slim

# git: used by runtime/workspace.py (diff/commit) and any host-mounted repos.
# curl: healthcheck. build-essential is intentionally omitted — fastembed's
# onnxruntime and asyncpg ship manylinux wheels, so no compiler is needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so the layer caches across code edits.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code. config.py reads .env relative to cwd, so WORKDIR must be the
# backend root and .env is provided at runtime (env_file / bind mount).
COPY . .

EXPOSE 8000

# Bind 0.0.0.0 inside the container (the settings default 127.0.0.1 is for host
# runs). One worker, no --reload — in-process pub/sub + WS state must be shared.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
