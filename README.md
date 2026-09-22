# timeline

**timeline** is a personal, local-first global schedule that remembers everything:
capture one-time and recurrent future events in under 30 seconds via a local web UI
or Telegram (text/voice, AI-parsed), view them on a timeline + calendar at home on
localhost, and get configurable Telegram reminders from everywhere. Private by
construction — public code, locally-stored data.

Live demo: **[https://AntonLapshin.github.io/timeline/](https://AntonLapshin.github.io/timeline/)**

## Quickstart

Host run (native — the only path with voice transcription via local
voxtype + ffmpeg):

```bash
cp .env.example .env   # fill in your local secrets — .env is gitignored, never committed
make start             # build web + start api :8124 / web :8123 + boot autostart
```

Or with Docker (no voice transcription — the API image ships no
voxtype/ffmpeg; requires Docker access for your user — member of the `docker`
group, or run the targets via `sudo`):

```bash
cp .env.example .env   # fill in your local secrets — .env is gitignored, never committed
make docker-dev        # build + start the stack, wait for API health, print URLs
```

Then open **http://127.0.0.1:8123/timeline/** — or from another machine on your
LAN, `http://<lan-ip>:8123/timeline/` (whitelist the ports first:
`sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp`).

Daily lifecycle (idempotent; `make help` is the default target):

```bash
make start     # host run: rebuilds web, starts api+web, waits for health,
               # + installs/enables systemd --user units for boot autostart
make stop      # stop the host run + remove boot autostart
make restart   # rebuild web + restart the host run (keeps autostart)
make status    # unit state + API health          make logs  # follow logs
```

Docker equivalents (same ports, so only one run at a time — starting one
best-effort stops the other):

```bash
make docker-dev     # dev stack: builds, starts, waits for API health, prints URLs
make docker-start   # prod stack: migrations run in the API container on boot,
                    # + installs/enables a systemd --user unit for boot autostart
make docker-stop    # stop the stack + remove boot autostart
make docker-status  # compose ps + API health    make docker-logs  # follow logs
```

- `make start` / `make docker-dev` / `make docker-start` auto-create `.env`
  from `.env.example` when it is missing (an existing `.env` is never
  overwritten — secrets stay local).
- Boot autostart requires linger (`loginctl enable-linger $USER`).
- Host prerequisites: API venv (`cd apps/api && python3 -m venv .venv &&
  . .venv/bin/activate && pip install -r requirements.txt`) and web deps
  (`npm ci`); `make start` fails fast with a hint when they are missing.
- After editing `.env`, recreate the run (`make restart` for host,
  `make docker-dev` for compose) — a restart alone keeps the old
  configuration (systemd loads env at service start).
- Data persists in `./data` (host run) or the `timeline-data` Docker volume
  (`docker compose down -v` removes it).

## Health

`curl http://127.0.0.1:8124/healthz` → `{"status":"ok",...}` (the web server
proxies it at `http://127.0.0.1:8123/healthz` too). The response self-diagnoses:
`llm_configured` (smart-input parsing has a key), `telegram`
(`configured|not_configured|error`), `scheduler` (reminder engine).

## Privacy

- All data stays local: SQLite in the `timeline-data` volume (compose) or
  `./data` (native run). Outbound traffic is only Telegram bot polling/messages
  and LLM parse calls (event text only — voice is transcribed locally, audio
  never leaves the machine).
- **The app has no auth and binds `0.0.0.0` by design** — anyone on your LAN can
  read/write events. Trusted LAN only; never expose to the public internet. Use
  the Telegram bot for anywhere access.
- Secrets live only in the local, gitignored `.env` — never commit or paste them.

## Configuration

Every key is documented with placeholders in [`.env.example`](.env.example) —
copy it to `.env` and fill in local values. The essentials:

| Key | Purpose |
|-----|---------|
| `LLM_API_KEY`, `LLM_MODEL` | JoinGonka (OpenAI-compatible) key + model for AI event parsing (`LLM_BASE_URL` defaults to the JoinGonka endpoint) |
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_USER_IDS` | Comma-separated allowlist of Telegram user ids (legacy single `TELEGRAM_USER_ID` also works) |
| `STT_VOXTYPE_PATH`, `STT_MODEL_PATH`, `STT_MAX_SECONDS` | Local voice transcription (voxtype/whisper.cpp, host runs only) |
| `EMAIL_ENABLED`, `SMTP_HOST/PORT/USER/PASS/FROM/TO` | Optional email reminders (feature-flag, off by default) |

Local knobs (bind host/port, data/log/backup dirs, timezone, quiet hours) are
documented in `.env.example` and the comments in `docker-compose.yml`.

## Troubleshooting

- **Stack won't start / `.env` missing** — `make start` / `make docker-dev` /
  `make docker-start` copy `.env.example` → `.env` automatically when it's
  missing; fill in real values and re-run. Docker only reads `.env` when
  containers are created, and systemd only at service start, so re-run
  `make restart` / `make docker-dev` after editing it.
- **"Parsing is unavailable" / `llm_configured:false` in healthz** — no real
  `LLM_API_KEY`/`LLM_MODEL` in `.env` (`.env.example` ships `changeme`
  placeholders). Set real values and recreate (`make restart` / `make docker-dev`).
- **Bot not replying** — set a real `BOT_TOKEN` (from @BotFather) and allowlist
  your Telegram id in `TELEGRAM_USER_IDS`. The bot is DM-only and ignores
  non-allowlisted ids; healthz shows `telegram: not_configured` without a token.
- **Voice messages in Docker** — the API image ships no voxtype/ffmpeg, so voice
  is not transcribed in the compose stack (the bot says so explicitly and points
  at `/add <text>`). Voice requires the host run (`make start`, voxtype +
  ffmpeg installed — Omarchy: Install > AI > Dictation).
- **Event times off by hours (e.g. submitted 2:50pm, scheduled 19:19)** — `TZ`
  in `.env` is still `UTC` while you live elsewhere. Telegram/voice parses
  stamp `TZ`, so set it to your local IANA zone (e.g. `TZ=America/New_York`)
  and restart (`make restart` — systemd reads `.env` at service start).

## Backup & restore

The API ships a backup module that dumps the SQLite DB and prunes older dumps
(keeps the newest `TIMELINE_BACKUP_KEEP`, default 30) — see
`apps/api/app/backup.py`. In the compose stack dumps land on the host in the
gitignored `./backups/` directory (bind-mounted at `/data/backups` in the
container), so they survive `make docker-stop` and even `docker compose down -v`:

```bash
docker compose exec api python -m app.backup backup        # dump now (also: list)
make docker-stop                                           # never restore into a live DB
docker compose run --rm api python -m app.backup restore /data/backups/<file>.db
make docker-dev                                            # start again
```

`docker compose exec api python -m app.backup list` shows the stored dumps;
on the host they are simply files in `./backups/`. The compose stack pins
`TIMELINE_BACKUPS_DIR=/data/backups` (overriding the host-relative value in
`.env`, which is only meaningful for native runs).

## Repository layout

```
apps/web/          # Web UI — React + TypeScript + Tailwind (Vite)
apps/api/          # Backend — FastAPI + SQLAlchemy 2.0 + Alembic; SQLite (WAL)
packages/shared/   # Shared contracts — event JSON schema v1 + enums
```

## Stack & architecture

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) +
  [TypeScript](https://www.typescriptlang.org/), styled with
  [Tailwind CSS](https://tailwindcss.com/); API in
  [FastAPI](https://fastapi.tiangolo.com/) + SQLAlchemy 2.0 + Alembic on SQLite.
- Strict core/UI split: `src/core/**` is pure business logic (no React, no DOM)
  with **100% Vitest coverage enforced**; `src/ui/**` is a thin, dumb view layer.

## Development

```bash
npm ci                      # install web dependencies
npm run dev                 # Vite dev server (0.0.0.0:8123)
npm test / npm run test:coverage / npm run build / npm run lint
cd apps/api && make lint typecheck test migrate dev   # ruff / mypy / pytest / alembic / uvicorn
```

## Project documents

- [`manifest.md`](manifest.md) — project charter / intent
- [`milestone.md`](milestone.md) — milestone records (M0–M9)
- [`project-state.md`](project-state.md) — current state and progress
- [`ROADMAP.md`](ROADMAP.md) — v2 / post-v1 stretch goals
- [`CHANGELOG.md`](CHANGELOG.md) — versioned change log
