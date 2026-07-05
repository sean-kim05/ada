"""Ada CLI — talk to Ada from the terminal and watch the live trace with rich. This is
the CLI-side consumer of the same event stream the dashboard uses (Option C).

Usage:
    python cli.py "add a task to prep for the Joby panel, then list my tasks"

It starts a run via the running backend and subscribes to the event bus directly.
Requires the backend + Redis to be up.
"""

from __future__ import annotations

import asyncio
import sys

import httpx
from rich.console import Console
from rich.live import Live
from rich.table import Table

from app.runtime.bus import subscribe
from app.runtime.events import EventType

console = Console()

BADGE = {
    EventType.PLAN: "[bold cyan]PLAN[/]",
    EventType.TOOL_CALL: "[bold yellow]TOOL[/]",
    EventType.TOOL_RESULT: "[dim]  └[/]",
    EventType.FINAL: "[bold green]FINAL[/]",
    EventType.ERROR: "[bold red]ERROR[/]",
    EventType.LOG: "[dim]log[/]",
    EventType.MESSAGE: "[magenta]MSG[/]",
}


def render(rows: list[str]) -> Table:
    t = Table.grid(padding=(0, 1))
    t.add_column()
    for r in rows:
        t.add_row(r)
    return t


async def main(message: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post("http://127.0.0.1:8000/api/chat",
                                 json={"message": message})
        run_id = resp.json()["run_id"]

    console.print(f"[dim]run {run_id}[/]  ·  {message}\n")
    rows: list[str] = []
    with Live(render(rows), console=console, refresh_per_second=12) as live:
        async for ev in subscribe(run_id):
            badge = BADGE.get(ev.type, str(ev.type))
            lat = f"[dim]{ev.latency_ms}ms[/]" if ev.latency_ms is not None else ""
            model = f"[dim]{ev.model}[/]" if ev.model else ""
            if ev.type == EventType.TOOL_CALL:
                rows.append(f"{badge}  {ev.payload.get('tool')}  {model}  {lat}")
            elif ev.type == EventType.TOOL_RESULT:
                rows.append(f"{badge} {ev.payload.get('output')}  {lat}")
            elif ev.type == EventType.FINAL:
                rows.append(f"{badge}  {model}")
                rows.append(f"[white]{ev.payload.get('text')}[/]")
            elif ev.type == EventType.ERROR:
                rows.append(f"{badge}  {ev.payload.get('message')}")
            else:
                rows.append(f"{badge}  {ev.payload}")
            live.update(render(rows))
            if ev.type in (EventType.FINAL, EventType.ERROR):
                break


if __name__ == "__main__":
    msg = " ".join(sys.argv[1:]) or "what time is it?"
    asyncio.run(main(msg))
