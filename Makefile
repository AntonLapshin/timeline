# Timeline — one-command lifecycle.
#
# Host run (native, voxtype-capable) — default targets:
#
#   make start   prod run on the host (api :8124 + web :8123) + boot autostart
#   make stop    stop the host run and remove boot autostart
#   make restart rebuild the web bundle + restart the host run (keeps autostart)
#   make status  unit state + API health
#   make logs    follow host-run logs (journald, api + web)
#
# Docker run (compose stack, web + api; no voice transcription):
#
#   make docker-dev     dev stack: build + up, wait for API health, print URLs
#   make docker-restart dev stack: down + docker-dev (rebuild + up, wait, print URLs)
#   make docker-start   prod stack: build + up, install + enable boot autostart
#   make docker-stop    stop the stack and remove boot autostart
#   make docker-status  compose ps + API healthz
#   make docker-logs    follow compose logs
#
#   make help    this list (default target)
#
# The host and docker runs share ports (web 8123, api 8124), so only one runs
# at a time: `make start` best-effort stops the compose stack (and the legacy
# hand-installed `timeline.service` example, which binds the same web port),
# and `make docker-start` best-effort stops the host units.
#
# Secrets come from the local, gitignored `.env` (copied from `.env.example`
# on first run, never overwritten). No secrets live in this file or in the
# systemd units. Docker targets require Docker access (user in the `docker`
# group, or run via sudo). Host targets require the API venv
# (`apps/api/.venv`, see `apps/api/Makefile`) and web dependencies
# (`node_modules`, via `npm ci`).

COMPOSE ?= docker compose
DOCKER_BIN ?= $(shell command -v docker 2>/dev/null || echo /usr/bin/docker)

WEB_URL ?= http://127.0.0.1:8123/timeline/
HEALTHZ_URL ?= http://127.0.0.1:8124/healthz
HEALTH_WAIT_SECONDS ?= 90

DOCKER_UNIT_NAME ?= timeline-compose.service
DOCKER_UNIT_SRC ?= systemd/timeline-compose.service.in
DOCKER_UNIT_DIR ?= $(HOME)/.config/systemd/user
DOCKER_UNIT_DST ?= $(DOCKER_UNIT_DIR)/$(DOCKER_UNIT_NAME)

HOST_API_NAME ?= timeline-api.service
HOST_API_SRC ?= systemd/timeline-api.service.in
HOST_WEB_NAME ?= timeline-web.service
HOST_WEB_SRC ?= systemd/timeline-web.service.in
HOST_UNIT_DIR ?= $(HOME)/.config/systemd/user
HOST_API_DST ?= $(HOST_UNIT_DIR)/$(HOST_API_NAME)
HOST_WEB_DST ?= $(HOST_UNIT_DIR)/$(HOST_WEB_NAME)

VENV_BIN ?= $(CURDIR)/apps/api/.venv/bin
UVICORN_BIN ?= $(VENV_BIN)/uvicorn
ALEMBIC_BIN ?= $(VENV_BIN)/alembic
VITE_BIN ?= $(CURDIR)/node_modules/.bin/vite

.DEFAULT_GOAL := help
.PHONY: help start stop restart status logs \
	docker-dev docker-restart docker-start docker-stop docker-status docker-logs \
	env build-web wait-health print-urls check-host-deps \
	install-docker-unit remove-docker-unit install-host-units remove-host-units

help:
	@echo "Timeline — host run (native, voxtype-capable) + docker-compose stack"
	@echo
	@echo "  Host (default; autostarted on boot once started):"
	@echo "    make start   Run on the host (api :8124 + web :8123) + boot autostart"
	@echo "    make stop    Stop the host run and remove boot autostart"
	@echo "    make restart Rebuild web + restart the host run (keeps autostart)"
	@echo "    make status  Show unit state + API health"
	@echo "    make logs    Follow host-run logs (journald, api + web)"
	@echo
	@echo "  Docker (compose stack; no voice transcription):"
	@echo "    make docker-dev     Start the dev stack (build + up -d), wait, print URLs"
	@echo "    make docker-restart Restart the dev stack (compose down + docker-dev)"
	@echo "    make docker-start   Prod: stack up (built images, migrations via API CMD) + boot autostart"
	@echo "    make docker-stop    Stop the stack (compose down) and remove boot autostart"
	@echo "    make docker-status  Show compose ps + API health"
	@echo "    make docker-logs    Follow compose logs (web + api)"
	@echo
	@echo 'LAN exposure is by design and unauthenticated — trusted LAN only.'
	@echo 'Firewall whitelist: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# --- host run (native) -------------------------------------------------------
#
# API runs natively (uvicorn :8124) so local-only deps work (voxtype + ffmpeg
# voice transcription); web serves the production build (`vite preview` :8123,
# proxying /api + /healthz to the API). `make start` enables boot autostart
# (systemd --user units, linger required); `make stop` removes it.

# Prod: build web + install/enable/start the host units + health wait + URLs.
start: env check-host-deps build-web
	@$(MAKE) --no-print-directory install-host-units
	@$(COMPOSE) down 2>/dev/null || true
	@systemctl --user disable --now timeline.service 2>/dev/null || true
	@systemctl --user enable --now $(HOST_API_NAME) $(HOST_WEB_NAME)
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls
	@echo 'Boot autostart: $(HOST_API_DST) + $(HOST_WEB_DST) enabled (linger required; see README).'
	@echo 'Voice transcription runs locally via voxtype (host-only; the docker stack cannot do this).'
	@echo 'Reminder: LAN access is unauthenticated (trusted LAN only); firewall: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Stop: stop + disable/remove the host units. Idempotent.
stop:
	@systemctl --user disable --now $(HOST_API_NAME) $(HOST_WEB_NAME) 2>/dev/null || true
	@rm -f $(HOST_API_DST) $(HOST_WEB_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(HOST_API_NAME) $(HOST_WEB_NAME) 2>/dev/null || true
	@echo "Host run stopped; boot autostart removed (idempotent)."

# Restart: rebuild web + restart services (keeps autostart; installs units if missing).
restart: env check-host-deps build-web
	@$(MAKE) --no-print-directory install-host-units
	@systemctl --user restart $(HOST_API_NAME) $(HOST_WEB_NAME)
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls

# Status: unit state + API health (direct + via the web proxy).
status:
	@systemctl --user is-active $(HOST_API_NAME) $(HOST_WEB_NAME)
	@curl -fsS --max-time 3 $(HEALTHZ_URL) && echo || echo "API unhealthy at $(HEALTHZ_URL)"

# Logs: follow journald logs for the host run.
logs:
	journalctl --user -f -n 100 -u $(HOST_API_NAME) -u $(HOST_WEB_NAME)

# --- docker run (compose) ----------------------------------------------------

# Dev: .env bootstrap (never overwrites) + build + up + health wait + URLs.
docker-dev: env
	$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls
	@echo 'Reminder: LAN access is unauthenticated (trusted LAN only); firewall: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Restart: compose down + docker-dev (build + up + health wait + URLs).
docker-restart:
	$(COMPOSE) down
	@$(MAKE) --no-print-directory docker-dev

# Prod: stack up + install/enable the boot-autostart systemd --user unit.
docker-start: env
	@systemctl --user stop $(HOST_API_NAME) $(HOST_WEB_NAME) 2>/dev/null || true
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory install-docker-unit
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls
	@echo 'Boot autostart: $(DOCKER_UNIT_DST) enabled (runs "$(COMPOSE) up -d" in $(CURDIR) at boot/login).'
	@echo 'Reminder: LAN access is unauthenticated (trusted LAN only); firewall: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Stop: compose down + disable/remove the boot-autostart unit. Idempotent.
docker-stop:
	$(COMPOSE) down
	@systemctl --user disable --now $(DOCKER_UNIT_NAME) 2>/dev/null || true
	@rm -f $(DOCKER_UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(DOCKER_UNIT_NAME) 2>/dev/null || true
	@echo "Stack stopped; boot autostart removed (idempotent)."

# Status: compose ps + API healthz.
docker-status:
	$(COMPOSE) ps
	@curl -fsS --max-time 3 $(HEALTHZ_URL) && echo || echo "API unhealthy at $(HEALTHZ_URL)"

# Logs: follow compose logs.
docker-logs:
	$(COMPOSE) logs -f --tail=100

# --- internal targets --------------------------------------------------------

# Internal: copy .env.example -> .env only if .env is missing; never overwrite.
env:
	@if [ -f .env ]; then \
		echo ".env exists — leaving it untouched (secrets stay local)"; \
	else \
		cp .env.example .env && echo "Created .env from .env.example — fill in local values (gitignored)"; \
	fi

# Internal: fail fast when the host-run prerequisites are missing.
check-host-deps:
	@if [ ! -x "$(UVICORN_BIN)" ] || [ ! -x "$(ALEMBIC_BIN)" ]; then \
		echo "ERROR: API venv missing ($(VENV_BIN)). Create it first:" >&2; \
		echo "  cd apps/api && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt" >&2; \
		exit 1; \
	fi
	@if [ ! -x "$(VITE_BIN)" ]; then \
		echo "ERROR: web dependencies missing ($(VITE_BIN)). Install them first:" >&2; \
		echo "  npm ci" >&2; \
		exit 1; \
	fi

# Internal: build the production web bundle served by `vite preview`.
build-web:
	npm run build -w apps/web

# Internal: poll GET $(HEALTHZ_URL) until ok or timeout (migrations run first).
wait-health:
	@echo "Waiting for API health at $(HEALTHZ_URL) (up to $(HEALTH_WAIT_SECONDS)s) ..."
	@i=0; until curl -fsS --max-time 2 $(HEALTHZ_URL) >/dev/null 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge $(HEALTH_WAIT_SECONDS) ]; then \
			echo "ERROR: $(HEALTHZ_URL) not healthy after $(HEALTH_WAIT_SECONDS)s" >&2; exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "API healthy."

# Internal: print local + LAN + healthz URLs.
print-urls:
	@echo "Web:    $(WEB_URL)"
	@lan=$$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]\{1,15\}\).*/\1/p' | head -1); \
		[ -n "$$lan" ] || lan=$$(hostname -I 2>/dev/null | awk '{print $$1}'); \
		if [ -n "$$lan" ]; then echo "LAN:    http://$${lan}:8123/timeline/"; fi
	@echo "Health: $(HEALTHZ_URL)"

# Internal: install + enable the compose boot-autostart unit (paths substituted).
install-docker-unit:
	@mkdir -p $(DOCKER_UNIT_DIR)
	@sed -e 's|@REPO_DIR@|$(CURDIR)|g' -e 's|@DOCKER@|$(DOCKER_BIN)|g' $(DOCKER_UNIT_SRC) > $(DOCKER_UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user enable $(DOCKER_UNIT_NAME)
	@echo "Boot autostart enabled: $(DOCKER_UNIT_DST) (requires linger; see README)"

# Internal: disable + remove the compose boot-autostart unit. Idempotent.
remove-docker-unit:
	@systemctl --user disable --now $(DOCKER_UNIT_NAME) 2>/dev/null || true
	@rm -f $(DOCKER_UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(DOCKER_UNIT_NAME) 2>/dev/null || true

# Internal: install the host-run units (paths substituted from the templates).
install-host-units:
	@mkdir -p $(HOST_UNIT_DIR)
	@sed -e 's|@REPO_DIR@|$(CURDIR)|g' $(HOST_API_SRC) > $(HOST_API_DST)
	@sed -e 's|@REPO_DIR@|$(CURDIR)|g' $(HOST_WEB_SRC) > $(HOST_WEB_DST)
	@systemctl --user daemon-reload
	@systemctl --user enable $(HOST_API_NAME) $(HOST_WEB_NAME)
	@echo "Boot autostart enabled: $(HOST_API_DST) + $(HOST_WEB_DST) (requires linger; see README)"

# Internal: disable + remove the host-run units. Idempotent.
remove-host-units:
	@systemctl --user disable --now $(HOST_API_NAME) $(HOST_WEB_NAME) 2>/dev/null || true
	@rm -f $(HOST_API_DST) $(HOST_WEB_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(HOST_API_NAME) $(HOST_WEB_NAME) 2>/dev/null || true
