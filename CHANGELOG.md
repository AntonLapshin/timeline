# Changelog

All notable changes to **timeline** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
