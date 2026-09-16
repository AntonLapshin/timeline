# timeline


**timeline** is a personal, local-first global schedule that remembers everything:
capture one-time and recurrent future events in under 30 seconds via a local web UI
or Telegram (text/voice, AI-parsed), view them on a timeline + calendar at home on
localhost, and get configurable Telegram reminders from everywhere. Private by
construction — public code, locally-stored data.


## Repository layout (monorepo)

```
apps/web/          # Web UI — React + TypeScript + Tailwind (Vite). src/core (pure, 100% Vitest coverage) + src/ui (thin views).
apps/api/          # Backend — FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic. SQLite (WAL) under ./data (gitignored).
packages/shared/   # Shared contracts — event JSON schema v1 + enums used by web and API.
```

### Web (apps/web)

```bash
npm ci
npm run dev          # Vite dev server (127.0.0.1:8123)
npm run lint         # eslint --max-warnings 0
npm test             # Vitest (all workspaces)
npm run test:coverage  # Vitest coverage gate: 100% on src/core/**/*.ts
npm run build        # tsc + vite build
npm run test:e2e     # Playwright smoke (boots dev server on 127.0.0.1:8123)
```

> **Showcase gallery (dev):** open `http://127.0.0.1:8123/?showcase=1` to view a
> dev-only gallery of every UI component and its key states, with fake services
> injected via context (no backend required).

### API (apps/api)

```bash
cd apps/api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
make lint            # ruff
make typecheck       # mypy
make test            # pytest
make migrate         # alembic upgrade head (creates ./data/timeline.db)
make dev             # uvicorn on 127.0.0.1:8123
```

Health probe: `GET http://127.0.0.1:8123/healthz` → `{"status": "ok", "uptime_seconds": N}`.

### Secrets & data (public repo hygiene)

- Copy `.env.example` → `.env` and fill local values; `.env` is gitignored.
- `./data/`, `./backups/`, `*.db*`, audio and logs are gitignored.
- Pre-commit hooks (ruff, mypy, eslint, gitleaks) via `.pre-commit-config.yaml`.

### Local run paths

Two ways to run timeline locally, both bound to loopback only
(`127.0.0.1`, **no `0.0.0.0`**) because the app has no auth:

> **Exposing to the LAN is opt-in only (issue #97).** To access the web app
> from your host system / another machine on your LAN you must explicitly set
> `TIMELINE_ALLOW_NON_LOOPBACK=1` **and** `TIMELINE_HOST=0.0.0.0` (and whitelist
> the port in the firewall). This exposes the app to the LAN with **no auth** —
> anyone on the network can read/write events — so it stays off by default.
> See [Host-system / LAN access](#host-system--lan-access-opt-in-issue-97) below.

**1. Docker Compose (recommended for dev).** One command starts web + api and
keeps the SQLite database in a named volume:

```bash
cp .env.example .env   # fill local values (secrets stay local)
docker compose up --build
# Web:  http://127.0.0.1:8123
# API:  http://127.0.0.1:8124/healthz  →  {"status": "ok"}
```

`scheduler` / `bot` services will be added to the compose stack in later
milestones. `docker compose down` stops the stack; data persists in the
`timeline-data` volume (`docker compose down -v` removes it).

**2. systemd --user service (daily driver).** Native run that autostarts on
login and restarts on failure (`Restart=on-failure` + `RestartSec=5`). The
example unit runs the API bound to `127.0.0.1:8123` and refuses to start if
the bind host is ever changed to a non-loopback address (fail-closed guard):

```bash
mkdir -p ~/.config/systemd/user
cp systemd/timeline.service ~/.config/systemd/user/
# edit the paths (USER, clone location, venv) in the copied unit
systemctl --user daemon-reload
systemctl --user enable --now timeline.service   # enable + start (autostarts on login)
systemctl --user start timeline                  # start (already enabled)
systemctl --user stop timeline                   # stop
systemctl --user status timeline                 # status
journalctl --user -u timeline -f                 # follow logs
curl http://127.0.0.1:8123/healthz               # health probe
```

The API log is written to `./data/timeline.log` and bounded by the committed
`systemd/timeline.logrotate` config (5 MB × 5 files, compressed) and a Python
`RotatingFileHandler` (`TIMELINE_LOG_FILE` / `TIMELINE_LOG_MAX_BYTES` /
`TIMELINE_LOG_BACKUP_COUNT`).

#### Runbook — systemd daily-driver path (start / stop / logs / backup / restore / update)

The native systemd `--user` path is the daily driver. Everything below assumes
you installed `systemd/timeline.service` (and, for backups,
`systemd/timeline-backup.service` + `systemd/timeline-backup.timer`) into
`~/.config/systemd/user/` and edited the `USER` / clone / venv paths.

**Start / stop / status:**

```bash
systemctl --user enable --now timeline.service   # enable + start (autostarts on login)
systemctl --user start timeline                  # start (already enabled)
systemctl --user stop timeline                   # stop
systemctl --user restart timeline                # restart
systemctl --user status timeline                 # status
curl http://127.0.0.1:8123/healthz               # health probe
```

**Logs:**

```bash
journalctl --user -u timeline -f                 # follow API logs
journalctl --user -u timeline-backup -f          # follow backup logs
```

**Backup (automatic nightly + manual):**

A nightly backup runs at 02:00 via `systemd/timeline-backup.timer` (a missed
run fires on next wake thanks to `Persistent=true`). It dumps the SQLite DB
into `./backups/` (gitignored) under a timestamped name and keeps the newest
`TIMELINE_BACKUP_KEEP` (default 30) — see `apps/api/app/backup.py`. To run one
now, or list / inspect stored backups:

```bash
cd apps/api && . .venv/bin/activate
python -m app.backup backup          # dump + rotate now
python -m app.backup list            # list stored backups (newest first)
systemctl --user list-timers timeline-backup   # next scheduled run
```

**Restore (one command):**

Stop the app, then restore the newest (or a chosen) backup into the live DB:

```bash
systemctl --user stop timeline
cd apps/api && . .venv/bin/activate
python -m app.backup restore backups/timeline-20260915-020000.db   # one-command restore
systemctl --user start timeline
```

Backups are verified round-trip (backup → restore → data intact) by the pytest
suite (`apps/api/tests/test_backup.py`).

**Update (pull + restart):**

```bash
cd <clone> && git pull
cd apps/api && . .venv/bin/activate && pip install -r requirements.txt
cd ../web && npm ci && npm run build
systemctl --user restart timeline
```

Both paths read secrets from the local `.env` (gitignored) — never from
committed files. See `systemd/timeline.service`, `systemd/timeline-backup.*`
and `docker-compose.yml` for details.

#### Host-system / LAN access (opt-in, issue #97)

By default the app binds to loopback only (`127.0.0.1`) and the fail-closed
startup guard **refuses** to start on any non-loopback host — because the app
has **no auth**. To access the web app from your host system or another machine
on your LAN, you must explicitly opt in **and** whitelist the port in the
firewall:

```bash
# 1. Opt in + bind to all interfaces (in .env or the systemd unit):
TIMELINE_HOST=0.0.0.0
TIMELINE_ALLOW_NON_LOOPBACK=1

# 2. Whitelist the port in the firewall (firewalld or ufw):
sudo firewall-cmd --permanent --add-port=8123/tcp && sudo firewall-cmd --reload
# or: sudo ufw allow 8123/tcp
```

Then open `http://<machine-ip>:8123` from the host system. If you use the
`systemd/timeline.service` unit, also change its `ExecStart` `--host` to
`0.0.0.0` and add `Environment=TIMELINE_ALLOW_NON_LOOPBACK=1`.

> **Security trade-off:** binding to `0.0.0.0` exposes the app to your LAN
> with **no auth** — anyone on the network can read and write events. This is
> why it is **opt-in only**; the default stays loopback-only and safe. Prefer
> keeping the app on `127.0.0.1` and using the Telegram interface for
> anywhere access.

---

### Omarchy quickstart (fresh machine → running app)

This is the end-to-end path to get **timeline** running on a fresh **Omarchy**
machine from scratch, as the daily-driver `systemd --user` service. It assumes
nothing is installed yet (no repo, no venv, no node_modules). The app ends up
serving the web UI at **http://127.0.0.1:8123** (loopback only, no auth).

**1. Prerequisites on Omarchy**

```bash
# Python 3.11+ and Node 20+ are expected on a stock Omarchy install. Verify:
python3 --version
node --version
npm --version
```

**2. Clone the repo**

```bash
git clone https://github.com/AntonLapshin/timeline.git ~/timeline
cd ~/timeline
```

**3. Set up the API (apps/api)**

```bash
cd apps/api
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
# (optional) apply any pending DB migrations:
make migrate
```

**4. Build the web app (apps/web)**

```bash
cd ../../apps/web
npm ci
npm run build
```

**5. Configure secrets — copy `.env.example` → `.env`**

```bash
cd ~/timeline
cp .env.example .env
# Edit .env and fill in your local values (Telegram bot token / user id,
# JoinGonka API key + model, optional SMTP). Secrets stay local — .env is
# gitignored and never committed.
```

**6. Install + start the systemd --user service**

```bash
mkdir -p ~/.config/systemd/user
cp systemd/timeline.service ~/.config/systemd/user/
# Edit the copied unit: set USER, the clone location (~/timeline), and the
# venv path (~/timeline/apps/api/.venv) in ExecStart / WorkingDirectory.
systemctl --user daemon-reload
systemctl --user enable --now timeline.service   # enable + start (autostarts on login)
```

**7. Verify**

```bash
systemctl --user status timeline                 # active (running)
curl http://127.0.0.1:8123/healthz               # {"status":"ok","uptime_seconds":N}
# Open http://127.0.0.1:8123 in a browser — the timeline web UI loads.
```

That's it — a fresh Omarchy machine now runs the full app at
`http://127.0.0.1:8123`. See the **Runbook** above for daily start/stop/logs/
backup/restore/update, and the **Environment variables** table below for every
knob the app reads.

---

### Environment variables

Every env key the app reads, grouped by concern. All keys are documented in
[`.env.example`](.env.example) with placeholders — copy that file to `.env` and
fill in your local values. **Never put real secrets in the repo, issues, or
PRs; they live in the local `.env` only.**

#### Local — host / port / data / log / backup / timezone

| Key | Purpose | Default |
|-----|---------|---------|
| `TIMELINE_HOST` | Loopback bind host (no auth). Set `0.0.0.0` only with the opt-in below | `127.0.0.1` |
| `TIMELINE_ALLOW_NON_LOOPBACK` | Explicit opt-in to bind `0.0.0.0`/LAN (exposes app, no auth) | `0` |
| `TIMELINE_PORT` | Web/API port | `8123` |
| `TIMELINE_DATA_DIR` | Directory where the SQLite DB lives (gitignored) | `./data` |
| `TIMELINE_DB_NAME` | SQLite database filename | `timeline.db` |
| `TIMELINE_WAL` | Enable SQLite WAL journal mode (`1` = on) | `1` |
| `TIMELINE_SEED` | Seed initial example events on first run (`1` = on) | `1` |
| `TIMELINE_LOG_FILE` | API log file (rotated, bounded); empty ⇒ stderr | `./data/timeline.log` |
| `TIMELINE_LOG_MAX_BYTES` | Max log file size before rotation | `5242880` (5 MB) |
| `TIMELINE_LOG_BACKUP_COUNT` | Rotated log files kept | `5` |
| `TIMELINE_BACKUPS_DIR` | Nightly SQLite backup directory (gitignored) | `./backups` |
| `TIMELINE_BACKUP_KEEP` | Number of rotated backups kept | `30` |
| `TZ` | IANA timezone for event parsing/display | `UTC` |
| `LOCALE` | Locale used for date formatting | `en-US` |
| `QUIET_START` | Quiet-hours start (`HH:MM`, 24h); empty = none | *(empty)* |
| `QUIET_END` | Quiet-hours end (`HH:MM`, 24h); empty = none | *(empty)* |

#### LLM extraction (JoinGonka / OpenAI-compatible)

| Key | Purpose | Default |
|-----|---------|---------|
| `LLM_BASE_URL` | OpenAI-compatible endpoint for AI event parsing | `https://gate.joingonka.ai/openai/v1` |
| `LLM_API_KEY` | LLM API key (local `.env` only, never committed) | *(none — parse unavailable)* |
| `LLM_MODEL` | LLM model name for JSON extraction | *(none)* |

#### Telegram (outbound + inbound)

| Key | Purpose | Default |
|-----|---------|---------|
| `BOT_TOKEN` | Telegram bot token from @BotFather (placeholder only) | *(none)* |
| `TELEGRAM_USER_ID` | Numeric Telegram user id for the single-user allowlist | *(none)* |

#### SMTP / email (optional, feature-flag — OFF by default in v1)

| Key | Purpose | Default |
|-----|---------|---------|
| `EMAIL_ENABLED` | Email feature flag (`1` = on; off means email is never sent) | `0` |
| `SMTP_HOST` | SMTP server host | *(none)* |
| `SMTP_PORT` | SMTP port (STARTTLS) | `587` |
| `SMTP_USER` | SMTP username | *(none)* |
| `SMTP_PASS` | SMTP password (secret) | *(none)* |
| `SMTP_FROM` | “From” address for reminder emails | *(none)* |
| `SMTP_TO` | Default “To” address for reminder emails | *(none)* |

#### Local STT (voxtype / whisper.cpp, local-only)

| Key | Purpose | Default |
|-----|---------|---------|
| `STT_VOXTYPE_PATH` | Path to the local voxtype binary for whisper.cpp transcription | `voxtype` (on PATH) |
| `STT_MODEL_PATH` | Local whisper model path; empty ⇒ voxtype default model | *(empty)* |
| `STT_MAX_SECONDS` | Max voice-message duration in seconds (2-min cap) | `120` |

---

### Local STT / voxtype reuse notes

Voice messages sent to the Telegram bot are transcribed **locally** — no audio
ever leaves the machine. The app reuses the **voxtype** install that ships with
Omarchy (`Install > AI > Dictation`) instead of bundling its own whisper.cpp
binary or model:

- **Reuse the existing voxtype install** — voxtype keeps its config and models
  under `~/.config/voxtype/config.toml` and `~/.local/share/voxtype/models/`.
  The app simply shells out to the `voxtype` CLI (`voxtype transcribe <wav>`),
  which loads the installed whisper model for you — no duplicate model download.
- **`STT_VOXTYPE_PATH`** — path to the `voxtype` binary. Defaults to `voxtype`
  on `PATH`. Set it to the absolute path of your local install (e.g. the one
  provisioned by Omarchy dictation) when it is not on `PATH`.
- **`STT_MODEL_PATH`** — optional path to a specific whisper model (e.g.
  `ggml-base.en.bin`). Leave empty to let voxtype use its installed default
  model. The default model is whisper.cpp **base/small (English)**, ~150 MB,
  which runs ~9–11× realtime on CPU.
- **Pipeline**: Telegram `voice.ogg` → `ffmpeg` → 16 kHz mono WAV →
  `voxtype transcribe` → text. If voxtype/whisper is unavailable the bot
  degrades gracefully (returns “unavailable” instead of crashing).
- **2-minute cap**: voice messages over `STT_MAX_SECONDS` (default `120`) are
  rejected before any conversion/transcription is attempted.

If voxtype is not installed, install it via Omarchy **Install > AI >
Dictation** (or confirm `voxtype --version` and that a model is present under
`~/.local/share/voxtype/models/`).

---

### Cost notes

The only paid, metered dependency is the **LLM extraction** path used by
`/parse` (web smart-input and Telegram text/voice drafts). It makes a single
JoinGonka (OpenAI-compatible) call per parse:

- **JoinGonka LLM cost** is on the order of **~$0.02 per 1M tokens** for the
  cheap JSON-capable models used for extraction (see `LLM_MODEL`). A typical
  single-event parse is a few hundred tokens, so per-event cost is fractions of
  a cent; even heavy daily use is well under a dollar a month.
- **Local STT is free and offline** — voxtype/whisper.cpp transcription runs
  entirely on the machine with no cloud API, no metering, and no network
  egress. Only the resulting text (not the audio) is sent onward for parsing.
- **Telegram is free** for bot polling + messaging; **email** is only used when
  `EMAIL_ENABLED=1` and incurs whatever your SMTP provider charges.

---

### Troubleshooting

#### App won't start

- **Bind guard refuses `0.0.0.0`/LAN host**: timeline has no auth, so startup
  fails closed if `TIMELINE_HOST` is not loopback-only. Set `TIMELINE_HOST` to
  `127.0.0.1` (or `localhost`/`::1`) in `.env` and restart — or, to expose the
  app to your LAN, explicitly opt in with `TIMELINE_ALLOW_NON_LOOPBACK=1`
  **and** `TIMELINE_HOST=0.0.0.0` (see [Host-system / LAN access](#host-system--lan-access-opt-in-issue-97)).
- **Port 8123 already in use**: another process is bound to `127.0.0.1:8123`.
  Find and stop it (`systemctl --user stop timeline`, `ss -ltnp | grep 8123`)
  or change `TIMELINE_PORT` in `.env` (and the copied `systemd/timeline.service`
  `ExecStart`/`Environment`).
- **Service fails on boot**: check `journalctl --user -u timeline -e` — the
  unit's `ExecStart`/`WorkingDirectory` paths (clone location, venv) must match
  your install; edit the copied `~/.config/systemd/user/timeline.service` and
  `systemctl --user daemon-reload`.

#### `/healthz` not responding

- `curl http://127.0.0.1:8123/healthz` should return `{"status":"ok","uptime_seconds":N}`.
- If it times out, confirm the service is active (`systemctl --user status
  timeline`) and bound (`ss -ltnp | grep 8123`). If nothing is listening, the
  app failed to start — see “App won't start” above.

#### Telegram reminders not arriving

- **Bot token / user id**: confirm `.env` has a real `BOT_TOKEN` (from
  @BotFather) and `TELEGRAM_USER_ID` (your numeric DM id). The bot is
  **DM-only** and enforces a **single-user allowlist** — messages to
  non-allowlisted ids are ignored.
- **Bot not running**: the bot polls from the API process; if the service isn't
  running, no reminders are sent. Check `journalctl --user -u timeline -f` for
  poll errors and that the token is valid.
- **Test**: send a message to your bot and watch the logs; use the web UI's
  “send test Telegram now” button in the reminder editor to verify end-to-end.

#### Voice not transcribing

- **voxtype not found**: set `STT_VOXTYPE_PATH` to the absolute path of the
  voxtype binary (or install via Omarchy **Install > AI > Dictation**).
- **ffmpeg missing**: the `ogg → wav` conversion needs `ffmpeg` installed.
- **Model missing**: confirm a whisper model exists under
  `~/.local/share/voxtype/models/`; set `STT_MODEL_PATH` if voxtype isn't
  finding it.
- **Message too long**: voice messages over `STT_MAX_SECONDS` (default 120 s)
  are rejected — send a shorter clip.

#### Backup / restore failure

- **Backup dir missing/wrong**: confirm `TIMELINE_BACKUPS_DIR` (default
  `./backups`) is writable and exists.
- **Restore**: stop the service first (`systemctl --user stop timeline`), then
  `python -m app.backup restore backups/timeline-<timestamp>.db`, then start
  again. Restoring into a live DB is not supported — stop before restoring.
- **Rotation**: `TIMELINE_BACKUP_KEEP` (default 30) prunes older backups; if
  backups seem to vanish, verify the timer ran
  (`systemctl --user list-timers timeline-backup`).


## Demo

Live demo: **[https://AntonLapshin.github.io/timeline/](https://AntonLapshin.github.io/timeline/)**

## Stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Vitest](https://vitest.dev/) for unit tests, with 100% coverage enforced on `src/core/**/*.ts`

## Getting started

```bash
npm install     # install dependencies
npm run dev     # start the dev server
```

## Scripts

| Script              | Purpose                                    |
|---------------------|--------------------------------------------|
| `npm run dev`       | Start the Vite dev server                  |
| `npm run build`     | Type-check (`tsc`) then build for production |
| `npm run preview`   | Preview the production build locally       |
| `npm run lint`      | Run ESLint                                 |
| `npm test`          | Run unit tests (Vitest)                    |
| `npm run test:coverage` | Run tests and enforce 100% core coverage |
| `npm run test:e2e`  | Run the Playwright smoke test (loopback 127.0.0.1:8123) |
| `npm run test:e2e:install` | Install the Playwright Chromium browser    |

## Architecture

The project enforces a strict **core / UI split** (plan.md §19.1):

- `src/core/**` — pure business logic, no React, no DOM. **100% test coverage is
  required here.**
- `src/ui/**` — thin, dumb view layer (components + view models). Contains no
  business logic; it only renders what `src/core` provides.

## Project documents

- [`manifest.md`](manifest.md) — project charter / intent (purpose, goals, milestones)
- [`milestone.md`](milestone.md) — milestone records (M0–M7) with completed items checked off
- [`project-state.md`](project-state.md) — current state and progress
- [`ROADMAP.md`](ROADMAP.md) — v2 / post-v1 stretch goals (out of scope for v1)
- [`CHANGELOG.md`](CHANGELOG.md) — versioned change log
