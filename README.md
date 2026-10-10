# timeline

**timeline** is a personal, local-first global schedule that remembers everything:
capture one-time and recurrent future events in under 30 seconds via a local web UI
or Telegram (text, deterministically parsed), view them on a timeline + calendar at home on
localhost, and get configurable Telegram reminders from everywhere. Private by
construction — public code, locally-stored data.

Live demo: **[https://AntonLapshin.github.io/timeline/](https://AntonLapshin.github.io/timeline/)**

## Quickstart

Host run (native) — on a clean checkout, bootstrap first (idempotent):

```bash
make install   # .env + API venv (.venv + pip reqs) + npm ci; `make setup` is an alias
make diagnose  # optional: check host prerequisites (never installs, never fails)
make start     # build web + start api :8124 / web :8123 + boot autostart
```

`make install` auto-creates `.env` from `.env.example` when missing (an
existing `.env` is never overwritten) — fill in your local secrets in `.env`
(`BOT_TOKEN`, `TELEGRAM_USER_IDS`, …) before or after installing, then
re-run `make start`.

Or with Docker (requires Docker access for your user — member of the `docker`
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
make install   # one-time bootstrap (re-run when deps change); alias: make setup
make diagnose  # check python/node/.env/venv/vite/units/health
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
- Host prerequisites (Python 3.11+, Node/npm, API venv, web deps) are
  bootstrapped by `make install` (`make setup` is the same). `make start`
  fails fast with a hint (`run 'make install'`) when the venv or
  `node_modules` is missing; `make diagnose` shows every prerequisite at
  once. Manual fallback (what `make install` does for you):
  `cd apps/api && python3 -m venv .venv && . .venv/bin/activate &&
  pip install -r requirements.txt`, plus `npm ci` at the repo root.
- After editing `.env`, recreate the run (`make restart` for host,
  `make docker-dev` for compose) — a restart alone keeps the old
  configuration (systemd loads env at service start).
- Data persists in `./data` (host run) or the `timeline-data` Docker volume
  (`docker compose down -v` removes it).

## Health

`curl http://127.0.0.1:8124/healthz` → `{"status":"ok",...}` (the web server
proxies it at `http://127.0.0.1:8123/healthz` too). The response self-diagnoses:
`telegram` (`configured|not_configured|error`), `scheduler` (reminder engine).

## Privacy

- All data stays local: SQLite in the `timeline-data` volume (compose) or
  `./data` (native run). Outbound traffic is only Telegram bot polling/messages
  (event text only).
- **The app has no auth and binds `0.0.0.0` by design** — anyone on your LAN can
  read/write events. Trusted LAN only; never expose to the public internet. Use
  the Telegram bot for anywhere access.
- Secrets live only in the local, gitignored `.env` — never commit or paste them.

## Configuration

Every key is documented with placeholders in [`.env.example`](.env.example) —
copy it to `.env` and fill in local values. The essentials:

| Key | Purpose |
|-----|---------|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_USER_IDS` | Comma-separated allowlist of Telegram user ids (legacy single `TELEGRAM_USER_ID` also works) |
| `EMAIL_ENABLED`, `SMTP_HOST/PORT/USER/PASS/FROM/TO` | Optional email reminders (feature-flag, off by default) |

Local knobs (bind host/port, data/log/backup dirs, timezone, quiet hours) are
documented in `.env.example` and the comments in `docker-compose.yml`.

## Troubleshooting

- **`make start` says "API venv missing" / "web dependencies missing"** —
  you skipped the bootstrap: run `make install` (idempotent: creates the
  venv, installs `apps/api/requirements.txt`, runs `npm ci`), then
  `make start` again. `npm install` alone is not enough — the API venv is a
  separate prerequisite. `make diagnose` prints the status of every
  prerequisite (python/node/.env/venv/vite/units/health) without changing
  anything.
- **Stack won't start / `.env` missing** — `make install` / `make start` /
  `make docker-start` copy `.env.example` → `.env` automatically when it's
  missing; fill in real values and re-run. Docker only reads `.env` when
  containers are created, and systemd only at service start, so re-run
  `make restart` / `make docker-dev` after editing it.
- **Bot not replying** — set a real `BOT_TOKEN` (from @BotFather) and allowlist
  your Telegram id in `TELEGRAM_USER_IDS`. The bot is DM-only and ignores
  non-allowlisted ids; healthz shows `telegram: not_configured` without a token.
- **Event times off by hours (e.g. submitted 2:50pm, scheduled 19:19)** — `TZ`
  in `.env` is still `UTC` while you live elsewhere. Telegram text parses
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
make install              # bootstrap everything (.env + API venv + pip reqs + npm ci)
make diagnose             # check prerequisites without changing anything
npm run dev               # Vite dev server (0.0.0.0:8123)
npm test / npm run test:coverage / npm run build / npm run lint
cd apps/api && make lint typecheck test migrate dev   # ruff / mypy / pytest / alembic / uvicorn
```

## Project documents

- [`manifest.md`](manifest.md) — project charter / intent
- [`milestone.md`](milestone.md) — milestone records (M0–M9)
- [`project-state.md`](project-state.md) — current state and progress
- [`ROADMAP.md`](ROADMAP.md) — v2 / post-v1 stretch goals
- [`CHANGELOG.md`](CHANGELOG.md) — versioned change log
