#!/usr/bin/env bash
# ada — one-command launcher for the local, host-run Ada stack.
#
#   ./ada up       start everything (services in Docker, backend+frontend+ollama on the host)
#   ./ada down     stop backend + frontend + docker services (leaves ollama + docker engine)
#   ./ada status   show what's running
#   ./ada logs [backend|frontend|ollama]   tail a log
#
# This runs the FULL-FEATURE config: backend + Vite on the host (so Forge and the
# GPU router work), stateful services in Docker. For the fully-containerized core
# see docker-compose.app.yml (Forge + router don't work there — that's expected).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/.ada-logs"
mkdir -p "$LOGS"

port_pid() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1; }
is_up()    { curl -s -m 2 "$1" >/dev/null 2>&1; }

start_services() {
  echo "▸ services (Postgres/Redis/Qdrant)…"
  ( cd "$ROOT" && docker compose up -d ) >/dev/null
  for _ in $(seq 1 30); do
    [ "$(cd "$ROOT" && docker compose ps --format '{{.Health}}' 2>/dev/null | grep -c healthy)" -ge 3 ] && break
    sleep 1
  done
  echo "  services healthy"
}

start_ollama() {
  if is_up http://127.0.0.1:11434/api/tags; then echo "▸ ollama already up"; return; fi
  echo "▸ ollama (local model router)…"
  setsid nohup ollama serve > "$LOGS/ollama.log" 2>&1 < /dev/null &
  for _ in $(seq 1 10); do is_up http://127.0.0.1:11434/api/tags && break; sleep 1; done
  echo "  ollama up"
}

start_backend() {
  if is_up http://127.0.0.1:8000/health; then echo "▸ backend already up"; return; fi
  echo "▸ backend (:8000)…"
  ( cd "$ROOT/backend" && setsid nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 \
      > "$LOGS/backend.log" 2>&1 < /dev/null & )
  for _ in $(seq 1 30); do is_up http://127.0.0.1:8000/health && break; sleep 1; done
  echo "  backend up"
}

start_frontend() {
  if is_up http://127.0.0.1:5173; then echo "▸ frontend already up"; return; fi
  echo "▸ frontend (:5173)…"
  ( cd "$ROOT/frontend" && setsid nohup npm run dev > "$LOGS/frontend.log" 2>&1 < /dev/null & )
  for _ in $(seq 1 30); do is_up http://127.0.0.1:5173 && break; sleep 1; done
  echo "  frontend up"
}

case "${1:-up}" in
  up)
    command -v docker >/dev/null 2>&1 || { echo "✗ docker not found — start Docker Desktop first"; exit 1; }
    docker info >/dev/null 2>&1 || { echo "✗ docker engine not ready — start Docker Desktop first"; exit 1; }
    start_services
    start_ollama
    start_backend
    start_frontend
    echo ""
    echo "✓ Ada is up →  http://localhost:5173"
    ;;
  down)
    echo "▸ stopping frontend + backend…"
    for p in 5173 8000; do pid="$(port_pid "$p")"; [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "  killed :$p (pid $pid)"; done
    echo "▸ stopping services…"
    ( cd "$ROOT" && docker compose stop ) >/dev/null 2>&1 || true
    echo "✓ down (ollama + docker engine left running)"
    ;;
  status)
    is_up http://127.0.0.1:8000/health         && echo "backend   ✓ :8000" || echo "backend   ✗"
    is_up http://127.0.0.1:5173                && echo "frontend  ✓ :5173" || echo "frontend  ✗"
    is_up http://127.0.0.1:11434/api/tags      && echo "ollama    ✓ :11434" || echo "ollama    ✗"
    ( cd "$ROOT" && docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | sed 's/^/service   ✓ /' ) || true
    ;;
  logs)
    svc="${2:-backend}"; tail -f "$LOGS/$svc.log"
    ;;
  *)
    echo "usage: ./ada {up|down|status|logs [backend|frontend|ollama]}"; exit 1
    ;;
esac
