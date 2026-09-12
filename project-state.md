# timeline — Project State

> Current state and progress. Updated by the auto-pi loop as work is done.

## Status

**In progress (M1 — Public repo, scaffolding, Omarchy baseline).** The initial
React + Tailwind + TypeScript scaffold is in place; M1 backend/monorepo/tooling
work is now planned and in flight.

## What's here

- Vite + React + TypeScript + Tailwind project scaffold.
- Core/UI split with `src/core` (business logic) and `src/ui` (thin views).
- Vitest with 100% coverage enforced on `src/core/**/*.ts`.
- An initial demo panel rendering project name / status / demo info.
- Manifest (M1–M7) and project-state tracked in-repo.

## Next steps (planned issues)

M1 — Public repo, scaffolding, Omarchy baseline:
- [ ] #M1-T1 — Set up monorepo structure + backend skeleton + tooling gates (pi:ready, p1).
- [ ] #M1-T2 — Add local run paths: docker-compose + systemd service example (pi:ready, p2).
- [ ] #M1-T3 — File need-owner access issues (#1-#7) for owner-in-the-loop inputs (pi:ready, p1).

Further milestones (M2 core domain, M3 web UI, M4 reminder engine, M5 Telegram
inbound/STT/AI, M6 hardening/backups, M7 polish/docs) will be planned on later
PM turns once the current batch is in flight.

## Changelog (CHANGELOG.md)

See CHANGELOG.md for the detailed history.
