"""Workspace helpers for the Agents terminal: inspect what a Claude Code agent changed in
its working directory, and enumerate the user's real repos for quick-launch.

This is what turns Forge from a black box into something you can *manage* — you point it at
a real repo, let it work, then review the git diff it produced right in the cockpit."""

from __future__ import annotations

import asyncio
import os

_DIFF_CAP = 20_000        # max chars of combined diff we ship to the UI
_UNTRACKED_READ_CAP = 6_000   # max chars we render from a single new (untracked) file
_UNTRACKED_MAX = 40       # cap how many new files we inline


async def _git(cwd: str, *args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", cwd, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace")


async def _git_io(cwd: str, *args: str) -> tuple[int, str, str]:
    """Like _git but also returns stderr — for commands whose failure reason we surface."""
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", cwd, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def workspace_diff(cwd: str) -> dict:
    """What changed in `cwd`: the file list (git status) + a combined diff of tracked edits,
    with new (untracked) files inlined as addition blocks so files the agent *created* show up
    too. Everything is capped so a big change can't flood the socket."""
    cwd = os.path.abspath(os.path.expanduser(cwd))
    if not os.path.isdir(cwd):
        return {"dir": cwd, "is_git": False, "error": "directory does not exist", "files": [], "diff": ""}

    rc, _ = await _git(cwd, "rev-parse", "--is-inside-work-tree")
    if rc != 0:
        return {"dir": cwd, "is_git": False, "error": "not a git repo — nothing to diff", "files": [], "diff": ""}

    _, status_out = await _git(cwd, "status", "--porcelain")
    files: list[dict] = []
    untracked: list[str] = []
    for line in status_out.splitlines():
        if not line.strip():
            continue
        code, path = line[:2], line[3:].strip()
        files.append({"path": path, "status": code.strip() or code})
        if code == "??":
            untracked.append(path)

    _, staged = await _git(cwd, "diff", "--cached")
    _, unstaged = await _git(cwd, "diff")
    parts: list[str] = [d for d in (staged, unstaged) if d.strip()]

    for p in untracked[:_UNTRACKED_MAX]:
        fp = os.path.join(cwd, p)
        try:
            if os.path.isfile(fp) and os.path.getsize(fp) <= 200_000:
                with open(fp, encoding="utf-8", errors="replace") as f:
                    content = f.read(_UNTRACKED_READ_CAP)
                body = "\n".join("+" + ln for ln in content.splitlines())
                parts.append(f"diff --git a/{p} b/{p}\nnew file: {p}\n{body}")
        except OSError:
            pass

    diff = "\n\n".join(parts)
    truncated = len(diff) > _DIFF_CAP
    if truncated:
        diff = diff[:_DIFF_CAP] + "\n… (diff truncated)"
    return {"dir": cwd, "is_git": True, "files": files, "diff": diff, "truncated": truncated}


async def workspace_commit(cwd: str, message: str | None) -> dict:
    """Accept an agent's work: `git add -A` + commit everything in `cwd`. This is the
    'approve' end of review — it snapshots what the agent did (it never discards or pushes).
    Uses the repo's own git identity; surfaces git's error if the commit can't be made."""
    cwd = os.path.abspath(os.path.expanduser(cwd))
    if not os.path.isdir(cwd):
        return {"committed": False, "error": "directory does not exist"}
    rc, _ = await _git(cwd, "rev-parse", "--is-inside-work-tree")
    if rc != 0:
        return {"committed": False, "error": "not a git repo — nothing to commit"}

    _, status = await _git(cwd, "status", "--porcelain")
    if not status.strip():
        return {"committed": False, "error": "nothing to commit — no changes"}

    rc, _, err = await _git_io(cwd, "add", "-A")
    if rc != 0:
        return {"committed": False, "error": (err or "git add failed").strip()[:300]}

    msg = (message or "").strip() or "Agent changes (via Ada)"
    rc, out, err = await _git_io(cwd, "commit", "-m", msg)
    if rc != 0:
        return {"committed": False, "error": (err or out or "git commit failed").strip()[:300]}

    _, head, _ = await _git_io(cwd, "rev-parse", "--short", "HEAD")
    _, count = await _git(cwd, "rev-list", "--count", "HEAD")
    return {"committed": True, "hash": head.strip(), "message": msg, "total_commits": count.strip()}


def list_repos(root: str = "~/dev") -> list[dict]:
    """The user's real git repos under `root` — quick-launch targets for an agent."""
    base = os.path.abspath(os.path.expanduser(root))
    repos: list[dict] = []
    try:
        for name in sorted(os.listdir(base)):
            p = os.path.join(base, name)
            if os.path.isdir(os.path.join(p, ".git")):
                repos.append({"name": name, "path": p})
    except OSError:
        pass
    return repos
