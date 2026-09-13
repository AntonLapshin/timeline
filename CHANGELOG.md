# Changelog

All notable changes to **timeline** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Event CRUD + summary + seed (issue #15):** the API now exposes event CRUD
  (`POST`/`GET`/`PATCH`/`DELETE /api/events` and `GET /api/events/{id}`) with
  Pydantic validation mirroring the shared event schema v1 (title length,
  priority/channel enums, reminder-offset pattern), plus
  `GET /api/summary?month=YYYY-MM` which counts active event occurrences in a
  month grouped by priority using recurrence expansion. A pure
  `apps/api/app/summary.py` module computes the counts (month interpreted in
  each event's timezone; recurrent events contribute one count per occurrence);
  thin `apps/api/app/routes.py` handlers wire it to the DB-I/O layer
  (`apps/api/app/crud.py`). Seed data (HRA quarterly, a one-time 'series next
  June', and a check-up) is provided by `apps/api/app/seed.py`, inserted on
  first run via the app lifespan (configurable with `TIMELINE_SEED`, default
  on) or via `python -m app.seed` / `make seed`; seeding is idempotent. Data
  still lands in `./data/` (gitignored), loopback-only, no auth. pytest covers
  CRUD, summary counts, and seed; ruff + mypy pass.
- **Recurrence expansion (issue #14):** a pure `apps/api/app/recurrence.py`
  module expands the next `n` concrete occurrences of an event via
  `dateutil.rrule` (daily/weekly/monthly/quarterly/yearly/custom RFC 5545
  rules), with correct timezone handling (event tz vs stored UTC, DST-aware)
  and all-day events anchored date-only at local midnight so they never drift
  across DST. `next_occurrences(event, n, after=...)` materializes results on
  read (returning UTC `Occurrence`s with stable `occurrence_id`s and per-
  occurrence ends) and caches them per (rrule, start, tz, all-day, end, n,
  after) so repeated reads don't recompute (`clear_cache()` for edits/tests).
  Edge cases covered by pytest: DST spring-forward, leap day, quarterly drift,
  no-end-date recurrences, and a 'series next June' one-time event; one-time
  events (no rrule) yield a single occurrence. Adds `python-dateutil` (and
  `types-python-dateutil` for mypy) to the API deps; ruff + mypy pass.
- **tz / locale / quiet hours / license (issue #9):** owner-confirmed defaults
  (UTC timezone, `en-US` locale, no quiet hours, MIT license) are now
  documented and wired into the API settings. `apps/api/app/config.py` gains
  `tz`, `locale`, `quiet_hours_start` and `quiet_hours_end` fields (defaults
  `UTC` / `en-US` / disabled), read from `TZ`, `LOCALE`, `QUIET_START` and
  `QUIET_END` env vars; `.env.example` documents all four. A new `LICENSE`
  (MIT) file is added for the public repo. pytest covers the settings defaults,
  env overrides and blank-as-disabled quiet-hours handling; ruff + mypy pass.
- **Domain models + migrations (issue #13):** full SQLAlchemy domain model in
  `apps/api` — `Event` (one_time/recurrent, tz, all-day, priority, tags, source,
  status, rrule), `Reminder` (channels, offsets, remind_time_of_day,
  repeat_until_ack, snooze_allowed, quiet_hours), `DeliveryLog` (event_id,
  occurrence_id, offset, status, timestamps) and `TelegramInbound` (message/voice
  metadata, parsed draft, status) — alongside the existing `AppConfig`. A new
  Alembic migration `0002` creates all tables on SQLite (WAL), upgradeable from
  the existing `0001_initial`. Enum values mirror `packages/shared` (EventStatus,
  EventSource, EventType, EventPriority, EventChannel) via `app/enums.py` so the
  wire format stays in one place. pytest covers model creation, defaults,
  relationships and the full migration upgrade from a clean DB; ruff + mypy pass.
- Initial React + Tailwind + TypeScript scaffold (Vite).
- Core/UI separation with `src/core` (business logic) and `src/ui` (thin views).
- Vitest setup enforcing 100% coverage on `src/core/**/*.ts`.
- Initial demo panel rendering project name / status / demo info.
- **Local run paths (issue #2):** `docker-compose.yml` (web + api, loopback
  only, SQLite volume) for dev, `systemd/timeline.service` example unit
  (systemd --user daily driver, `Restart=on-failure`, bound to
  `127.0.0.1:8123`), plus `apps/web/Dockerfile` and `apps/api/Dockerfile`.
  README documents both paths and the one-command start; no secrets in any
  committed file (env comes from local `.env` / `.env.example`).

### Changed

- **Monorepo layout (issue #1):** moved the web app to `apps/web`, added
  `apps/api` (FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic) and
  `packages/shared` (event JSON schema v1), with npm workspaces at the root.
- **Backend skeleton:** `apps/api` boots a minimal FastAPI app with a `/healthz`
  endpoint, SQLite (WAL) wiring, and an initial Alembic migration creating the
  `app_config` table.
- **Shared contracts:** `packages/shared` holds the event JSON schema v1 plus
  the enum constants shared by web and API.
- **Tooling gates:** ruff, mypy, pytest for `apps/api`; eslint `max-warnings 0`;
  pre-commit + gitleaks; Vitest coverage gate enforcing 100% on
  `src/core/**/*.ts`; CI runs backend + web checks and a gitleaks secret scan.
- **Hygiene:** `.gitignore` covers `.env`, `data/`, `backups/`, `*.db*`, audio
  and logs; `.env.example` added with placeholders only (no secrets).
- **Need-owner access issues (issue #3):** filed six `need-owner` GitHub issues
  (#5–#10) covering `natalies-corner` access, JoinGonka LLM config, Telegram bot,
  email decision, tz/locale/quiet-hours/license, and voxtype availability. Each
  uses the What/Why/Where(`.env`)/Fallback template with `need-owner` +
  `pi:blocked` labels; no real secrets are committed (secrets go to local
  `.env` only).
