# timeline

# Timeline — Project Plan (v2, clarified)

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

Both paths read secrets from the local `.env` (gitignored) — never from
committed files. See `systemd/timeline.service` and `docker-compose.yml` for
details.

---

**Repo:** `ws/timeline` → **public** GitHub repo (code only, no data, no secrets — see §7)
**Vision:** A personal, local-first global schedule that remembers everything: one-time future events (e.g. “Season 2 of X comes out June next year”), recurrent obligations (e.g. “Pay HRA every quarter”, check-ups), with timeline + calendar views, monthly summaries, and configurable Telegram / Email reminders. New events via Web UI or Telegram (text or voice, natural language → AI extraction).

**Serving model (clarified):**
- App + DB run **locally on Omarchy OS machine**, website bound to loopback only (`http://127.0.0.1:8123`), **no web auth** — visible only at home / on that machine.
- **Telegram + Email are the remote interfaces** — available from everywhere via Telegram cloud / SMTP, no server rental, no hosting, no tunnel, no domain.
- Bot uses **long-polling** (no webhook, no open ports).

Reference projects (per owner):
- Web: React + TypeScript + TailwindCSS + `showcase` lib (`https://github.com/AntonLapshin/showcase`), Atomic design, Context injection — see `natalies-corner` for the pattern.
- LLM: direct call to **JoinGonka (configurable)** provider — see `natalies-corner` for the call pattern. `natalies-corner` URL currently 404 for agent (likely private/renamed) — need access via Issue.
- STT: lightweight local efficient like **voxtype / Omarchy STT** (local Whisper, no cloud).

---

## 1. Goals & Non-Goals

### Goals
1. Never forget: capture any future / recurrent event in <30 seconds.
2. See everything at home: timeline + calendar views, monthly counts, search/filter on localhost web.
3. Remind from anywhere: per-event configurable reminders via Telegram bot + optionally email (both work outside home because they go through Telegram/SMTP clouds, app polls/sends from home machine).
4. Add from anywhere: Web form/wizard (home) + Telegram text/voice in natural language (anywhere), AI-parsed into structured event(s).
5. Local & private by construction: public code, private data (`./data/` + `.env` gitignored, never committed); web not exposed to LAN/internet.
6. Low maintenance on Omarchy: systemd user service + one-command Docker Compose or native run, SQLite, local backups.

### Non-Goals (v1)
- Multi-user / family sharing / collaboration.
- Remote web access / hosting / password login / TLS / tunnels / VPS.
- Public sharing links.
- Mobile native apps (responsive web is enough for v1).
- Full email/calendar sync (Google Calendar import/export is v2 stretch).

### Example user stories
- “I pay HRA every quarter” → recurrent event, reminder e.g. 7d + 1d before via Telegram.
- “Season 2 of my series comes out June next year” → low-priority one-time, no proactive ping, visible in June view.
- “Pay X / check-up schedule for Y” → medium/critical event, reminder day-before + day-of via Telegram (+ optional email).
- “Voice message in Telegram while walking” → locally transcribed → AI creates draft event(s) → confirm via Telegram buttons.

---

## 2. Functional Requirements

### 2.1 Events
- CRUD with fields (see §5).
- Types: `one_time`, `recurrent`.
- Recurrence: daily / weekly / monthly / quarterly / yearly / custom + RFC5545 `RRULE` (e.g. “every 3 months on the 15th”), end: never / after N / until date.
- Occurrences materialized on read (no DB explosion); `next_occurrences(n)` cached.
- Timezones: store UTC + display tz (system tz, confirm via issue). All-day vs timed.
- Notes/links/tags; search, filter by tag / priority / date / text; bulk edit/delete.

### 2.2 Priorities & Reminder Config (per-event)
| Level | Meaning | Default policy (tunable) |
|---|---|---|
| `critical` | cannot miss | Telegram T-7d, T-1d, T-day 09:00; repeat until ack; optional email |
| `medium` | should not miss | Telegram T-1d + T-day |
| `low` | FYI / passive | No push; visible in web + on-demand via `/upcoming`, `/today`, `/ask`, `/low` |

Per-event: `channels`, `offsets` (`7d/1d/2h/0m`), `remind_time_of_day`, `repeat_until_ack`, `snooze_allowed`, `quiet_hours` (e.g. 22:00–08:00 → morning digest), per-event email opt-in (`email_enabled`, `email_to`, separate offsets). Global email default OFF.

### 2.3 Web UI — localhost only, no login
- **Timeline view:** vertical feed grouped by month/week, infinite scroll past↔future, color/icon by priority/tag, recurrence badge.
- **Calendar view:** month / week / agenda; day drawer.
- **Summary bar:** “N events this month (X critical, Y medium, Z low)”, “Next 7 days”, overdue highlight.
- **Event drawer:** full fields + next occurrences + reminder preview (“will ping via Telegram in 6d, 1d”).
- **Create/edit wizard (3 steps):** 1) What/When (natural + structured) → 2) Recurrence → 3) Priority & Reminders (smart defaults + “send test Telegram now”).
- **No auth page** (bind `127.0.0.1` only). Keyboard: `c` = create, `/` = search. Dark/light, responsive.
- **Stack (fixed per owner):** React + TypeScript + TailwindCSS + `showcase` lib for component gallery/dev. **Atomic design** (`atoms/molecules/organisms/templates/pages`), **Context injection** (services via React context, no prop-drilling, mockable in Showcase/Vitest) — mirror `natalies-corner` structure. Vite + Vitest + ESLint (`max-warnings 0`), `src/core` (pure, 100% coverage) / `src/ui` (thin) split per Showcase convention.

### 2.4 Telegram — Outbound (works from anywhere)
- Private bot, DM-only + single-user allowlist (`TELEGRAM_USER_ID`); polling (no webhook).
- Card: priority emoji, title, date/time, countdown, notes/link, buttons [Acknowledge] [Snooze 1d] [Delete/Discard where safe].
- Delivery log per reminder visible in local web UI.

### 2.5 Telegram — Inbound (works from anywhere)
- Free text → AI extracts 1..N candidates → draft cards + [Save] [Edit] [Discard].
- Voice/audio → **local STT** (see §4) → same pipeline.
- Commands: `/add <text>`, `/today`, `/upcoming [7d|30d]`, `/low`, `/ask <q>`.
- Defaults: `medium` if uncertain, `low` on “maybe/series/idea”; never silently auto-save critical financial events — always confirm.
- Ignore group/channel noise; DM-only.

### 2.6 AI Extraction — JoinGonka direct call (configurable)
- Direct `fetch` to JoinGonka OpenAI-compatible endpoint — **no LangChain/LiteLLM wrapper**, same minimal pattern as `natalies-corner` (thin `createLlmClient({baseUrl, apiKey, model})` injected via context, prompt + JSON Schema versioned in repo).
- Config via env: `LLM_BASE_URL` (default `https://gate.joingonka.ai/openai/v1` — confirm exact path via issue, brokers vary `/v1` vs `/openai`), `LLM_API_KEY`, `LLM_MODEL` (cheap JSON-capable, e.g. DeepSeek-V3-Flash / Qwen / Kimi — confirm model ID via issue).
- Input: free text (+ `now + tz` injected for relative dates). Output: strict JSON array `{title, description, date|datetime, tz, all_day, recurrence_rule, priority_guess, reminder_guess, tags, confidence, needs_clarification?}`.
- Ambiguous → `needs_clarification` + bot follow-up question, never hallucinate year.

### 2.7 Email Reminders (optional per-event, sent from home machine)
- SMTP from local (Gmail app-password / Resend / plain SMTP — confirm via issue): same card as HTML+text.
- Per-event toggle + offsets; test button in web.

### 2.8 Privacy (public repo!)
- Repo is **public** but contains **only code + docs + prompts + schemas**. Never commit: `.env`, `./data/`, `./backups/`, logs, transcripts, Telegram IDs, API keys, email addresses.
- `.gitignore` covers all of the above + `*.db*`, `*.ogg`, `*.wav`. Pre-commit secret scan (gitleaks) + CI check that no `.env`/`data/` is tracked.
- Logs redact message text by default (opt-in full log locally). Web has no auth because it never leaves localhost — firewall note in README (bind `127.0.0.1`, do not `--host 0.0.0.0`).

---

## 3. Non-Functional (local Omarchy)
- Run: `docker compose up` **or** native `systemd --user` service → web `http://127.0.0.1:8123`, data in `./data` (SQLite WAL). Autostart on login/boot; survives sleep → catch-up digest on wake.
- No hosting/TLS/tunnel/VPS. Outbound only: Telegram Bot API (poll + send), JoinGonka HTTPS, SMTP out. No inbound ports.
- Backup: nightly SQLite dump + `./backups` rotation (local only, e.g. keep 30d); one-command restore. Reminder queue survives restart (persistent store, at-least-once + dedupe `(event_id, occurrence_id, offset)`).
- Maintainability: monorepo, typed, linted, tested; README with Omarchy runbook.

---

## 4. Tech Stack (fixed per owner clarifications)

- **Monorepo:** `ws/timeline/` with `apps/web` (React+TS), `apps/api` (Python FastAPI) + `apps/bot` merged into api process (polling thread) or separate service in same Compose, `packages/shared` (JSON schemas, prompt version).
  - Alt considered: full-TS backend — rejected for v1 because Python has best Telegram (`python-telegram-bot` v21) + local STT (`whisper.cpp` bindings) ecosystem; web stays TS.
- **DB:** SQLite (WAL) only. No Postgres (no server). SQLAlchemy 2.0 + Pydantic v2 + Alembic. Scheduler: APScheduler persistent jobstore on SQLite.
- **Frontend:** React + Vite + TypeScript + TailwindCSS + `showcase` (`AntonLapshin/showcase`) for isolated component gallery (`npm run dev:showcase` / `?file=..&showcase=..` deep links). Atomic design + Context injection per `natalies-corner`. `src/core` pure logic (100% Vitest coverage) / `src/ui` thin views. FullCalendar or custom month grid (decide in M2, prefer custom for beauty + Tailwind control).
- **Bot:** `python-telegram-bot` v21, **polling only**. Allowlist `TELEGRAM_USER_ID`.
- **STT (fixed): voxtype-like local, lightweight, efficient — no cloud Whisper API.**
  - Default: local `whisper.cpp` (base/small English, ~150MB, same as Omarchy `Install > AI > Dictation`), CPU 9–11× realtime; reuse existing `voxtype` install if present (`~/.config/voxtype/config.toml`, `~/.local/share/voxtype/models/`).
  - Implementation: Telegram `voice.ogg` → `ffmpeg` → `wav 16k` → `whisper.cpp` CLI/sidecar → text + confidence. Cap 2 min audio. Optional ONNX engines (Parakeet/Moonshine/Cohere) later — config flag.
  - No audio leaves the machine.
- **LLM (fixed): JoinGonka direct OpenAI-compatible call, configurable.** Thin TS-or-Python `fetch` client (`POST {baseUrl}/chat/completions` with `Bearer` key, `response_format: json_object`), timeouts + retry + model override per request. No vendor lock: swapping broker = changing env.
- **Email:** Python `smtplib` + env (`SMTP_HOST/PORT/USER/PASS/FROM/TO`) or Resend API — confirm via issue.
- **Deploy/run:** Docker Compose (web+api+bot+scheduler in 2 containers) **or** native systemd unit for Omarchy (preferred for autostart) — provide both, Compose for dev, systemd for daily use. `/healthz` for monitoring.
- **Testing:** pytest (api/bot/recurrence), Vitest (web core 100%), Playwright smoke (localhost), ruff + mypy + eslint, gitleaks.

---

## 5. Data Model (v1 draft, no User password table — single local user)

```
AppConfig(id=1, tz, quiet_hours, telegram_user_id, default_remind_time)
Event(id, title, description, location/url, tags[],
      type: one_time|recurrent,
      start_at: timestamptz, end_at?, all_day: bool, tz,
      rrule: str? (RFC5545),
      priority: critical|medium|low,
      channels: [telegram,email],
      reminder_offsets: [...], remind_time_of_day: "09:00",
      repeat_until_ack: bool, snooze_allowed: bool,
      email_enabled: bool, email_to?,
      source: web|telegram_text|telegram_voice|ai,
      raw_input?, ai_confidence?, status: draft|active|archived,
      created_at, updated_at)
Reminder(id, event_id, occurrence_id, channel, scheduled_for, sent_at?, status, dedupe_key unique, acked_at?)
DeliveryLog(reminder_id, attempt, result, error?, at)
TelegramInbound(id, telegram_msg_id, from_id, kind, raw_text, transcription?, parsed_json?, created_event_ids[], at)
```

API sketch (localhost only, no auth):
- `GET /api/events?from&to&priority&tag&q` (expanded occurrences)
- `POST /api/events`, `PATCH /api/events/:id`, `DELETE /api/events/:id`
- `GET /api/summary?month=YYYY-MM`
- `POST /api/events/parse` (JoinGonka extraction; used by web smart-input + bot)
- `POST /api/reminders/test`, `GET /api/reminders/log`
- `GET /healthz`

---

## 6. Milestones & Breakdown

> Manual inputs / secrets / account creations → GitHub issues labeled `need-owner` (public repo → never paste secrets in issues; secrets go to local `.env` only).

### M0 — Public repo, scaffolding, Omarchy baseline — 0.5–1 day
- [ ] `git init ws/timeline`, create **public** GitHub repo `timeline`, push, `.gitignore` (`.env`, `data/`, `backups/`, `*.db*`, audio, logs) + `LICENSE` (MIT — confirm via issue) + README + `.env.example` (no real values).
- [ ] Monorepo skeleton: `apps/web` (Vite+React+TS+Tailwind+showcase, atomic folders, context injection, `src/core`+`src/ui`), `apps/api` (FastAPI+SQLAlchemy+Alembic), `packages/shared` (event JSON schema v1).
- [ ] Tooling: ruff, mypy, pytest, eslint (`max-warnings 0`), pre-commit + gitleaks, Vitest coverage gate on `src/core`.
- [ ] Local run skeleton: `docker-compose.yml` + `systemd/timeline.service` example (bind `127.0.0.1:8123`).
- [ ] Reference access issues (`need-owner`):
  - #1 Repo created + pushed (public) — done/verify.
  - #2 Provide `natalies-corner` access (private? local path? confirm JoinGonka call snippet + Showcase/atomic/context layout to mirror).
  - #3 JoinGonka: exact `LLM_BASE_URL` (+`/v1`?), `LLM_MODEL` ID for JSON extraction, API key → local `.env` (never in issue; confirm model + quota/bonus).
  - #4 Telegram: bot via @BotFather → `BOT_TOKEN` + `TELEGRAM_USER_ID` (numeric DM id) → local `.env`; confirm polling OK.
  - #5 Email (optional v1): SMTP host/user or Resend key + sender/receiver → local `.env`, else skip email in v1.
  - #6 Confirm tz + locale + quiet hours + license (MIT?).
  - #7 Confirm `voxtype` already installed? (`voxtype --version`, model present?) — else install via Omarchy `Install > AI > Dictation`.
- **Done when:** `docker compose up` or `systemctl --user start timeline` opens placeholder localhost web; issues #1–#7 filed; gitleaks clean.

### M1 — Core domain: events + recurrence + local API + SQLite — 2–3 days
- Same as before minus User/auth: models (AppConfig, Event, Reminder, DeliveryLog, TelegramInbound) + Alembic; `dateutil.rrule` expansion + tz/all-day; CRUD + `/summary`; seed (HRA quarterly, series June-next-year, check-up); pytest incl. DST/leap/quarterly-drift.
- **Done when:** HRA-quarterly expands 2y correctly; summary counts correct; data lands in `./data/` (gitignored).

### M2 — Web UI (React+TS+Tailwind+Showcase, atomic, context-injected) — 3–5 days
- [ ] App shell (no login), Timeline + Calendar month/week/agenda + day drawer + summary header + wizard (3 steps) + smart-input box (`/parse`) + search/filter + dark/light.
- [ ] Atomic folders: `atoms/ molecules/ organisms/ templates/ pages/`; services (`apiClient`, `llmParse`, `dateFmt`) via Context; every organism has Showcase file (`src/ui/showcases/*.tsx`, `?file=EventCard&showcase=Critical`).
- [ ] Vitest 100% `src/core` (recurrence-format, summary-counts, parse-guards); Playwright smoke on `127.0.0.1`.
- **Done when:** owner CRUDs events locally, sees both views + summary; Showcase gallery runs.

### M3 — Reminder engine + Telegram outbound + Email opt-in — 2–3 days
- [ ] APScheduler persistent; dedupe key; quiet-hours digest; catch-up on boot/wake; Telegram sender (card + Ack/Snooze callbacks, allowlist); email sender behind flag; reminder preview + delivery log UI; tests.
- **Done when:** critical test event pings Telegram at T-1m test offset with Ack/Snooze; low sends nothing; email only when enabled.

### M4 — Telegram inbound + local STT + JoinGonka parsing — 3–4 days
- [ ] Bot polling, DM-only, `/add /today /upcoming /low /ask`; `voice.ogg → ffmpeg → whisper.cpp local` transcription (reuse voxtype model where possible); `POST /api/events/parse` → JoinGonka direct call (configurable base/model/key, JSON mode, `now+tz` injection, multi-event, `needs_clarification`); draft Save/Edit/Discard; web smart-input reuses endpoint; eval set of 20 samples; redacted logs.
- **Done when:** “HRA every quarter from Oct” + voice “series season 2 next June low priority” → correct drafts → Save → visible in web.

### M5 — Omarchy hardening + autostart + local backups (replaces old hosting milestone) — 1–2 days
- [ ] Bind `127.0.0.1` enforce + startup check (refuse `0.0.0.0`); `systemd --user` enable + restart-on-failure; log rotation; `/healthz`.
- [ ] Nightly SQLite dump + `./backups` rotation (30d) + one-command restore; README runbook (start/stop/logs/backup/restore/update).
- [ ] Secrets hygiene audit for public repo (gitleaks CI, `.env.example` clean, no IDs in docs).
- **Done when:** reboot → service auto-starts → catch-up digest works; backup+restore tested; repo public + clean.

### M6 — Polish, docs, handover — 1–2 days
- [ ] Empty/loading/error states, human dates (“in 3 weeks”), print month view, Showcase polish.
- [ ] README: Omarchy quickstart, env table (JoinGonka/Telegram/SMTP/STT), voxtype reuse notes, cost notes (~$0.02/1M tokens Gonka), backup/restore, troubleshooting, “data never leaves machine except Telegram/LLM/Email” disclosure.
- [ ] `ROADMAP.md` v2 ideas: Google Calendar sync, `/ask` over history, PWA, stats.
- [ ] Owner UAT: 10 real events via web + Telegram text + voice.
- **Done when:** daily use for a week, zero missed critical in test window, issues closed.

**Rough total: ~12–19 days solo pace, mostly gated on owner secrets (JoinGonka key/model, Telegram bot). No hosting waits.**

---

## 7. GitHub Workflow (public repo + owner-in-the-loop)

- Repo **public** `timeline`. Default `main`. Secrets **never** in repo/issues/PRs — only local `.env`. `.env.example` holds placeholders.
- Labels: `need-owner`, `web`, `api`, `reminder`, `ai`, `deploy-local`, `bug`.
- Template `need-owner.md`: “What / Why / Where (local `.env` key) / Fallback”. Rule: **any manual input the agent cannot do itself MUST be a GitHub issue**.
- Starter issues: #1–#7 in M0 + #8 UAT checklist (M6).

---

## 8. Risks & Mitigations
- **Public repo leak** → gitignore + gitleaks + CI untracked-check; docs use placeholders (`BOT_TOKEN=***`, `user_id=123…`).
- **No web auth** → localhost-bind enforced + startup guard; README warns against exposing; Telegram allowlist remains (bot is internet-facing via Telegram cloud).
- **Date mis-parse** → resolved-date always shown + confirm for critical; eval set + confidence gate.
- **Spammy reminders** → low=silent default, quiet hours, dedupe, digest.
- **Local STT accuracy/perf** → whisper base/small local, 2-min cap, reuse voxtype model; optional bigger model flag.
- **JoinGonka availability/variance** → configurable base/model, timeouts+retry, pinned model ID, raw→parsed eval; fallback: manual wizard entry always works offline.
- **Recurrence bugs** → `rrule` lib, property tests, no hand-rolled math.
- **Scope creep (beautiful vs simple)** → Tailwind + Showcase-driven atoms, no design-system rebuild.
- **`natalies-corner` inaccessible (404)** → Issue #2; proceed with Showcase defaults + JoinGonka OpenAI-compatible `fetch` until reference lands.

---

## 9. Immediate Next Steps
1. Owner: confirm license (MIT?) + grant `natalies-corner` access / local path (Issue #2) so web + JoinGonka mirror your pattern exactly.
2. Owner: JoinGonka base URL + model ID + key → local `.env` (Issue #3); Telegram bot token + user id → `.env` (Issue #4); email decision (Issue #5); tz/locale/quiet-hours (Issue #6); voxtype present? (Issue #7).
3. Agent: scaffold M0 (public repo layout + Showcase + atomic + context + FastAPI + Compose + systemd + gitleaks) with defaults where unblocked, then M1→M6 via PRs + localhost screenshots + Telegram voice→event demo.

> Generated and maintained by [auto-pi](https://github.com/AntonLapshin/auto-pi) — an
> autonomous engineering team harness for Pi.

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
- [`project-state.md`](project-state.md) — current state and progress
- [`CHANGELOG.md`](CHANGELOG.md) — versioned change log


## Shaping decisions (from /loop-seed)


- **This is a fully elaborated v2 plan. Should I treat it as the authoritative spec (all sections fixed) and only ask about the remaining open points, or do you want to re-open any section (e.g. scope, stack, or non-goals) for revision?** — Treat v2 plan as authoritative spec; only resolve open points *(assumed)*

- **For local STT, what is your preference given the plan's 'reuse voxtype if present' default?** — Reuse existing voxtype/whisper.cpp if present, else install via Omarchy dictation *(assumed)*

- **Email reminders are optional for v1. Do you want email in the initial release, or keep it as a flagged/skipped feature until after core Telegram flow is proven?** — Skip email in v1 (feature-flag only; Telegram-first) *(assumed)*

- **The plan defers the calendar view decision to M2: custom month grid vs FullCalendar. Which should the scaffold target?** — Custom month/week/agenda grid (Tailwind-controlled) *(assumed)*

- **Both Docker Compose (dev) and systemd --user (daily) are planned. Which should be the default daily-driver path that gets priority in M0/M5?** — systemd --user (native) as daily driver; Compose for dev *(assumed)*

- **Several items are listed as non-goals/v2-stretch (Google Calendar sync, /ask over history, PWA, multi-user). Should any of these be pulled into the v1 scope, or confirmed as out-of-scope for this build?** — All confirmed out-of-scope for v1 (ROADMAP.md only) *(assumed)*


