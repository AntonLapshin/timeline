# Changelog

All notable changes to **timeline** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Voice-message STT no longer freezes the whole API (issue #132/#135):**
  the local transcription pipeline (ffmpeg convert → voxtype/whisper, blocking
  in `subprocess.run` with up to a 300s timeout) ran synchronously on the
  asyncio event loop that also serves the FastAPI web endpoints, so submitting
  a Telegram voice message froze the web UI "as if single-threaded" for as
  long as the transcription ran. `_transcribe_voice_message` now dispatches
  the blocking transcriber via `asyncio.to_thread`, keeping the loop
  responsive — proven by a regression test that serves `/api/events` on the
  same loop while a fake slow transcription is parked, plus a test that the
  default (real) pipeline runs on a worker thread, never the loop. Behavior
  is otherwise unchanged: local-only STT (no audio leaves the machine),
  2-minute cap, `unavailable` degradation when voxtype/whisper is absent,
  pending ack before transcription, and clear error/none replies.

- **Web core coverage restored to the 100% gate (review fix on PR #137, issue
  #134):** the owner's direct timezone commits (`0eab950`/`984ecaf`) had
  dropped `apps/web/src/core/**` coverage below the hard 100% threshold.
  Added missing core tests for `dateFmt` (`displayParts`/`datePartsInTimezone`/
  `parseNaiveWallClock`/month/timezone fallbacks), `apiClient` DELETE paths,
  `llmParse` clarification-body edge cases, and closed branch gaps in
  `eventWizard` (timezone-aware draft mapping), `calendar` and `timeline`
  (`tz`-less occurrences/events, unknown-priority dot fallback). The web
  coverage gate is green again (100% lines/statements/functions/branches).

- **Runtime reminder re-plans now tolerate a job firing mid-edit (review fix
  on PR #137, issue #134):** `reschedule_for_event` removes stale and re-timed
  scheduler jobs unguarded; a one-shot reminder that fires between the
  `event_job_keys()` snapshot and `remove_job()` is deleted by APScheduler
  itself, so the removal raised `JobLookupError` and the API write 500d
  (self-healing on the next edit). Both removal loops now wrap the call in
  `contextlib.suppress(JobLookupError)` exactly like `remove_event_jobs`, with
  a regression test; the scheduler-disabled CRUD path test is also pinned to a
  deterministic disabled runtime.

- **JoinGonka base URL corrected (`/openai/v1` → `/v1`):** the API posted to
  `<base>/chat/completions`, so the old default produced
  `.../openai/v1/chat/completions`, which the gateway rejects with HTTP 405.
  The default in `app/config.py`, `.env.example`, and the tests is now
  `https://gate.joingonka.ai/v1`. Existing local `.env` files still holding
  the old value need a one-line update plus a container recreate
  (`docker compose down && make dev`).

- **Backup/restore runbook now works in the compose stack (review fix on PR
  #130, issue #128):** the api container previously inherited the host-relative
  `TIMELINE_BACKUPS_DIR=./backups` from `.env`, which resolved to
  `/app/backups` inside the container's writable layer — so `make stop`
  (`docker compose down`) destroyed the dump it had just been told to create,
  and `restore` in a fresh container failed with `No such backup`. The compose
  stack now pins `TIMELINE_BACKUPS_DIR=/data/backups` and bind-mounts the
  host's gitignored `./backups` directory there, so dumps land on the host,
  survive `make stop` and even `docker compose down -v`, and the documented
  backup → stop → restore (`/data/backups/<file>.db`) → start sequence works
  as written. `.env.example` documents the override; the duplicated
  `docker-compose.yml` header lines were also removed.

### Changed

- **README simplified to a make-target runbook (issue #128, M9-T8):** the README
  (~620 → ~143 lines) is now centred on the `make dev` / `make start` / `make stop`
  lifecycle: Quickstart (`.env` → `make dev` → open the URL), the daily lifecycle
  targets, healthz self-diagnosis, privacy disclosure, a condensed env-var table,
  the four failure modes an owner can actually hit (missing `.env`,
  `llm_configured:false`, bot not replying, Docker STT limitation), and
  backup/restore essentials. Removed the manual venv/uvicorn walkthrough, the
  copy-and-edit systemd unit instructions (superseded by `make start`), the
  duplicated firewall/LAN blocks, the Omarchy quickstart, and the long
  troubleshooting section. Demo URL, repo layout, and stack/architecture summary
  kept; details survive as pointers to `.env.example` / `docker-compose.yml`
  comments.

### Added

- **LLM parse retries flaky gateways (up to 5 attempts) + nicer smart-input
  loading state:** `llm_parse.parse_events` now retries transport failures
  (timeouts, connection errors) and retryable statuses (408/429/transient
  5xx) with exponential backoff (1s, 2s, 4s, 8s); other 4xx (bad key/model)
  still fail immediately, and the final error names the attempt count. The
  smart-input box disables its input while parsing, shows a spinner on the
  button, and renders a live status line explaining the wait and the
  automatic retries.

- **Root `Makefile`: one-command stack lifecycle — `make dev` / `make start`
  / `make stop` (issue #127, M9-T7):** the docker-compose stack is now driven
  by three idempotent targets at the repo root (`make help` is the default
  target and lists them, plus `make status` and `make logs`). `make dev`
  bootstraps `.env` from `.env.example` (only when missing — an existing
  `.env` is never overwritten; secrets stay in the local, gitignored `.env`),
  runs `docker compose up --build -d`, waits for `GET
  http://127.0.0.1:8124/healthz` to report ok (the API container applies
  Alembic migrations before serving), and prints the web URL, the LAN URL
  (detected via `ip route`), and the healthz URL. `make start` is the prod
  path: stack up with built images plus install + enable of a systemd `--user`
  boot-autostart unit — `systemd/timeline-compose.service.in` is generated to
  `~/.config/systemd/user/timeline-compose.service` with the absolute repo
  path and docker binary substituted, running `docker compose up -d` in the
  repo dir at boot/login (with a short retry loop for a not-yet-ready daemon;
  requires linger and docker-group access). `make stop` runs
  `docker compose down` and disables/removes the unit; both are idempotent.
  `make status` (compose ps + healthz) and `make logs` (follow logs) are small
  extras. The pre-existing native `systemd/timeline.service` example is
  untouched, no app code changes, and no secrets in the Makefile or unit;
  both the Makefile output and the README section remind that LAN exposure is
  unauthenticated (trusted LAN only) and that ports 8123/8124 need a firewall
  whitelist.

### Changed

- **App shell fills the viewport; timeline/calendar scroll internally (issue
  #123, M9-T6):** the app shell now occupies exactly the viewport height
  (`h-dvh` flex column with `overflow-hidden`) instead of `min-h-screen` with
  a normal-flow `<main>` — the page-level vertical scrollbar is gone. The
  header (title, view switcher, search/filter, smart-input, summary bar,
  theme toggle) is a `shrink-0` flex child so it stays visible while content
  scrolls; `<main>` is the single internal scroll container (`min-h-0 flex-1
  overflow-y-auto`, with the centered `max-w-3xl` content wrapper moved
  inside it), so the Timeline (month groups + "Load more" pagination) and
  the Calendar (month/week/agenda) scroll inside it instead of the whole
  document. No logic changes — layout classes only, in `AppShell.tsx`.
  Fixed-position overlays (event slide-over drawer, wizard modal) are
  unaffected; the Showcase gallery's embedded AppShell previews now scroll
  internally like the real shell. Works in both light and dark themes.

- **Event click opens a right-side slide-over panel (issue #122, M9-T5):**
  clicking an event in the Timeline or Calendar now opens its details in a
  fixed slide-over anchored to the right edge of the viewport
  (`fixed inset-y-0 right-0 w-full max-w-md`) sliding in over a dimmed,
  click-to-close backdrop — instead of the previous inline card rendered
  below the content that forced a page jump. `EventDrawer.tsx` is now the
  slide-over shell only (positioning, backdrop, slide/fade animations via
  new `drawer-slide-in`/`drawer-fade-in` keyframes in `styles/index.css`);
  detail rendering is unchanged (priority/tag/recurrence badges, next
  occurrences, reminder preview, delivery log, Edit action). Responsive
  fallback: on narrow viewports the panel spans the full width (`w-full`
  capped at `max-w-md`). All close paths work: ✕ button, Esc key (view
  model, unchanged) and backdrop click; clicking inside the panel does not
  close it. Body scroll behind the panel is locked while it is open and
  restored on close/unmount (lock lives in the `useEventDrawer` view model).
  The inline "Select an event to see its details." empty state is removed —
  the panel only renders while an event is selected (the
  `data-testid="event-drawer"` hook is kept); the Showcase gallery drops the
  now-empty drawer preview. Works in both light and dark themes.

### Test

- **Pin the `parse` success path with a non-JSON 200 body (issue #118):**
  a new core test in `apps/web/tests/core/llmParse.test.ts` covers the one
  remaining untested path in `llmParse.ts` — when a 200 response carries a
  non-JSON body, `res.json()` rejects and that rejection propagates out of
  `parse` (only HTTP/network failures are mapped to typed `ParseResult`s);
  `useSmartInput`'s catch then renders the generic fallback, which is already
  covered at the view-model level. The behavior is pre-existing and unchanged
  (follow-up from the PR #117 review); `src/core` stays at 100% coverage.

- **Close the two test gaps found in the PR #115 review (issue #116):**
  `parse_allowlist` now has a dedicated test for non-ASCII digit entries
  (`"٤٢"`, `"²"` — `str.isdigit()` is True and `int()` would even accept
  them, but the `isascii()` guard drops them so a lookalike id can never
  match a real Telegram user; fail-closed behavior verified), replacing the
  over-claiming docstring on the signed-numbers test; and a new outbound
  test covers the multi-recipient send-failure path — with two allowlisted
  ids, a raising first `send_message` aborts the pass (the second recipient
  is not attempted), the delivery is recorded as `failed` with the error,
  and the exception re-raises for the scheduler's retry layer. Both modules
  stay at 100% coverage; no behavior change.

### Added

- **Actionable smart-input parse failures + server-side diagnostics (issue
  #113, M9-T3, fixes #108):** smart-input parse failures no longer dead-end in
  a generic message. The API logs every LLM parse failure server-side
  (`logger.error` with the underlying error/HTTP status — a redacted content
  reference only; never the raw text, prompt, or key) in `app.llm_parse`.
  The web core `llmParse.ts` no longer throws for HTTP/network failures — it
  returns typed `ParseResult`s with distinct, actionable messages: HTTP 502 →
  "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API
  logs" (with the server's `detail` appended when present, e.g. a gate 401),
  network error → "Cannot reach the API — check that the backend is running
  and the address is correct.", any other HTTP status → "Unexpected API error
  (HTTP N). You can still add the event manually."; the 503 "LLM key not
  configured" message is unchanged. `useSmartInput` renders those messages
  verbatim and only falls back to the generic one for truly unexpected
  throws. `/healthz` now reports `llm_configured: true|false` and `llm_model`
  (model name only — never the key) so the owner can self-diagnose at a
  glance. The README troubleshooting gains a "Smart input says parsing
  failed / unavailable" row (placeholder credentials, `.env` edited without
  recreating the stack, container outbound network) and the `/healthz`
  section documents the new fields.

- **Telegram user allowlist via env var — multi-id, inbound + outbound (issue
  #112, M9-T2):** the bot's single-user gate (`TELEGRAM_USER_ID`) becomes an
  env-driven allowlist. The new `TELEGRAM_USER_IDS` variable accepts one or
  more comma-separated numeric ids (whitespace tolerated, duplicates
  deduplicated, order preserved); the legacy `TELEGRAM_USER_ID` still works
  and combines with `TELEGRAM_USER_IDS`. The pure parser + membership checks
  live in `app.telegram_allowlist` (`parse_allowlist`, `TelegramAllowlist`,
  `startup_warning`), exposed as `Settings.telegram_allowlist`. Inbound:
  DMs, voice notes and draft-button callbacks from non-allowlisted users are
  ignored with exactly one warning log line per occurrence (no processing, no
  reply, no data leakage). Outbound: reminder cards go to every allowlisted
  id (one delivery record per occurrence, not per recipient). Fail-closed:
  with `BOT_TOKEN` set but an empty or fully-invalid allowlist the bot still
  starts but processes nothing, with a clear startup warning naming any
  dropped entries; reminder sends fail closed as before. `.env.example` and
  the README env table/troubleshooting document the new variable.

### Fixed

- **Wizard: Save closes the modal on success, views refresh without reload,
  Esc closes the modal (issue #121, M9-T4):** the wizard's Save button used to
  dead-end in an in-modal "Event created." success state, and every data view
  kept showing stale data until a manual reload. Now a successful save (create
  or update) closes the modal immediately and fires a new `onSaved` callback;
  a failed or refused save keeps the modal open with the error message. The
  app passes an `onSaved` handler that bumps a `refreshKey`, which re-runs the
  list fetch in `useTimeline`, the occurrence fetch in `useCalendar`, the
  summary fetch in `useSummary`, and the app-level filter-options fetch (the
  tag/month dropdowns) — all without a reload; stale in-flight responses are
  ignored via the existing cancellation guards (verified by a new
  `useSummary.test.tsx` case). The event drawer is closed along with the
  wizard on save so it can never show stale details. Esc now also closes the
  wizard while it is open (same window-keydown pattern as `useEventDrawer`).
  The dead `saved` flag is removed from `EventWizardState`/`EventWizard` (the
  in-modal success message was unreachable once the modal auto-closes).
  Logic stays in the view models (`useEventWizard`, `useTimeline`,
  `useCalendar`, `useSummary`); the components stay dumb and take an optional
  `refreshKey` prop (ShowcasePage renders them unchanged).

- **Wire the Telegram bot + reminder scheduler into the API runtime (issue
  #111, M9-T1):** both subsystems were built and tested as modules but never
  started in production — the API lifespan only created tables and seeded, so
  the bot never replied and no reminder ever fired. The new
  `app.runtime.start_runtime` (called from the `app.main` lifespan) starts,
  with `BOT_TOKEN` set, the APScheduler reminder engine (drain + failed-requeue
  + outbound Telegram delivery via `make_telegram_job_func`) and the Telegram
  inbound bot polling (`initialize` → `start` → `start_polling`) as background
  tasks in the API process, with best-effort clean shutdown on app stop; with
  no `BOT_TOKEN` nothing starts (one clear log line) and the app behaves
  exactly as before. Startup failures are logged and surfaced as
  `telegram: error` on `/healthz` instead of taking the API down.
  `/healthz` now reports a `components` map (`scheduler: running|disabled`,
  `telegram: configured|not_configured|error`) so the owner can self-diagnose
  from the browser. Voice messages route through local STT → the same
  parse → draft flow as `/add`; when local STT is unavailable (the Docker
  image ships no voxtype/ffmpeg) the sender gets a clear "voice transcription
  unavailable" reply instead of silence, and the README documents the Docker
  STT limitation + the native-run path for voice. Also fixes alembic's
  `fileConfig` disabling pre-existing loggers (`disable_existing_loggers=False`)
  which silenced `app.*` loggers for the rest of the process after an
  in-process migration run.

- **Backend lint: fix ruff `I001` in `apps/api/app/config.py` (PR #110
  review, unblocks issue #105 AC6 "CI green"):** insert the missing blank
  line after the import block before `_detect_repo_root` (ruff isort
  formatting). Pre-existing on main since the owner's direct push `5e45ed3`;
  `ruff check app tests` now exits 0. No behavioural change.

### Changed

- **Align docs/comments with the dev-server `0.0.0.0` bind (issue #105,
  M8-T5):** reconcile the remaining docs/comments with the owner's LAN-access
  binds (commits `3ccc3a5`, `f23c6b0`) — no behavioural changes. The README
  quickstart `npm run dev` comment now reads `0.0.0.0:8123` (localhost + LAN
  reachable); the "Local run paths" intro distinguishes the bind posture per
  component (Vite dev server `0.0.0.0` by default; Docker Compose publishes
  `0.0.0.0` by design; the API keeps its loopback default + fail-closed
  opt-in guard, issue #97); the "Host-system / LAN access" section notes
  `npm run dev` is already LAN-reachable without the API opt-in; the two
  stale `#...opt-in-issue-97` anchors are fixed after the section's rename
  to "(by design, issue #97)"; stale "never exposed beyond 127.0.0.1"
  comments in `apps/web/playwright.config.ts` are corrected (the smoke test
  targets `127.0.0.1:8123`, which `0.0.0.0` still serves), the
  `vite.config.ts` `server.host` comment cites the owner decision
  (`3ccc3a5`) with the no-auth LAN caveat, and ROADMAP v2 posture lines no
  longer call v1 "loopback-only".

- **Update `milestone.md`: check off M8-T3 and mark M7–M8 follow-ups done (issue
  #103, M8-T4):** the M8-T3 record (README cleanup, issue #99) is now checked
  off as `*(merged via #102)*`, and the "Status summary" table row for
  `M7 — M8 owner follow-ups` flips from `⏳ in progress (M8-T3 #99 open)` to
  `✅ done`. The closing paragraph is unchanged and remains accurate: only the
  owner-gated items (owner UAT #95, email decision #8) remain open. Docs-only
  change; no behavioural tests required.

- **Clean up `README.md`: remove project-plan text, keep app description +
  useful steps (issue #99, M8-T3):** strips the unrelated project-plan sections
  (Goals & Non-Goals, Functional Requirements, Non-Functional, Tech Stack, Data
  Model, Milestones & Breakdown, GitHub Workflow, Risks, Immediate Next Steps,
  Shaping decisions, and the old Repo/Vision/Serving-model block) from
  `README.md`, leaving only a short app description, repository layout,
  quickstart (Docker Compose + systemd + Omarchy), env table, runbook
  (start/stop/logs/backup/restore/update), troubleshooting, demo URL, stack,
  scripts, architecture, and project-documents links. Milestone records remain
  in `milestone.md` (M8-T2) and `manifest.md` remains the charter, both already
  linked from the README. Also fixes a pre-existing broken `[Security](#security)`
  anchor to point at the Host-system / LAN access section. Docs-only change; no
  behavioural tests required.

### Added

- **Add `milestone.md` with milestone records; check off all completed items
  (issue #98, M8-T2):** adds a dedicated `milestone.md` recording the project
  milestones (M0–M7) with every completed item checked off (`- [x]`) and the
  genuinely-incomplete, owner-gated items (owner UAT M7-T3 #95, email decision
  #8) explicitly marked owner-gated/blocked rather than falsely checked.
  `README.md` "Project documents" links to `milestone.md`, and the milestone
  breakdown previously in `README.md` §6 is removed (moved to `milestone.md`),
  with the following sections renumbered.
- **Allow web/API bind to `0.0.0.0` for host-system access, with firewall port
  whitelist (issue #97, M8-T1):** adds an explicit opt-in to bind the web/API
  to `0.0.0.0` via `TIMELINE_ALLOW_NON_LOOPBACK=1` (alongside
  `TIMELINE_HOST=0.0.0.0`) so the owner can reach the app from their host
  system / LAN. The fail-closed loopback-only bind guard (`bind_guard.py`,
  issue #77) is preserved as the default — non-loopback binds are still
  refused unless the opt-in is present. `apps/api/app/config.py` gains the
  `allow_non_loopback` setting (default off) and `apps/api/app/main.py` wires
  it into the startup guard. `systemd/timeline.service` documents the opt-in
  path (env vars + commented example) and the firewall rule to whitelist the
  port (`firewall-cmd --add-port=8123/tcp` / `ufw allow 8123/tcp`), while
  keeping the loopback default safe; `README.md` "Local run paths" gains a
  "Host-system / LAN access (opt-in)" section and the security trade-off
  (binding to `0.0.0.0` exposes the app to the LAN with no auth, so it is
  opt-in only); `.env.example` documents the new var. Backend guard logic is
  pure and unit-tested in `apps/api/tests/test_bind_guard.py` (loopback
  default still passes, `0.0.0.0` without opt-in refused, `0.0.0.0` with
  opt-in allowed). `make test` passes; web `npm test` / `npm run
  test:coverage` pass with 100% `src/core` coverage maintained.

- **ROADMAP.md for v2 / post-v1 stretch goals (issue #90, M7-T2C):** adds a new
  [`ROADMAP.md`](ROADMAP.md) at the repo root capturing v2 / post-v1 stretch
  goals so future direction is stored in-repo, and links it from `README.md`
  "Project documents". Covers the v2/stretch items from the manifest non-goals
  — Google Calendar import/export sync, `/ask` over history (conversational
  querying of past events), PWA (installable/offline), and usage stats — each
  with a short description, a rough priority (P1–P3), the problem it solves,
  and an explicit "out-of-scope for v1" marker. Contains no secrets, IDs, or
  emails and is consistent with the manifest's non-goals. Docs-only change; no
  code, schema, or behavior changed, so the full API/web test suites pass
  unchanged with 100% `src/core` coverage maintained.

- **README: voxtype reuse notes, cost notes, troubleshooting (issue #91, M7-T2B):**
  adds three new README sections. **Local STT / voxtype reuse notes** documents
  how the app reuses the existing Omarchy voxtype install
  (`~/.config/voxtype/config.toml`, `~/.local/share/voxtype/models/`), how
  `STT_VOXTYPE_PATH` / `STT_MODEL_PATH` point at it, the whisper.cpp
  base/small model + 2-min cap behavior, and the `ogg → ffmpeg → wav →
  voxtype transcribe` pipeline. **Cost notes** cover the JoinGonka LLM cost
  (~$0.02/1M tokens for the `/parse` extraction path) and note that local STT
  is free/offline and Telegram is free. **Troubleshooting** covers app-won't-
  start (bind guard / port 8123 in use / boot failure), `/healthz` not
  responding, Telegram reminders not arriving (bot token / user id /
  allowlist / poll errors), voice not transcribing (voxtype path / ffmpeg /
  model / 2-min cap), and backup/restore failure. Docs-only change; the
  committed secret-hygiene pytest guard and the full API/web test suites pass
  unchanged with 100% `src/core` coverage maintained.

- **README: Omarchy quickstart + full env table (issue #89, M7-T2A):** adds a
  new **Omarchy quickstart** section to `README.md` that takes a fresh Omarchy
  machine from scratch to a running app at `http://127.0.0.1:8123` — clone,
  `apps/api` venv + `pip install`, `apps/web` `npm ci` + `npm run build`, copy
  `.env.example` → `.env`, and `systemd --user` enable + start — plus a
  verification step (health probe + browser). Adds a single consolidated
  **Environment variables** table listing every env key the app reads, grouped
  by concern (local host/port/data/log/backup/timezone, LLM/JoinGonka,
  Telegram, SMTP/email, and local STT) with a one-line purpose and default for
  each, sourced from `.env.example` (placeholders only, no secrets). Docs-only
  change; `.env.example` already documents every key the API reads, so the
  committed secret-hygiene pytest guard and the full API/web test suites pass
  unchanged with 100% `src/core` coverage maintained.

- **UI polish: empty/loading/error states, humanized dates, print month view, Showcase (issue #84, M7-T1):** adds friendly empty states with a create CTA (Timeline), loading skeletons for the Timeline and Calendar views, and error states with a **Retry** button (via new `retry` on the `useTimeline`/`useCalendar` view models). Adds a pure `src/core` `relativeLabel` helper (100% covered) and surfaces humanized relative date badges ("today", "tomorrow", "in 3 weeks") on Timeline rows, the Calendar day-drawer occurrence rows, and agenda rows. Adds print-friendly CSS (`@media print`) so the Calendar month grid prints cleanly (interactive chrome hidden, day cells never split across pages). The component Showcase gains Timeline/Calendar loading states and a create-CTA on the empty Timeline. 11 new/updated tests; full suite passes with 100% `src/core` coverage maintained.

- **Secrets hygiene audit for the public repo (issue #83, M6-T3):** adds a
  committed pytest guard `apps/api/tests/test_secrets_hygiene.py` that scans every
  git-tracked file (via `git ls-files`) for real secret patterns — Telegram bot
  tokens, JoinGonka/OpenAI API keys, GitHub PATs, AWS keys, high-entropy tokens,
  and personal email addresses — and asserts only placeholders appear. It also
  verifies `.env.example` is tracked, holds placeholders only, and documents every
  env key the API reads (now including `TIMELINE_BACKUPS_DIR` / `TIMELINE_BACKUP_KEEP`
  from the backup work), and that `.env`, `./data/`, `./backups/`, logs and
  transcripts are never tracked. README's privacy disclosure (§2.8) now states
  explicitly that data never leaves the machine except Telegram/LLM/SMTP-outbound
  and that `./data`, `./backups`, `.env`, logs and transcripts are never committed.
  4 new pytest cases; full suite passes with 100% `src/core` coverage maintained.

- **Nightly SQLite backups + rotation + one-command restore (issue #85, M6-T2):**
  adds a pure, unit-tested backup module `apps/api/app/backup.py` that dumps the
  SQLite DB (via SQLite's online backup API, WAL-safe) into `./backups/` under a
  timestamped name and prunes old backups keeping the newest `TIMELINE_BACKUP_KEEP`
  (default 30). A one-command CLI (`python -m app.backup backup|list|restore <file>`)
  gives dump+rotate, listing, and restore; backup → restore → data-intact is
  verified by a pytest round-trip test. Config gains `backups_dir` / `backup_keep`
  (`TIMELINE_BACKUPS_DIR` / `TIMELINE_BACKUP_KEEP`). Nightly runs are driven by new
  `systemd/timeline-backup.service` + `systemd/timeline-backup.timer` (02:00,
  `Persistent=true` so a missed run fires on next wake). README gains a systemd
  daily-driver runbook section (start/stop/logs/backup/restore/update). `./backups/`
  is already gitignored. 21 new pytest cases; full suite passes with 100%
  `src/core` coverage maintained.

- **Boundary test for out-of-range draft index (issue #79, M9-T1):** adds a
  test for the `_handle_callback_query` guard `action.index >= len(pending.drafts)`
  in `apps/api/app/telegram_inbound.py`, which returns
  `"That draft is no longer available."` when a callback references a draft index
  beyond the pending draft list. The test exercises the guard directly (not via
  the `pending is None` short-circuit): a chat with a single-draft pending store
  and a `draft:save:5` callback returns the expected reply.

- **Parse eval set (20 samples) + redacted logs by default (issue #76, M5-T4B):**
  adds a committed eval harness for the `POST /api/events/parse` pipeline —
  `apps/api/tests/eval/` holds 20 representative sample inputs with expected
  structured drafts (one-time future, recurrent daily/weekly/monthly/
  quarterly/yearly, “next June” relative-date resolution, maybe/series/idea →
  low priority, ambiguous → medium default, needs_clarification, multi-event in
  one message, tz/relative-date resolution, channels/tags, all-day, and the
  critical-financial draft guard). A pytest runner feeds each sample through the
  pure `llm_parse.parse_events` with an injected fake LLM client (no live
  network) and asserts the expected draft fields (title, start_at, rrule,
  priority, type, channels, tags, needs_clarification); it runs as part of the
  normal suite. Logging is redacted by default: a new pure `app.redaction`
  module provides content-free references (length + short hash for text/prompt
  bodies, basename-only for audio/voice file paths), and `llm_parse.parse_events`
  logs only a redacted reference — never raw message text, parsed content, or
  prompt bodies. Tests capture logs during a parse call and assert no raw text
  appears. 100% `src/core` coverage maintained.

- **Omarchy hardening: loopback bind guard, systemd enable, log rotation,
  /healthz (issue #77, M6-T1):** enforces a fail-closed loopback-only bind —
  a new pure `app.bind_guard` module rejects any non-loopback host
  (`0.0.0.0`, LAN/internet) at startup with a clear error, so the no-auth
  API can never be accidentally exposed to the network. The `systemd`
  `--user` unit is completed for `systemctl --user enable --now` with
  `Restart=on-failure` + `RestartSec=5` and documented start/stop/status
  commands. Logs are bounded two ways: a committed `systemd/timeline.logrotate`
  config (5 MB × 5, compressed) and a Python `RotatingFileHandler` wired via
  new `TIMELINE_LOG_FILE` / `TIMELINE_LOG_MAX_BYTES` /
  `TIMELINE_LOG_BACKUP_COUNT` settings (pure `app.logging_setup` rotation
  helper, fully unit-tested). `/healthz` now returns HTTP 200 with
  `{"status": "ok", "uptime_seconds": N}` and stays loopback-only; pytest
  asserts the guard rejects `0.0.0.0` (both pure and via `create_app`) and
  the healthz payload. 100% `src/core` coverage maintained.

- **Telegram /add → parse → Save/Edit/Discard draft flow (issue #75, M5-T4A):**
  wires the inbound `/add <text>` command to the (merged) parse logic so a
  parsed event is returned as a confirmable Telegram draft card with inline
  **Save / Edit / Discard** buttons, and only a confirmed draft is persisted as
  a real `Event`. The `/add` command reuses the pure `llm_parse.parse_events`
  module (the same logic behind `POST /api/events/parse`); on success the
  drafts are rendered as cards (title, when, all-day, recurrence, priority,
  channels, tags) with per-draft callback buttons. **Save** persists the draft
  via the existing CRUD layer as `status=draft` / `source=telegram_text`
  (never auto-activated, so a critical/financial event is never silently
  saved); **Edit** re-prompts for corrected text; **Discard** drops the draft
  with a confirmation reply. Pending draft state is held in-memory keyed by
  `chat_id` (a new `/add` replaces any pending draft), and a
  `CallbackQueryHandler` routes the `save`/`edit`/`discard` actions behind the
  same single-user allowlist. The pure draft-flow logic (card rendering,
  keyboard building, callback routing, draft → event mapping, `DraftStore`)
  lives in `apps/api/app/telegram_inbound.py` and is fully unit-tested (100%
  line coverage); the Telegram wiring stays a thin adapter.

- **Local STT for Telegram voice messages (issue #71, M5-T2):** adds
  `apps/api/app/stt.py`, a local speech-to-text module that converts a Telegram
  `voice.ogg` to a 16 kHz mono WAV via ffmpeg, then transcribes it with
  whisper.cpp by reusing the local voxtype install/model (`voxtype transcribe`,
  which loads the installed whisper model under the hood). Everything runs on
  this machine — no audio bytes are ever sent to an external service; only the
  resulting text leaves the module for the parse flow. New config fields
  `STT_VOXTYPE_PATH` / `STT_MODEL_PATH` / `STT_MAX_SECONDS` (local `.env` only,
  safe defaults). The pure orchestration/guard logic (2-minute cap, ffmpeg and
  whisper command construction, transcript extraction) is fully unit-tested
  with an injected subprocess runner; a 2-minute cap rejects over-limit voice
  messages before any conversion attempt, and a missing voxtype/whisper install
  returns a graceful `unavailable` rather than crashing. `apps/api/app/stt.py`
  is at 100% line coverage.

- **POST /api/events/parse: JoinGonka OpenAI-compatible AI parsing (issue #70,
  M5-T3):** adds a thin direct JoinGonka OpenAI-compatible fetch that turns
  free text into validated structured event draft(s). New config fields
  `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` (local `.env` only, safe
  defaults; absent key ⇒ the endpoint returns HTTP 503 `unavailable`, matching
  the web `LlmParser` contract). The pure logic lives in
  `apps/api/app/llm_parse.py` — prompt building (injecting the caller's `now`
  and `tz` for relative-date resolution), JSON-mode request construction, and
  response validation — and is fully unit-tested with an injected/mocked HTTP
  client (no real network). Supports multi-event responses and a
  `needs_clarification` follow-up when the model can't determine the event.
  Drafts are returned for confirmation only — nothing is auto-saved, so a
  critical financial event is never silently persisted. The route is a thin
  layer over the pure module (no business logic in the route). `httpx` is
  promoted to a runtime dependency for the fetch.

- **Full line coverage for the Telegram inbound bot (PR #72 review, issue #69):**
  brings `apps/api/app/telegram_inbound.py` to 100% line coverage. Adds a test
  that invokes the registered inbound handler (via the `Application`'s
  `MessageHandler` callback) with a fake message, asserting `reply_text` is
  called with the expected reply and that ignored (non-DM) messages produce no
  reply; and a test covering the naive-datetime defensive branch in `_as_utc`
  (a naive `now` is treated as UTC).

- **Telegram inbound DM command bot (issue #69, M5-T1):** adds a
  python-telegram-bot v21 polling updater in `apps/api/app/telegram_inbound.py`
  that answers the owner's private-chat commands. Messages from
  groups/channels/other users are ignored via the DM-only gate
  (`is_private_chat`) and the single-user allowlist (`TELEGRAM_USER_ID`,
  fail-closed). Commands: `/today` (list today's events), `/upcoming [7d|30d]`
  (default 7d, list upcoming events), `/low` (list low-priority events on
  demand), `/add <text>` (route to parse → draft flow — a stub until the parse
  endpoint, issue #70, is merged) and `/ask <question>` (LLM query over
  history — a stub until the query endpoint lands). No bot token configured ⇒
  the inbound updater is a no-op (never polls), same guard style as the
  outbound sender. The pure command logic (DM gate, command parsing, upcoming-
  days parsing, event listing for today/upcoming/low, line formatting, command
  dispatch and the inbound-record builder) lives in the module and is fully
  unit-tested; the Telegram wiring (`_handle_update` /
  `build_telegram_inbound_application` / `record_inbound`) is a thin adapter
  over the library. Inbound DM messages are persisted to the existing
  `TelegramInbound` table.

- **Test for uncovered defensive branch in telegram_outbound.py (issue #66):**
  adds a test covering the `event is None` branch in the repeat-until-ack
  wiring of `make_telegram_job_func` (the event-deleted-mid-flight case). The
  test monkeypatches `deliver_reminder` so the event is deleted between
  delivery and the follow-up scheduling step, asserting the job returns the
  delivered result without scheduling a repeat. This brings
  `app/telegram_outbound.py` to 100% line coverage.

- **Delivery log + reminder preview UI in the web app (issue #63):** surfaces
  the reminder/delivery history in the event drawer. A new API endpoint
  `GET /api/events/{id}/deliveries` exposes an event's `DeliveryLog` rows
  (event, occurrence, offset, status, timestamps) newest-first, backed by a
  thin crud helper (`list_deliveries`) and a `DeliveryLogRead` schema. The
  event drawer now renders a **Delivery log** section alongside the existing
  reminder preview, showing each delivery's status badge (scheduled / sent /
  failed / acknowledged / snoozed / deleted), a human timestamp and an
  occurrence+offset detail line, with empty/loading/error states. The pure
  delivery-log formatting and status mapping live in `src/core/deliveryLog.ts`
  (100% covered); the view model (`useEventDrawer`) fetches and derives rows
  and the `EventDrawer` component stays thin and dumb. The Showcase gallery
  gains a populated delivery-log drawer preview. New `getEventDeliveries`
  method on the `ApiClient`.

- **Email reminder sender behind a feature flag (issue #61):** adds an email
  outbound module in `apps/api/app/email_outbound.py` that sends a reminder
  email (subject/body with event title, occurrence time, offset, notes and
  occurrence id) when the `EMAIL_ENABLED` feature flag is on. The flag defaults
  to **off** in v1, so no email is ever sent while it is off regardless of an
  event's `channels`; when on, email is delivered only for events whose
  `channels` include `email`. SMTP credentials (`SMTP_HOST`/`SMTP_PORT`/
  `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`SMTP_TO`) are read from local `.env`
  only and never committed; `redact_credentials` keeps the password out of
  logs. Pure helpers (`should_send_email`, `build_email_message`,
  `build_smtp_config`, `redact_credentials`) are unit-tested in isolation and
  the SMTP client is injected/mocked (no real network) and the real
  `smtplib.SMTP` connect/STARTTLS/login/quit path in `_dispatch_send` is
exercised via a monkeypatched SMTP (no real I/O); the job func reuses
  `deliver_reminder` so at-least-once / audit-trail semantics are preserved.
  New `Settings` fields (`email_enabled`, `smtp_*`) are covered by config tests.

- **Wire per-event reminder config + quiet-hours digest into scheduler delivery (issue #62):**
  the scheduler/outbound delivery now honors each event's reminder settings read
  from the Event model. Delivery only pushes to configured `channels` (a
  Telegram-only check in the outbound sender means an event not configured for
  Telegram is never pushed), `repeat_until_ack` re-schedules a delivered
  reminder until it's acknowledged (a follow-up job with a distinct occurrence
  id is scheduled after each unacknowledged delivery; acknowledging any repeat
  traces back to the base delivery and stops the loop), and `snooze_allowed`
  disables the Snooze button (and rejects a Snooze callback) when false.
  Quiet hours (`quiet_hours_start`/`quiet_hours_end`, default `22:00-08:00`)
  defer any reminder whose run time falls inside the window to a morning digest
  (the next local morning after quiet-hours end) instead of pushing immediately,
  applied in `schedule_plan`. Low-priority events still send nothing (consistent
  with `should_push`). All pure logic lives in `apps/api/app/scheduler.py`
  (quiet-hours helpers `in_quiet_hours`/`defer_to_morning_digest`/
  `quiet_hours_run_time`, `channel_allows`, `should_repeat_until_ack`,
  `base_occurrence_id`, `repeat_until_ack_plan`) and the outbound wiring in
  `apps/api/app/telegram_outbound.py`, fully covered by pytest.

- **Component Showcase + Playwright smoke test (issue #56):** adds a dev-only
  Showcase gallery at `/?showcase=1` (rendered by a new `Root` component that
  switches between the normal app and the gallery) demonstrating every UI
  component in `src/ui/components` (AppShell, TimelineView, CalendarView,
  SummaryBar, EventDrawer, EventWizard + WizardStepOne/Two/Three,
  SearchFilterBar, SmartInputBox, ThemeToggle, DemoPanel) across its key states
  (empty, populated, error, dark/light, narrow/mobile). The gallery is purely
  presentational: it injects fake services via `ShowcaseServicesProvider`
  (the same React-context injection pattern the real app uses), so it runs with
  no backend and no business logic. Adds a Playwright smoke test
  (`apps/web/tests/e2e/smoke.spec.ts`, `npm run test:e2e`) that boots the Vite
  dev server on loopback `127.0.0.1:8123`, intercepts the API routes with
  sample JSON, and asserts the app shell, Timeline, Calendar and summary bar
  all render. The smoke test is wired into the `CI` workflow; the Vite dev/
  preview servers are now bound to `127.0.0.1:8123` to match the project's
  loopback-only convention.

- **Telegram outbound reminder sender with Ack/Snooze/Delete (issue #55):**
  adds the Telegram outbound module in `apps/api/app/telegram_outbound.py`
  (python-telegram-bot v21) that turns a due reminder from the M4-T1 scheduler
  into a priority card with emoji, title, date/time, countdown and notes, plus
  inline **Acknowledge** / **Snooze 1d** / **Delete** buttons. Button callbacks
  are persisted to `DeliveryLog` (`acked`/`snoozed`/`deleted`), and Snooze
  re-schedules the reminder one day later through APScheduler (distinct dedupe
  key). A single-user allowlist is enforced via `TELEGRAM_USER_ID` (from local
  `.env`, never committed) and fails closed; low-priority events are never
  pushed. The scheduler job function (`make_telegram_job_func`) reuses the
  scheduler's `deliver_reminder` so at-least-once semantics and the audit trail
  are preserved. Pure helpers (`priority_emoji`, `should_push`,
  `is_allowed_user`, `countdown_text`, `format_reminder_card`,
  `callback_data`/`parse_callback_data`, `ack_delivery`, `snooze_delivery`,
  `delete_delivery`, `handle_callback`) are unit-tested with a mocked bot (no
  real network), bringing `app/telegram_outbound.py` to 100% coverage. New
  `BOT_TOKEN`/`TELEGRAM_USER_ID` settings are loaded from `.env`.

- **Persistent APScheduler jobstore + at-least-once reminder scheduling (issue #57):**
  adds the persistent reminder scheduler foundation in `apps/api/app/scheduler.py`
  using APScheduler with a SQLite-backed jobstore (WAL, under `./data`, gitignored)
  so the job queue survives app restarts. Reminder jobs are keyed by a dedupe key
  `(event_id, occurrence_id, offset)` so the same reminder is never scheduled twice
  across restarts; a reminder whose run time passed while the app was down is drained
  to run immediately on startup (`drain_schedule`), and a failed delivery is recorded
  in `DeliveryLog(status="failed")` and requeued rather than silently dropped
  (`requeue_failed`, `with_retry`, `deliver_reminder`). The scheduler reads per-event
  reminder config (`reminder_offsets`, `remind_time_of_day`) from the DB and schedules
  jobs for upcoming occurrences. Pure helpers (`parse_offset`, `dedupe_key`,
  `reminder_run_time`, `schedule_plan`, `with_retry`) are unit-tested in isolation;
  pytest covers job persistence across a simulated restart, dedupe on identical
  schedule, at-least-once retry on failure, and the defensive skip of malformed
  failed `DeliveryLog` rows with missing `occurrence_id`/`offset` (bringing
  `app/scheduler.py` to 100% coverage). This is the scheduling foundation for
  the Telegram outbound sender (M4-T2).

- **Add missing tests for PR #50 (issue #51):** closes two non-blocking test
  gaps flagged by the Review Engineer on the search/filter work (#46/#50). Adds
  an `App.test.tsx` typing-guard case that fires `keyDown` with `/` and `c`
  while focus is inside an INPUT and asserts the search box is not re-focused
  and `openCreate` is not called; and adds `filterOccurrences` AND-combination
  tests (text+priority and text+tag) mirroring the existing `filterEvents` AND
  test. Core coverage stays at 100%.

- **Dark/light theme toggle + responsive polish (issue #48):** adds a theme
  toggle in the app-shell header that switches the whole app between light and
  dark, persisted in `localStorage` and applied across all views (Timeline,
  Calendar, wizard, drawer, summary bar). Every component gained
  `dark:` Tailwind variants (via `darkMode: "class"`) so nothing is illegible
  in dark mode, and the header, summary bar, wizard modal and calendar controls
  were made responsive for narrow/mobile widths (e.g. 360px). Theme state is
  provided through the existing context-injection pattern (`ThemeProvider` +
  `useTheme`, no global singletons); the pure toggle/normalize/label
  derivation lives in `src/core/theme` (100% Vitest-covered), persistence and
  DOM application live in a `src/adapters/themeStorage` adapter, and the toggle
  itself is a thin dumb component.

- **Smart-input "Add event…" box calling `/parse` (issue #47):** adds a
  free-text smart-input box in the app-shell header that accepts natural
  language (e.g. "dentist next Tuesday 3pm") and calls the `/parse` endpoint
  through the injected `llmParser` service. On a successful parse, the returned
  draft is guarded and pre-fills the 3-step create wizard (What/When →
  Recurrence → Priority & Reminders) for confirmation before saving. On parse
  failure or an empty/unusable result, a clear inline error is shown and no
  draft is created. When the LLM key is absent (HTTP 503) or a network/API
  error occurs, the user is told parsing is unavailable and can still use the
  wizard manually via the + New action. All parsing/guarding and draft
  conversion logic lives in a pure `src/core/llmParse`/`parseGuards` extension
  (`draftFromParsed`/`parsedToWizardDraft`, 100% Vitest-covered); a thin
  `useSmartInput` view model holds the text/parse/error state and a dumb
  `SmartInputBox` component renders it.

- **Search/filter events + `/` shortcut (issue #46):** adds an app-wide search
  box in the app-shell header plus priority/tag/month filter controls that
  narrow the events shown in both the Timeline and Calendar views. Free-text
  matching is case-insensitive and spans title, notes and tags; the filters
  combine with AND semantics. The tag and month dropdown options are derived
  from the loaded events. Pressing `/` focuses the search box (no conflict with
  the existing `c` create shortcut), and Esc in the search box clears the
  filters and blurs. An active filter that excludes everything shows a clear
  "No matches." empty state. All matching/filtering logic lives in a new pure
  `src/core/searchFilter` module (100% Vitest-covered); a thin `useSearchFilter`
  view model holds the filter state and a dumb `SearchFilterBar` component
  renders the controls.

- **Week-grid chip click test (issue #44):** adds a `CalendarView` test that
  switches to the Week mode, clicks a week-grid `WeekChip`, and asserts the
  `onEventClick` callback is invoked with the matching occurrence — closing the
  last uncovered AC1 wiring path from PR #43.

- **Event drawer with next occurrences + reminder preview (issue #38):** adds a
  read-only event drawer that opens when an event is clicked (from the Timeline
  or the Calendar's day drawer / agenda). It shows the event's title, priority,
  tag, recurrence badge and notes, lists the event's next occurrences (fetched
  via `apiClient.getOccurrences` and filtered/sorted by a new pure
  `src/core/eventDrawer` `eventNextOccurrences`), and renders a reminder preview
  (channels, offsets like `7d / 1d / 2h`, and remind-time-of-day) derived by a
  new pure `reminderPreview`/`formatReminderOffsets` (100% Vitest-covered). A
  thin `useEventDrawer` view model holds the selected event, fetches
  occurrences, resolves a full event from a calendar occurrence via
  `apiClient.getEvent`, and closes on Esc; a dumb `EventDrawer` component
  renders it. The drawer closes via ✕/Esc and shows a clear empty state when no
  event is selected, and offers an Edit action that opens the existing wizard.
  Calendar occurrence rows now accept an optional `onEventClick` to open the
  drawer.

- **App-level keyboard-shortcut tests (issue #39):** adds a new
  `apps/web/tests/ui/App.test.tsx` that renders the app root and verifies the
  acceptance-criterion 6 behavior — pressing the `c` key opens the create
  wizard, other keys don't, an already-open wizard isn't re-opened, the `+ New`
  header action opens it, and the keydown listener is removed on unmount.

- **3-step create/edit event wizard (issue #39):** adds a modal wizard that
  captures a new event or edits an existing one across three steps — What/When
  (title, notes, date/time or all-day, timezone), Recurrence (none / daily /
  weekly / monthly / quarterly / yearly / custom with an RFC 5545 rule), and
  Priority & Reminders (critical / medium / low, reminder channels and
  offsets). A new pure `src/core/eventWizard` module holds the draft, validates
  each step (so an incomplete event can't be submitted), derives the RRULE the
  API expects, pre-fills a draft from an existing event for edit mode, and
  builds the create/update payloads (100% Vitest-covered). A thin
  `useEventWizard` view model performs the create/update I/O through the
  injected `apiClient` (a new `updateEvent`/`PATCH` method was added), and
  dumb `EventWizard`/`WizardStepOne`/`WizardStepTwo`/`WizardStepThree`
  components render each step. The wizard opens from a `+ New` header action
  (wired via a new `AppShell` `actions` slot) or the `c` keyboard shortcut, and
  clicking a timeline row opens it pre-filled for editing; save reflects
  success/error states.

- **Summary bar: events this month by priority, next 7 days, overdue highlight
  (issue #37):** renders a summary bar in the `AppShell` header `summarySlot`
  fed by `GET /api/summary?month=YYYY-MM`. The bar shows the current month's
  total occurrences plus a per-priority (critical / medium / low) breakdown
  via the existing `src/core/summaryCounts` `monthlyCounts`, and a "next 7
  days" tally with an overdue highlighted state via `nextSevenDays`.
  A new pure `summaryBar` derivation in `src/core/summaryCounts` combines both
  counts into one renderable model (100% Vitest-covered). A thin `useSummary`
  view model fetches the current month's summary through `apiClient.getSummary`
  via `useServices()`, and a dumb `SummaryBar` component renders the result
  (wired into `App.tsx`'s `summarySlot`). Empty/zero state renders cleanly with
  no misleading counts.

- **Deterministic SummaryBar component tests (issue #37):** extends
  `apps/web/tests/ui/SummaryBar.test.tsx` to cover the remaining render
  branches of the summary bar deterministically, regardless of the date the
  suite runs on. The next-7-days tally is now asserted for both the overdue
  highlight (`hasOverdue: true` → "N overdue in next 7 days") and the
  non-overdue case (`hasOverdue: false` → "N in next 7 days", with no
  "overdue" text), and the initial loading state ("Loading summary…") is
  covered via a mocked `useSummary` view model.

- **Missing tests for occurrences December rollover (issue #31):** adds
  boundary tests for the `month == 12` year-rollover branch of
  `_next_after_month` in `apps/api/app/occurrences.py`. A new pure test in
  `apps/api/tests/test_occurrences.py` verifies a monthly event queried for
  `month=2026-12` returns a `next_occurrence` of `datetime(2027, 1, 15, ...)`
  (rolling into the following January), and a new endpoint-level test verifies
  `GET /api/events/occurrences?month=2026-12` returns a `next_occurrence` in
  2027-01. Previously all `next_occurrence` tests used `month=1`, leaving the
  December branch untested.

- **Missing tests for AppShell view-switcher + summary slot (issue #26):**
  adds a component test suite in `apps/web/tests/ui/AppShell.test.tsx` covering
  the app-shell acceptance criteria from issue #21: clicking the 'Calendar'
  tab calls `onViewChange('calendar')` and clicking 'Timeline' calls
  `onViewChange('timeline')`; the active tab sets `aria-pressed` accordingly;
  and the `summarySlot` content is rendered in the header slot.

- **Missing tests for apiClient network-rejection path (issue #24):** adds a
  Vitest case in `apps/web/tests/core/apiClient.test.ts` covering the
  network-rejection (fetch throws) error path of `createApiClient`'s
  `request()` helper, which previously only had success and non-2xx
  (`ok:false`) paths tested. Verifies the raw fetch rejection propagates
  unchanged (not wrapped in an `ApiError`), matching the existing behavior.

- **Calendar view: week grid + agenda list (issue #29):** the web app's
  Calendar view now has three switchable sub-modes (Month / Week / Agenda),
  completing the Calendar view split out of #22. The **week grid** renders
  seven day columns (Sunday-first) with each day's occurrences placed as
  chips — all-day events on top, timed events below, each with a time label
  and priority styling — and is navigable week-by-week with a human week
  label (e.g. "Sep 6 – Sep 12, 2026") that handles year boundaries. The
  **agenda list** shows upcoming occurrences chronologically (date, title,
  time or "All day", priority color/icon, tag badge, recurrence badge) with
  a clear empty state. All derivation lives in new pure functions in
  `src/core/calendar` (`weekStart`, `weekDays`, `weekLabel`, `weekGrid`,
  `navigateWeek`, `withWeekOccurrences`, `daySlots`, `timeLabel`,
  `upcomingAgenda`, `toAgendaRow`) which are 100% Vitest-covered; the
  `useCalendar` view model stays thin (it only adds a mode cursor + week
  cursor and consumes services via `useServices()`); the components remain
  dumb. The `AppShell` view switcher still routes to the Calendar view.

- **Calendar view: month grid + day drawer (issue #28):** the web app's
  Calendar view now renders a custom Tailwind month grid (no third-party
  calendar lib) with per-day event dots/counts, prev/next month navigation and
  a current-month label, and a day drawer that lists a selected day's
  occurrences (title, time, priority color/icon, tag badge, recurrence badge
  via `src/core/recurrenceFormat`, and a next-occurrence hint where
  available). Events are sourced from `GET /api/events/occurrences?month=YYYY-MM`
  (the per-occurrence endpoint from issue #27), so no recurrence port is
  needed in `src/core`. All derivation lives in a new pure
  `src/core/calendar` module (`monthKey`, `monthLabel`, `navigateMonth`,
  `monthGrid`, `dayOccurrences`, `withOccurrences`, `toOccurrenceRow`) which
  is 100% Vitest-covered; the view model (`useCalendar`) is thin and consumes
  services via `useServices()` context injection; the components are dumb. The
  `apiClient` gains a `getOccurrences(month)` method for the new endpoint.

- **Per-occurrence API endpoint (issue #27):** the API now exposes
  `GET /api/events/occurrences?month=YYYY-MM`, which returns each active
  event's concrete occurrences falling in that month (interpreted in each
  event's timezone) so the calendar grid can place recurrent events without
  porting the recurrence engine to TypeScript. Each entry carries `event_id`,
  `title`, `priority`, `tag` (first tag, for the tag badge), `rrule` (for the
  recurrence badge), `start_at`, `all_day`, `tz`, and `next_occurrence` (the
  next occurrence at/after the month, for the day drawer). One-time events
  contribute a single occurrence; recurrent events contribute one entry per
  occurrence in the month (reusing `occurrences_in_month`). Invalid months
  return 422; empty months return an empty list. The logic lives in a new pure
  `apps/api/app/occurrences.py` module (`occurrences_for_month`, 100%
  pytest-covered) with a thin handler wired in `routes.py` and a Pydantic
  response schema (`EventOccurrenceRead`) mirroring the shared event schema v1.

- **App shell + Timeline view (issue #21):** the web app now has a no-login
  localhost app shell (`AppShell`) with a top-level layout, a header that hosts
  the summary-bar slot (wired in a later issue), and a Timeline / Calendar view
  switcher. The primary Timeline view lists events grouped by month (and week
  within month) sorted chronologically, with an infinite-scroll / "load more"
  pagination over `GET /api/events`. Each event row shows title, a derived time
  label, a priority color + icon, a tag color + icon, and a recurrence badge
  (formatted via `src/core/recurrence-format`) when the event recurs. All
  derivation lives in a new pure `src/core/timeline` module (`groupByMonth`,
  `weekInMonth`, `eventTimeLabel`, `priorityStyle`, `tagStyle`, `toEventRow`,
  `paginate`, `hasMore`) which is 100% Vitest-covered; the view model
  (`useTimeline`) is thin and consumes services via `useServices()` context
  injection; the components are dumb. `paginate` implements **cumulative**
  infinite-scroll semantics: clicking "Load more" appends the next page to the
  previously visible events (`events.slice(0, (page+1)*size)`) rather than
  replacing them, and the tests assert prior events persist after loading more.

- **Web UI foundation (issue #20):** the React web app now has a pure,
  fully-covered `src/core` foundation plus injected services and the atomic
  folder scaffold the M3 UI builds on. Pure core modules: `recurrenceFormat`
  (formats an RFC 5545 rrule into a human label — daily/weekly/monthly/
  quarterly/yearly/custom, "every quarter", "every 2 weeks"); `summaryCounts`
  (derives "events this month by priority" and "next 7 days" counts from
  `GET /api/summary` payloads with overdue highlight logic); `parseGuards`
  (validates/normalizes a parsed event draft and decides a safe-default
  priority — medium when uncertain, low on maybe/series/idea, and never
  auto-downgrades a critical financial event); `dateFmt` (ISO ↔ local,
  humanized "in 3 weeks", month labels); and `eventTypes` (shared wire types).
  A pure service layer (`apiClient` typed fetch wrappers for
  `GET/POST /api/events` and `GET /api/summary?month=YYYY-MM`; `llmParse`
  calling `POST /api/events/parse`) is injected via a single React
  `ServicesProvider` + `useServices()` hook — components consume services from
  context and never instantiate them directly. The atomic folder scaffold
  (`src/ui/atoms|molecules|organisms|templates|pages`) is created for later
  milestones. `src/core/**` is 100% Vitest-covered (lines/branches/functions/
  statements); `npm run lint`, `npm test`, `npm run test:coverage`, and
  `npm run build` all pass.
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
