# timeline — Project State

> Current state and progress. Updated by the auto-pi loop as work is done.

## Status

**In progress (M2 — Core domain: events, recurrence, local API, SQLite).**
M1 implementation is merged (monorepo skeleton, backend skeleton, tooling
gates, local run paths, need-owner issues filed). The M2 core-domain slice is
now planned and in flight. The six M1 need-owner issues (#5–#10) remain
`pi:blocked` awaiting owner input (secrets/access to local `.env` only); each
has a documented fallback and does not block M2.

## What's here

- Vite + React + TypeScript + Tailwind project scaffold (apps/web).
- Monorepo: `apps/api` (FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic, SQLite
  WAL under `./data`, loopback-only `/healthz`), `packages/shared` (event JSON
  schema v1 + enums), npm workspaces at root.
- Tooling gates: ruff, mypy, pytest, eslint max-warnings 0, pre-commit +
  gitleaks, Vitest 100% coverage on `src/core/**/*.ts`; CI runs all + secret scan.
- Local run paths: `docker-compose.yml` (dev) + `systemd/timeline.service`
  example bound to `127.0.0.1:8123`.
- `.gitignore` covers `.env`, `data/`, `backups/`, `*.db*`, audio, logs;
  `.env.example` placeholders only (no secrets).
- Manifest (M1–M7) and project-state tracked in-repo.

## Next steps (planned issues)

M2 — Core domain (current batch, pi:ready):
- [ ] #M2-T1 — Domain models + Alembic migrations on SQLite WAL (pi:ready, p1).
- [ ] #M2-T2 — Recurrence expansion: rrule + tz/all-day + next_occurrences (pi:ready, p2).
- [ ] #M2-T3 — Event CRUD + summary endpoint + seed data (pi:ready, p3).

M1 (owner-in-the-loop, pi:blocked — not blocking M2):
- [ ] #5 — natalies-corner access / local path (pi:blocked, p1).
- [ ] #6 — JoinGonka LLM_BASE_URL / LLM_MODEL / API key (pi:blocked, p1).
- [ ] #7 — Telegram bot + BOT_TOKEN / TELEGRAM_USER_ID (pi:blocked, p1).
- [ ] #8 — Email decision for v1 (SMTP/Resend or skip) (pi:blocked, p2).
- [ ] #9 — tz / locale / quiet hours / license (MIT?) (pi:blocked, p2).
- [ ] #10 — Confirm voxtype installed / install via Omarchy (pi:blocked, p2).

Further milestones (M3 web UI, M4 reminder engine, M5 Telegram inbound/STT/AI,
M6 hardening/backups, M7 polish/docs) will be planned on later PM turns once the
current batch is in flight.

## Changelog (CHANGELOG.md)

See CHANGELOG.md for the detailed history.
