# timeline — Manifest

> Project charter / intent. This file is a living document maintained by the
> auto-pi PM persona as the project evolves. The milestones below are the
> backbone of the project: the PM plans issues against them.

**Status: in progress** (M1–M8 engineering complete + deployed as of
2026-09-16; owner feedback round filed as #106–#109 on 2026-09-17 and planned
as milestone **M9** — runtime wiring for the Telegram bot/scheduler, UI fixes,
smart-input parse errors, Docker/Makefile. M9-T1–T3 merged (#114/#115/#117);
M9-T4–T6 merged (#124/#125/#126) on 2026-09-18; third batch filed 2026-09-18
as #127 (M9-T7 root Makefile dev/start/stop) and #128 (M9-T8 README
simplification) — the last non-owner-gated M9 sub-issues. Owner-gated items
remain: UAT M7-T3 is `pi:needs-human` #95 and the email decision is
`need-owner` #8.)

**completed_at (M1–M8):** 2026-09-16T04:50:00Z — reopened for M9 on
2026-09-17 (owner feedback #106–#109).

## Purpose

A personal, local-first global schedule that remembers everything: capture one-time and recurrent future events in under 30 seconds, view them on a timeline + calendar at home on localhost, add them from anywhere via Telegram text/voice (AI-parsed), and get configurable Telegram reminders from everywhere — all private by construction with public code and locally-stored data on the Omarchy machine.

## Goals

- Never forget: capture any future or recurrent event in under 30 seconds via Web UI or Telegram (text/voice).
- See everything at home and on the LAN: timeline + calendar views, monthly counts, search/filter on a LAN-accessible web app (0.0.0.0:8123, no login) — exposing to the LAN without auth is part of the plan.
- Remind from anywhere: per-event configurable Telegram reminders (Telegram-first; email is a v1 feature-flag only), delivered outside home via Telegram cloud while the app polls from the home machine.
- Add from anywhere: Web form/wizard (home) plus Telegram text and local-voice input (anywhere), AI-parsed via a configurable JoinGonka direct call into structured event drafts that are confirmed before saving.
- Local & private by construction: public repo with only code/docs/prompts/schemas; data (./data) and secrets (.env) gitignored and never committed; web bound to 0.0.0.0 for LAN access without auth (part of the plan, trusted LAN only).
- Low maintenance on Omarchy: systemd --user service as daily driver (Compose for dev), SQLite, local nightly backups/rotation, one-command restore.

## Non-goals

- Multi-user / family sharing / collaboration (single local user only).
- Public-internet hosting, password login, TLS, tunnels, VPS, or domains — LAN web access without auth is part of the plan (trusted LAN only); public-internet exposure remains out of scope.
- Public sharing links.
- Mobile native apps (responsive web suffices for v1).
- Full email/calendar sync (Google Calendar import/export is ROADMAP-only).
- Email reminders in v1 (feature-flag only; Telegram-first).
- Cloud STT / cloud Whisper API — STT is local only (voxtype/whisper.cpp).
- LLM wrapper frameworks (LangChain/LiteLLM) — thin direct JoinGonka OpenAI-compatible fetch only.

## Success criteria

- [ ] Owner can CRUD events locally in under 30 seconds each and see timeline + calendar views with correct monthly summary counts.
- [ ] A critical test event pings Telegram at a T-1m test offset with Acknowledge/Snooze buttons; low-priority events send no proactive push and appear only on demand.
- [ ] A recurrent HRA-quarterly event expands correctly over 2 years (incl. DST/leap/quarterly drift), and a 'series next June' one-time event lands in the correct month view.
- [ ] 'HRA every quarter from Oct' via Telegram text and a voice message 'series season 2 next June low priority' (local STT) both produce correct AI drafts that Save and become visible in the web app.
- [ ] Reboot → systemd --user service auto-starts, catch-up reminder digest fires on wake, /healthz responds, and backup+restore round-trips successfully.
- [ ] Public repo is clean: gitleaks clean, no .env/data/audio/logs tracked, docs use placeholders only; daily use for a week with zero missed critical reminders in the test window.

## Milestones

### M1 — Public repo, scaffolding, Omarchy baseline

**Goal:** Stand up the public monorepo skeleton (web + api + shared) with tooling, localhost run paths, and all owner-in-the-loop access issues filed, so the project has a clean, runnable, secret-safe foundation.

**Scope:**
  - Create public GitHub repo `timeline`, push initial layout, .gitignore (.env, data/, backups/, *.db*, audio, logs), LICENSE (MIT pending issue), README, and .env.example with placeholders only.
  - Monorepo skeleton: apps/web (Vite+React+TS+Tailwind+showcase, atomic folders, context injection, src/core+src/ui), apps/api (FastAPI+SQLAlchemy+Alembic), packages/shared (event JSON schema v1).
  - Tooling gates: ruff, mypy, pytest, eslint (max-warnings 0), pre-commit + gitleaks, Vitest coverage gate on src/core.
  - Local run paths: docker-compose.yml (dev) + systemd/timeline.service example bound to 127.0.0.1:8123.
  - File need-owner issues #1-#7 (repo, natalies-corner access, JoinGonka base/model/key, Telegram bot+user id, tz/locale/quiet-hours, voxtype presence) — secrets only to local .env.

### M2 — Core domain: events, recurrence, local API, SQLite

**Goal:** Deliver the backend domain — event CRUD with RFC5545 recurrence expansion, timezone/all-day handling, summary counts, and seed data — fully tested and persisted locally.

**Scope:**
  - Models (AppConfig, Event, Reminder, DeliveryLog, TelegramInbound) + Alembic migrations on SQLite WAL.
  - dateutil.rrule occurrence expansion (daily/weekly/monthly/quarterly/yearly/custom) + tz/all-day handling; next_occurrences(n) materialized on read with caching.
  - CRUD endpoints + GET /api/summary?month=YYYY-MM; seed data (HRA quarterly, series next June, check-up).
  - pytest coverage incl. DST, leap, and quarterly-drift cases; data lands in ./data/ (gitignored).

### M3 — Web UI: timeline, calendar, wizard, smart-input

**Goal:** Deliver the localhost web app — timeline + custom calendar month/week/agenda views, summary header, 3-step create/edit wizard with smart-input, and search/filter — built with atomic design and context injection per the reference pattern.

**Scope:**
  - App shell (no login) with Timeline view (grouped by month/week, infinite scroll, priority/tag color+icon, recurrence badge) and Calendar view (custom Tailwind month/week/agenda grid + day drawer).
  - Summary bar (events this month by priority, next 7 days, overdue highlight) + event drawer with next occurrences and reminder preview.
  - 3-step create/edit wizard (What/When → Recurrence → Priority & Reminders) + smart-input box calling /parse + search/filter + dark/light + responsive + keyboard shortcuts (c=create, /=search).
  - Atomic folders (atoms/molecules/organisms/templates/pages) with services (apiClient, llmParse, dateFmt) injected via Context; every organism has a Showcase file.
  - Vitest 100% coverage of src/core (recurrence-format, summary-counts, parse-guards) + Playwright smoke on 127.0.0.1.

### M4 — Reminder engine + Telegram outbound

**Goal:** Deliver the persistent reminder scheduler with Telegram delivery (cards + Acknowledge/Snooze/Delete), quiet-hours handling, catch-up on boot/wake, and a delivery log — email behind a feature flag.

**Scope:**
  - APScheduler persistent jobstore on SQLite; dedupe key (event_id, occurrence_id, offset); at-least-once delivery; queue survives restart.
  - Telegram outbound sender (python-telegram-bot v21, polling): priority card with emoji/title/date/countdown/notes + Acknowledge/Snooze 1d/Delete buttons; single-user allowlist TELEGRAM_USER_ID.
  - Per-event reminder config: channels, offsets (7d/1d/2h/0m), remind_time_of_day, repeat_until_ack, snooze_allowed, quiet_hours (22:00-08:00 → morning digest); low priority sends nothing.
  - Email sender behind feature flag (smtplib/Resend env) — disabled by default in v1; reminder preview + delivery log visible in web UI.
  - Tests: critical test event pings Telegram at T-1m test offset with Ack/Snooze; low sends nothing; email only when enabled.

### M5 — Telegram inbound + local STT + AI parsing

**Goal:** Deliver the anywhere-add pipeline: Telegram text/voice input transcribed locally and AI-parsed via a configurable direct JoinGonka call into confirmed drafts that save into the web app.

**Scope:**
  - Bot polling, DM-only, single-user allowlist; commands /add, /today, /upcoming [7d|30d], /low, /ask; ignores group/channel noise.
  - Local STT: Telegram voice.ogg → ffmpeg → wav 16k → whisper.cpp (reuse voxtype install/model if present, else Omarchy dictation) with 2-min cap; no audio leaves the machine.
  - POST /api/events/parse: thin direct JoinGonka OpenAI-compatible fetch (configurable base/model/key via env, JSON mode, now+tz injection, multi-event, needs_clarification follow-up); default medium if uncertain, low on maybe/series/idea, never silently save critical financial events.
  - Draft Save/Edit/Discard flow via Telegram buttons; web smart-input reuses same endpoint; eval set of 20 samples; redacted logs by default.

### M6 — Omarchy hardening, autostart, local backups

**Goal:** Harden the local deployment: enforce loopback binding, systemd --user autostart with catch-up, /healthz, nightly SQLite backups with rotation and one-command restore, and a secret-hygiene audit for the public repo.

**Scope:**
  - Enforce 127.0.0.1 bind + startup guard that refuses 0.0.0.0; systemd --user enable + restart-on-failure; log rotation; /healthz endpoint.
  - Nightly SQLite dump + ./backups rotation (keep ~30d) + one-command restore; README runbook (start/stop/logs/backup/restore/update).
  - Secrets hygiene audit: gitleaks CI, clean .env.example, no Telegram IDs/keys/emails in docs; README privacy disclosure (data never leaves machine except Telegram/LLM outbound).

### M7 — Polish, docs, handover

**Goal:** Polish the product (empty/loading/error states, human dates, responsive+dark polish), complete the README/ROADMAP/docs, and pass owner UAT with real events across all three input paths.

**Scope:**
  - Empty/loading/error states, humanized dates ('in 3 weeks'), print month view, Showcase polish.
  - README: Omarchy quickstart, env table (JoinGonka/Telegram/STT), voxtype reuse notes, cost notes, backup/restore, troubleshooting, privacy disclosure; ROADMAP.md for v2 (Google Calendar sync, /ask over history, PWA, stats).
  - Owner UAT: 10 real events via web + Telegram text + voice; daily use for a week with zero missed critical reminders in the test window; need-owner issues closed.

### M8 — Owner follow-ups: LAN bind + docs (from owner issue #96)

**Goal:** Owner pass over the shipped product: LAN-accessible binds with explicit opt-in, README cleanup, and milestone records.

### M9 — Owner feedback round 2: runtime wiring, UX fixes, Docker/Makefile (from #106–#109)

**Goal:** Turn the owner's second feedback pass into a fully working daily driver: the Telegram bot and reminder engine actually running at runtime, actionable smart-input parse errors, the requested UI behaviours (right panel, full-height layout, save/Esc), and one-command Docker operation (`make dev/start/stop`) with a radically simplified README.

**Scope:**
  - Runtime wiring: start the reminder scheduler + Telegram bot polling in the API lifespan behind `BOT_TOKEN`; `/healthz` component status; Docker STT limitation documented (#109.2 root cause).
  - Env-driven Telegram user allowlist (multi-ID, inbound + outbound) (#109.1).
  - Smart-input parse failures: distinct actionable errors, API-side logging, `llm_configured` health signal, README troubleshooting (#108).
  - UI fixes: full-viewport app shell (no page scrollbar), event click opens a right-side panel, Save closes the wizard (+ views refresh), Esc closes the wizard (#107).
  - Docker/Makefile: root `Makefile` with `make dev` / `make start` (prod + boot autostart incl. migrations) / `make stop`; LAN-accessible and tested; README simplified around the make targets (#106).

## Backlog — planned sub-issues (tracked by PM)

> Tracks the concrete, issue-sized slices the PM has planned against the
> milestones above. Checked `[x]` = implemented + merged. This section is the
> authoritative backlog the loop uses to decide whether the project is done.

### M1 — Public repo, scaffolding, Omarchy baseline
- [x] M1-T1 — Monorepo structure + backend skeleton (apps/api FastAPI+SQLAlchemy+Alembic, packages/shared schema v1) + tooling gates (ruff, mypy, pytest, eslint max-warnings 0, pre-commit + gitleaks, Vitest 100% core). (merged via #4)
- [x] M1-T2 — Local run paths: docker-compose.yml (dev) + systemd/timeline.service example bound to 127.0.0.1:8123. (merged via #12)
- [x] M1-T3 — File need-owner issues #1-#7 (natalies-corner, JoinGonka, Telegram, email, tz/license, voxtype); secrets to local .env only. (merged via #11)

### M2 — Core domain: events, recurrence, local API, SQLite
- [x] M2-T1 — Models (AppConfig, Event, Reminder, DeliveryLog, TelegramInbound) + Alembic migrations on SQLite WAL. (merged via #16)
- [x] M2-T2 — dateutil.rrule occurrence expansion (daily/weekly/monthly/quarterly/yearly/custom) + tz/all-day handling; next_occurrences(n) materialized on read with caching. (merged via #18)
- [x] M2-T3 — CRUD endpoints + GET /api/summary?month=YYYY-MM; seed data (HRA quarterly, series next June, check-up); pytest DST/leap/quarterly-drift cases. (merged via #19)

### M3 — Web UI: timeline, calendar, wizard, smart-input
- [x] M3-T1 — App shell (no login), Timeline view (grouped by month/week, infinite scroll, priority/tag color+icon, recurrence badge), Calendar view (custom Tailwind month/week/agenda grid + day drawer). (merged via #23/#25/#32/#33)
- [x] M3-T2 — Summary bar (events this month by priority, next 7 days, overdue highlight) + event drawer with next occurrences and reminder preview. (merged via #40/#43)
- [x] M3-T3 — 3-step create/edit wizard (What/When → Recurrence → Priority & Reminders) + smart-input box calling /parse + search/filter + dark/light + responsive + keyboard shortcuts (c=create, /=search). (merged via #42/#50/#52/#53)
- [x] M3-T4 — Atomic folders (atoms/molecules/organisms/templates/pages) with services (apiClient, llmParse, dateFmt) injected via Context; every organism has a Showcase file; Vitest 100% src/core + Playwright smoke on 127.0.0.1. (merged via #56/#60)

### M4 — Reminder engine + Telegram outbound
- [x] M4-T1 — APScheduler persistent jobstore on SQLite; dedupe key (event_id, occurrence_id, offset); at-least-once delivery; queue survives restart. (merged via #57/#58)
- [x] M4-T2 — Telegram outbound sender (python-telegram-bot v21, polling): priority card + Acknowledge/Snooze 1d/Delete buttons; single-user allowlist TELEGRAM_USER_ID. (merged via #55/#59)
- [x] M4-T3 — Per-event reminder config (channels, offsets, remind_time_of_day, repeat_until_ack, snooze_allowed, quiet_hours → morning digest); low priority sends nothing; email sender behind feature flag; reminder preview + delivery log UI; tests (T-1m test offset with Ack/Snooze). (merged via #61/#62/#63/#64/#65/#67/#68)

### M5 — Telegram inbound + local STT + AI parsing
- [x] M5-T1 — Bot polling, DM-only, single-user allowlist; commands /add, /today, /upcoming [7d|30d], /low, /ask; ignores group/channel noise. (merged via #72)
- [x] M5-T2 — Local STT: Telegram voice.ogg → ffmpeg → wav 16k → whisper.cpp (reuse voxtype install/model if present) with 2-min cap; no audio leaves the machine. (merged via #74)
- [x] M5-T3 — POST /api/events/parse: thin direct JoinGonka OpenAI-compatible fetch (configurable base/model/key, JSON mode, now+tz injection, multi-event, needs_clarification follow-up); default medium if uncertain, low on maybe/series/idea, never silently save critical financial events. (merged via #73)
- [x] M5-T4 — Draft Save/Edit/Discard flow via Telegram buttons; web smart-input reuses endpoint; eval set of 20 samples; redacted logs by default. (merged via #75/#76/#78/#81)

### M6 — Omarchy hardening, autostart, local backups
- [x] M6-T1 — Enforce 127.0.0.1 bind + startup guard refusing 0.0.0.0; systemd --user enable + restart-on-failure; log rotation; /healthz endpoint. (merged via #77/#80)
- [x] M6-T2 — Nightly SQLite dump + ./backups rotation (keep ~30d) + one-command restore; README runbook (start/stop/logs/backup/restore/update). (merged via #85/#86)
- [x] M6-T3 — Secrets hygiene audit: gitleaks CI, clean .env.example, no Telegram IDs/keys/emails in docs; README privacy disclosure. (merged via #83/#87)

### M7 — Polish, docs, handover
- [x] M7-T1 — Empty/loading/error states, humanized dates ('in 3 weeks'), print month view, Showcase polish. (merged via #84/#88)
- [x] M7-T2 — README: Omarchy quickstart, env table, voxtype reuse notes, cost notes, backup/restore, troubleshooting, privacy disclosure; ROADMAP.md for v2. (merged via #92/#93/#94)
- [ ] M7-T3 — Owner UAT: 10 real events via web + Telegram text + voice; daily use for a week with zero missed critical reminders; need-owner issues closed. (owner-gated; filed as pi:needs-human #95)

### M8 — Owner follow-ups: LAN bind + docs (from owner issue #96)
- [x] M8-T1 — Web/API bind to 0.0.0.0 opt-in + firewall port whitelist. (merged via #100)
- [x] M8-T2 — milestone.md with completed milestone records. (merged via #101)
- [x] M8-T3 — README cleanup: remove project-plan text, keep app description + steps. (merged via #102)
- [x] M8-T4 — Check off M8-T3 in milestone.md; mark M7–M8 follow-ups done. (merged via #104)
- [x] M8-T5 — Align docs/comments with the dev-server 0.0.0.0 bind. (merged via #110)

### M9 — Owner feedback round 2: runtime wiring, UX, Docker (from #106–#109)
- [x] M9-T1 — Wire Telegram bot + reminder scheduler into the API runtime (lifespan, behind `BOT_TOKEN`); `/healthz` component status; Docker STT limitation documented. (merged via #114)
- [x] M9-T2 — Telegram user allowlist via env (`TELEGRAM_USER_IDS`, multi-ID, inbound + outbound gating, docs). (merged via #115)
- [x] M9-T3 — Smart-input parse failures: actionable web errors, API error logging, `llm_configured` health signal, README troubleshooting. (merged via #117; follow-up tests merged via #119/#120)
- [x] M9-T4 — Wizard: Save closes the modal on success and the timeline/calendar show the change without reload; Esc closes the wizard modal. (owner #107.3–4; filed as #121, merged via #124)
- [x] M9-T5 — Event click opens a right-side panel (slide-over on the right; responsive fallback; Esc/✕ close). (owner #107.2; filed as #122, merged via #125)
- [x] M9-T6 — App shell full viewport height: no page-level vertical scrollbar; timeline/calendar scroll internally. (owner #107.1; filed as #123, merged via #126)
- [ ] M9-T7 — Root Makefile: `make dev` (compose up + all scripts, web LAN-accessible), `make start` (prod + boot autostart incl. migrations), `make stop` (stop + remove autostart); tested end-to-end on the host. (from owner #106.1–3; filed as #127)
- [ ] M9-T8 — README simplification: runbook centred on the make targets; remove unnecessary instructions. (from owner #106.4; filed as #128, depends on #127)
