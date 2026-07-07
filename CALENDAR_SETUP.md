# Connect Ada to your Google Calendar (one-time, ~5 min)

Ada's backend needs OAuth access to *your* Google account. Only you can create the OAuth
client (it's tied to your Google identity), so here's the whole thing. After this, Ada reads
your real day and can create/move events for you.

## 1. Make an OAuth client in Google Cloud (the part only you can do)

1. Go to <https://console.cloud.google.com> → create a project (name it **Ada**), or pick one.
2. **Enable the API:** APIs & Services → **Library** → search **"Google Calendar API"** → **Enable**.
3. **OAuth consent screen:** APIs & Services → **OAuth consent screen**
   - User type: **External** → Create.
   - Fill App name (**Ada**), your email for support + developer contact. Save.
   - **Audience → Test users → Add users →** add **skim8705@gmail.com**. (Keeps it in "Testing" —
     that's fine; you don't need Google to verify the app for personal use.)
4. **Create the client:** APIs & Services → **Credentials** → **Create Credentials** →
   **OAuth client ID**
   - Application type: **Desktop app**  ← important (enables the localhost loopback flow).
   - Name it **Ada desktop** → Create → **Download JSON**.

## 2. Drop the file in

Save that downloaded JSON here (exact path — it's gitignored):

```
~/dev/ada/backend/.google/client_secret.json
```

## 3. Authorize once

```sh
cd ~/dev/ada/backend
.venv/bin/python authorize_google.py
```

It prints a URL. Open it in your browser, pick your Google account. You'll see an
**"Google hasn't verified this app"** warning — that's expected for a testing app →
**Advanced → Go to Ada (unsafe)** → allow **Calendar** access. The tab redirects to
localhost and the script saves `backend/.google/token.json`. Done.

> Or just drop the JSON in and tell me — I'll run the authorize step and hand you the URL.

## 4. Restart the backend

```sh
pkill -f 'uvicorn app.main'   # or I'll do it
cd ~/dev/ada/backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The deck's Calendar panel flips from "NOT CONNECTED" to your real day, and you can tell Ada
things like *"move my 3pm to 4 and list today's events."*

## Notes

- **Testing-mode tokens** can expire after ~7 days of inactivity. If Calendar stops working,
  just re-run `authorize_google.py`. (To make it permanent, hit "Publish app" on the consent
  screen — not required.)
- Scope requested: `calendar.events` (read + create/move events only — not your whole account).
- `client_secret.json` and `token.json` are gitignored; they never leave your machine.
