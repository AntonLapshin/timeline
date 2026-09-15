# timeline — Project State

> Current state and progress. Updated by the auto-pi loop as work is done.

## Status

**In progress (M5 — Telegram inbound + local STT + AI parsing).**
M1 (repo/scaffolding/tooling/local run paths/need-owner issues), M2 (core
domain), M3 (full Web UI: timeline/calendar/summary/drawer/wizard/
smart-input/search/theme — merged via #23-#60) are fully implemented and
merged. M4 (reminder engine + Telegram outbound) is **fully done**: M4-T1
(persistent APScheduler jobstore, #57/#58), M4-T2 (Telegram outbound sender
with Ack/Snooze/Delete, #55/#59), and M4-T3 (per-event reminder config +
quiet-hours digest + email feature-flag sender + delivery-log/preview UI +
tests) merged via #61/#62/#63/#64/#65/#67/#68. GitHub Pages is **enabled**
(owner action, #49) — the `Deploy to GitHub Pages` workflow on `main` is
green and the demo URL `https://antonlapshin.github.io/timeline/` returns
HTTP 200. The `CI` workflow passes independently.

The `Deploy to GitHub Pages` CI workflow is now **passing** — GitHub Pages is
enabled (owner action) and the demo URL is live; issue #49 is closed. The `CI`
workflow (build/lint/test/coverage) passes independently.
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

M3 — next batch (merged this cycle):
- [x] #37 #M3-T2 — Summary bar: events this month by priority, next 7 days, overdue highlight (merged via #40).
- [x] #38 #M3-T2B — Event drawer: next occurrences + reminder preview (merged via #43).
- [x] #39 #M3-T3A — 3-step create/edit wizard: What/When → Recurrence → Priority & Reminders (merged via #42; incl. `c` shortcut + wizard tests).

M3 — current batch (merged this cycle):
- [x] #46 #M3-T3B — Search/filter events + `/=search` shortcut (merged via #50).
- [x] #47 #M3-T3C — Smart-input box calling /parse (merged via #52).
- [x] #48 #M3-T3D — Dark/light theme toggle + responsive polish (merged via #53).
- [x] #51 — Add missing tests for PR #50 (merged via #54).

M3 — remaining slice (merged this cycle):
- [x] #56 #M3-T4 — Component Showcase files + Playwright smoke test (merged via #60).

M4 — reminder engine (merged this cycle):
- [x] #57 #M4-T1 — APScheduler persistent jobstore + at-least-once scheduling (merged via #58).
- [x] #55 #M4-T2 — Telegram outbound reminder sender with Ack/Snooze/Delete buttons (merged via #59).
- [x] #62 #M4-T3A — Wire quiet-hours + per-event reminder config into scheduler delivery (merged via #64).
- [x] #61 #M4-T3B — Email reminder sender behind feature flag (merged via #65).
- [x] #63 #M4-T3C — Delivery log + reminder preview UI in web app (merged via #67).
- [x] #66 — Add missing test for telegram_outbound event-None branch (merged via #68).

M5 — Telegram inbound + STT + AI parsing (merged this cycle):
- [x] #69 #M5-T1 — Telegram inbound bot: DM-only /add /today /upcoming /low /ask (merged via #72).
- [x] #70 #M5-T3 — POST /api/events/parse: JoinGonka OpenAI-compatible AI parsing (merged via #73).
- [x] #71 #M5-T2 — Local STT: Telegram voice → whisper.cpp, 2-min cap, no audio leaves machine (merged via #74).

M5 — remaining slice + M6 hardening (planned this turn, `pi:ready`):
- [ ] #75 #M5-T4A — Telegram draft flow: /add → parse → Save/Edit/Discard buttons (pi:ready, p1).
- [ ] #76 #M5-T4B — Parse eval set (20 samples) + redacted logs by default (pi:ready, p2).
- [ ] #77 #M6-T1 — Omarchy hardening: loopback bind guard, systemd enable, log rotation, /healthz (pi:ready, p1).
- [ ] #M6-T2 — Nightly SQLite dump + backups rotation + one-command restore; README runbook (planned on a later PM turn).
- [ ] #M6-T3 — Secrets hygiene audit: gitleaks CI, clean .env.example, no IDs/keys in docs; README privacy disclosure (planned on a later PM turn).

M1 (owner-in-the-loop):
- [x] #5 — natalies-corner access / local path (resolved & closed; reference at `/home/monarch/ws/natalies-corner`).
- [x] #10 — voxtype install / confirm (resolved & closed; voxtype 1.0.1 + base-en model present).
- [ ] #7 — Telegram bot + BOT_TOKEN / TELEGRAM_USER_ID (pi:blocked; owner input invalid — token leaked publicly, needs rotation via @BotFather + numeric user id + polling OK; re-routed to owner).
- [x] #9 — tz / locale / quiet hours / license (MIT?) (pi:ready; owner confirmed defaults).
- [ ] #6 — JoinGonka LLM_BASE_URL / LLM_MODEL / API key (pi:blocked, p1).
- [ ] #8 — Email decision for v1 (SMTP/Resend or skip) (pi:blocked, p2).

Need-owner (blocked on owner input; do not block M3/M4 code work):
- [x] #49 — Enable GitHub Pages (Actions source) so the demo URL goes live (resolved & closed; Pages enabled, deploy workflow green, demo URL HTTP 200).

Further milestones (M5 Telegram inbound/STT/AI, M6 hardening/backups, M7
polish/docs) — M5 batch #69/#70/#71 planned this turn (`pi:ready`); remaining
M5-T4 and M6/M7 will be planned on later PM turns.

## Changelog (CHANGELOG.md)

See CHANGELOG.md for the detailed history.
