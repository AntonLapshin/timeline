# timeline — Project State

> Current state and progress. Updated by the auto-pi loop as work is done.

## Status

**In progress (M3 — Web UI: timeline, calendar, wizard, smart-input).**
M1 (repo/scaffolding/tooling/local run paths/need-owner issues), M2 (core
domain: models+migrations, recurrence expansion, CRUD+summary+seed), and M3-T1
(app shell + Timeline + Calendar month/week/agenda views) are fully
implemented and merged. The M3 next batch (summary bar + event drawer +
create/edit wizard) is now `pi:ready` and in flight.
Owner-gated need-owner issues: #5 (natalies-corner access) and #10 (voxtype)
are **resolved and closed** — the owner cloned natalies-corner to
`/home/monarch/ws/natalies-corner` (local reference), and voxtype 1.0.1 is
confirmed installed with the whisper.cpp base-en model present. #6 (JoinGonka),
#7 (Telegram), and #8 (email) still await owner input (secrets/decisions) and
are `pi:blocked` need-owner issues. None of these block M3.

## What's here

- Vite + React + TypeScript + Tailwind project scaffold (apps/web).
- Monorepo: `apps/api` (FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic, SQLite
  WAL under `./data`, loopback-only `/healthz`), `packages/shared` (event JSON
  schema v1 + enums), npm workspaces at root.
- API domain complete: `Event`/`Reminder`/`DeliveryLog`/`TelegramInbound`/
  `AppConfig` models + Alembic migrations; `dateutil.rrule` recurrence expansion
  with tz/all-day/DST/leap/quarterly-drift handling and `next_occurrences`;
  event CRUD + `GET /api/summary?month=YYYY-MM`; idempotent seed data (HRA
  quarterly, series next June, check-up). pytest covers all of it.
- Tooling gates: ruff, mypy, pytest, eslint max-warnings 0, pre-commit +
  gitleaks, Vitest 100% coverage on `src/core/**/*.ts`; CI runs all + secret scan.
- Local run paths: `docker-compose.yml` (dev) + `systemd/timeline.service`
  example bound to `127.0.0.1:8123`.
- `.gitignore` covers `.env`, `data/`, `backups/`, `*.db*`, audio, logs;
  `.env.example` placeholders only (no secrets).
- Manifest (M1–M7) and project-state tracked in-repo.

## Next steps (planned issues)

M3 — Web UI (current batch):
- [x] #20 #M3-CORE — Web UI foundation: core logic + services + context injection + atomic scaffold (merged via #23).
- [x] #21 #M3-T1A — App shell + Timeline view (grouped month/week, infinite scroll, priority/tag styling, recurrence badge) (merged via #25).
- [x] #22 #M3-T1B — Calendar view (split by PM note into #27/#28/#29; closed).
- [x] #27 #M3-T1B-1 — API per-occurrence endpoint GET /api/events/occurrences?month=YYYY-MM (merged via #30).
- [x] #28 #M3-T1B-2 — Calendar core + month grid + day drawer (merged via #32).
- [x] #29 #M3-T1B-3 — Calendar week grid + agenda list (merged via #33).
- [x] #24 — Add missing tests for PR #23 (apiClient network-rejection path) (merged via #34).
- [x] #26 — Add missing tests for PR #25 (AppShell view-switcher + summary slot) (merged via #35).
- [x] #31 — Add missing tests for PR #30 (occurrences December rollover) (merged via #36).

M3 — next batch (planned this turn):
- [ ] #37 #M3-T2 — Summary bar: events this month by priority, next 7 days, overdue highlight (pi:ready, p1).
- [ ] #38 #M3-T2B — Event drawer: next occurrences + reminder preview (pi:ready, p2).
- [ ] #39 #M3-T3A — 3-step create/edit wizard: What/When → Recurrence → Priority & Reminders (pi:ready, p1).

Remaining M3 slices (planned on later PM turns): smart-input + search/filter +
dark/light + keyboard shortcuts (M3-T3 rest), atomic Showcase files + Playwright
smoke (M3-T4).

M1 (owner-in-the-loop):
- [x] #5 — natalies-corner access / local path (resolved & closed; reference at `/home/monarch/ws/natalies-corner`).
- [x] #10 — voxtype install / confirm (resolved & closed; voxtype 1.0.1 + base-en model present).
- [ ] #7 — Telegram bot + BOT_TOKEN / TELEGRAM_USER_ID (pi:blocked; owner input invalid — token leaked publicly, needs rotation via @BotFather + numeric user id + polling OK; re-routed to owner).
- [x] #9 — tz / locale / quiet hours / license (MIT?) (pi:ready; owner confirmed defaults).
- [ ] #6 — JoinGonka LLM_BASE_URL / LLM_MODEL / API key (pi:blocked, p1).
- [ ] #8 — Email decision for v1 (SMTP/Resend or skip) (pi:blocked, p2).

Further milestones (M4 reminder engine, M5 Telegram inbound/STT/AI, M6
hardening/backups, M7 polish/docs) will be planned on later PM turns.

## Changelog (CHANGELOG.md)

See CHANGELOG.md for the detailed history.
