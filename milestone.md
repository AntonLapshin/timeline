# timeline — Milestones

> Milestone records for the timeline project. Each completed item is checked
> (`- [x]`); anything genuinely not complete is explicitly marked owner-gated /
> blocked rather than falsely checked. Maintained by the auto-pi PM persona as
> the project evolves. The authoritative backlog of planned sub-issues lives in
> [`manifest.md`](manifest.md).

**Status: done** (engineering complete + deployed; the final owner UAT M7-T3 is
`pi:needs-human` #95 and the email decision is `need-owner` #8 — both explicitly
owner-blocked).

---

## M0 — Public repo, scaffolding, Omarchy baseline — 0.5–1 day

> Manual inputs / secrets / account creations → GitHub issues labeled
> `need-owner` (public repo → never paste secrets in issues; secrets go to local
> `.env` only).

- [x] `git init ws/timeline`, create **public** GitHub repo `timeline`, push, `.gitignore` (`.env`, `data/`, `backups/`, `*.db*`, audio, logs) + `LICENSE` (MIT) + README + `.env.example` (no real values). *(merged via #2/#4)*
- [x] Monorepo skeleton: `apps/web` (Vite+React+TS+Tailwind+showcase, atomic folders, context injection, `src/core`+`src/ui`), `apps/api` (FastAPI+SQLAlchemy+Alembic), `packages/shared` (event JSON schema v1). *(merged via #4)*
- [x] Tooling: ruff, mypy, pytest, eslint (`max-warnings 0`), pre-commit + gitleaks, Vitest coverage gate on `src/core`. *(merged via #4)*
- [x] Local run skeleton: `docker-compose.yml` + `systemd/timeline.service` example (bind `127.0.0.1:8123`). *(merged via #12)*
- [x] Reference access issues (`need-owner`) filed: #1 repo created+pushed; #2 natalies-corner access; #3 JoinGonka base/model/key; #4 Telegram bot+user id; #5 email decision; #6 tz/locale/quiet-hours/license; #7 voxtype presence. *(merged via #11)*
- **Done when:** `docker compose up` or `systemctl --user start timeline` opens placeholder localhost web; issues #1–#7 filed; gitleaks clean. ✅

---

## M1 — Core domain: events + recurrence + local API + SQLite — 2–3 days

- [x] Models (AppConfig, Event, Reminder, DeliveryLog, TelegramInbound) + Alembic migrations on SQLite WAL. *(merged via #16)*
- [x] `dateutil.rrule` occurrence expansion (daily/weekly/monthly/quarterly/yearly/custom) + tz/all-day handling; `next_occurrences(n)` materialized on read with caching. *(merged via #18)*
- [x] CRUD endpoints + `GET /api/summary?month=YYYY-MM`; seed data (HRA quarterly, series next June, check-up); pytest DST/leap/quarterly-drift cases. *(merged via #19)*
- **Done when:** HRA-quarterly expands 2y correctly; summary counts correct; data lands in `./data/` (gitignored). ✅

---

## M2 — Web UI (React+TS+Tailwind+Showcase, atomic, context-injected) — 3–5 days

- [x] App shell (no login), Timeline + Calendar month/week/agenda + day drawer + summary header + wizard (3 steps) + smart-input box (`/parse`) + search/filter + dark/light. *(merged via #23/#25/#32/#33/#40/#42/#43/#46/#47/#48/#50/#52/#53)*
- [x] Atomic folders: `atoms/ molecules/ organisms/ templates/ pages/`; services (`apiClient`, `llmParse`, `dateFmt`) via Context; every organism has a Showcase file (`src/ui/showcases/*.tsx`, `?file=EventCard&showcase=Critical`). *(merged via #56/#60)*
- [x] Vitest 100% `src/core` (recurrence-format, summary-counts, parse-guards); Playwright smoke on `127.0.0.1`. *(merged via #56/#60)*
- **Done when:** owner CRUDs events locally, sees both views + summary; Showcase gallery runs. ✅

---

## M3 — Reminder engine + Telegram outbound + Email opt-in — 2–3 days

- [x] APScheduler persistent jobstore on SQLite; dedupe key (event_id, occurrence_id, offset); at-least-once delivery; queue survives restart. *(merged via #57/#58)*
- [x] Telegram outbound sender (python-telegram-bot v21, polling): priority card + Acknowledge/Snooze 1d/Delete buttons; single-user allowlist TELEGRAM_USER_ID. *(merged via #55/#59)*
- [x] Email sender behind feature flag (smtplib/Resend) — disabled by default in v1; reminder preview + delivery log UI; quiet-hours digest; catch-up on boot/wake; tests (T-1m test offset with Ack/Snooze). *(merged via #61/#62/#63/#64/#65/#67/#68)*
- **Done when:** critical test event pings Telegram at T-1m test offset with Ack/Snooze; low sends nothing; email only when enabled. ✅

---

## M4 — Telegram inbound + local STT + JoinGonka parsing — 3–4 days

- [x] Bot polling, DM-only, `/add /today /upcoming /low /ask`; ignores group/channel noise; single-user allowlist. *(merged via #72)*
- [x] `voice.ogg → ffmpeg → whisper.cpp local` transcription (reuse voxtype model where possible) with 2-min cap; no audio leaves the machine. *(merged via #74)*
- [x] `POST /api/events/parse` → JoinGonka direct call (configurable base/model/key, JSON mode, `now+tz` injection, multi-event, `needs_clarification`); default medium if uncertain, low on maybe/series/idea, never silently save critical financial events. *(merged via #73)*
- [x] Draft Save/Edit/Discard flow via Telegram buttons; web smart-input reuses endpoint; eval set of 20 samples; redacted logs by default. *(merged via #75/#76/#78/#81)*
- **Done when:** "HRA every quarter from Oct" + voice "series season 2 next June low priority" → correct drafts → Save → visible in web. ✅

---

## M5 — Omarchy hardening + autostart + local backups (replaces old hosting milestone) — 1–2 days

- [x] Bind `127.0.0.1` enforce + startup check (refuse `0.0.0.0`); `systemd --user` enable + restart-on-failure; log rotation; `/healthz`. *(merged via #77/#80)*
- [x] Nightly SQLite dump + `./backups` rotation (30d) + one-command restore; README runbook (start/stop/logs/backup/restore/update). *(merged via #85/#86)*
- [x] Secrets hygiene audit for public repo (gitleaks CI, `.env.example` clean, no IDs in docs); README privacy disclosure. *(merged via #83/#87)*
- **Done when:** reboot → service auto-starts → catch-up digest works; backup+restore tested; repo public + clean. ✅

---

## M6 — Polish, docs, handover — 1–2 days

- [x] Empty/loading/error states, human dates ("in 3 weeks"), print month view, Showcase polish. *(merged via #84/#88)*
- [x] README: Omarchy quickstart, env table (JoinGonka/Telegram/SMTP/STT), voxtype reuse notes, cost notes (~$0.02/1M tokens Gonka), backup/restore, troubleshooting, "data never leaves machine except Telegram/LLM/Email" disclosure. *(merged via #89/#91/#92/#93)*
- [x] `ROADMAP.md` v2 ideas: Google Calendar sync, `/ask` over history, PWA, stats. *(merged via #90/#94)*
- [ ] Owner UAT: 10 real events via web + Telegram text + voice; daily use for a week with zero missed critical reminders in the test window; need-owner issues closed. — **owner-gated / blocked** (filed as `pi:needs-human` #95; requires owner action, not engineer scope).
- **Done when:** daily use for a week, zero missed critical in test window, issues closed. ⏳ *(awaiting owner UAT #95)*

---

## M7 — M8 owner follow-ups (from owner pass #96)

- [x] M8-T1 — Allow web/API bind to `0.0.0.0` opt-in with firewall port whitelist (issue #97). *(merged via #100)*
- [x] M8-T2 — Create this `milestone.md` with milestone records; check off all completed items (issue #98). *— this file*
- [x] M8-T3 — Clean up README: remove project-plan text, keep app description + useful steps (issue #99). *(merged via #102)*

---

**Rough total: ~12–19 days solo pace, mostly gated on owner secrets (JoinGonka key/model, Telegram bot). No hosting waits.**

---

## Status summary

| Milestone | Status |
|-----------|--------|
| M0 — Repo, scaffolding, Omarchy baseline | ✅ done |
| M1 — Core domain: events, recurrence, API, SQLite | ✅ done |
| M2 — Web UI | ✅ done |
| M3 — Reminder engine + Telegram outbound + Email opt-in | ✅ done |
| M4 — Telegram inbound + local STT + JoinGonka parsing | ✅ done |
| M5 — Omarchy hardening + autostart + local backups | ✅ done |
| M6 — Polish, docs, handover | ⏳ done except owner UAT (M7-T3, #95) |
| M7 — M8 owner follow-ups | ✅ done |

Only the **owner-gated** items remain open: **M6 owner UAT (#95)** and the **email
decision (#8)** — both require owner action and are not engineer scope.
