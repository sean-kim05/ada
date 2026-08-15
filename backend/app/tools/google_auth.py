"""Google OAuth credential loading for Ada's Calendar (and later Gmail) tools.

Flow: Sean creates an OAuth *Desktop* client in Google Cloud and drops client_secret.json
into backend/.google/. Running `authorize_google.py` once opens a consent page and writes
token.json. After that, load_credentials() returns a live, auto-refreshing Credentials
object. Until then it raises NotAuthorized, so callers can show a friendly "connect your
Google account" state instead of crashing."""

from __future__ import annotations

import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from app.config import settings

# Manage calendar events (read + create/move) and read Gmail (list/read/summarize — never send).
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
]


class NotAuthorized(RuntimeError):
    """No valid Google token yet — run authorize_google.py."""


def is_authorized() -> bool:
    return os.path.exists(settings.google_token)


def load_credentials() -> Credentials:
    """Return valid Google credentials, refreshing the token if needed. Raises
    NotAuthorized if the account hasn't been connected yet."""
    if not os.path.exists(settings.google_token):
        raise NotAuthorized("Google account not connected — run authorize_google.py in backend/.")
    creds = Credentials.from_authorized_user_file(settings.google_token, SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(settings.google_token, "w") as f:
                f.write(creds.to_json())
        else:
            raise NotAuthorized("Google token invalid — re-run authorize_google.py.")
    return creds
