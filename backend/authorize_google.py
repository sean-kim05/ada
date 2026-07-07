"""One-time Google authorization for Ada. Run once from backend/ after you've dropped your
OAuth client into backend/.google/client_secret.json (see CALENDAR_SETUP.md):

    .venv/bin/python authorize_google.py

It prints a URL — open it, pick your Google account, consent — and it writes
backend/.google/token.json. Re-run any time to re-authorize or add scopes."""

from __future__ import annotations

import os

from google_auth_oauthlib.flow import InstalledAppFlow

from app.config import settings
from app.tools.google_auth import SCOPES


def main() -> None:
    if not os.path.exists(settings.google_client_secret):
        raise SystemExit(
            f"Missing {settings.google_client_secret}\n"
            "→ Create an OAuth *Desktop app* client in Google Cloud, download the JSON,\n"
            "  and save it to that path. Steps are in CALENDAR_SETUP.md."
        )
    flow = InstalledAppFlow.from_client_secrets_file(settings.google_client_secret, SCOPES)
    # run_local_server spins a localhost callback and prints the consent URL. WSL2 forwards
    # localhost from Windows, so the browser redirect reaches us in both mirrored and NAT
    # networking modes. open_browser=False because there's no browser inside WSL — you open
    # the printed link on Windows.
    creds = flow.run_local_server(port=0, open_browser=False)
    os.makedirs(os.path.dirname(settings.google_token), exist_ok=True)
    with open(settings.google_token, "w") as f:
        f.write(creds.to_json())
    print(f"\n✅ Authorized. Token saved to {settings.google_token}")
    print("   Restart the backend and Ada can see your calendar.")


if __name__ == "__main__":
    main()
