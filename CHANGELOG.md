# Changelog

All notable changes to **timeline** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
