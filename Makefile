# Timeline — one-command lifecycle for the docker-compose stack (web + api).
#
#   make dev     dev stack: build + up, wait for API health, print URLs
#   make start   prod stack: build + up, install + enable boot autostart
#   make stop    stop the stack and remove boot autostart
#   make status  compose ps + API healthz
#   make logs    follow compose logs
#   make help    this list (default target)
#
# Secrets come from the local, gitignored `.env` (copied from `.env.example`
# on first run, never overwritten). No secrets live in this file or in the
# systemd unit. Docker access is required (user in the `docker` group, or run
# the targets via sudo).

COMPOSE ?= docker compose
DOCKER_BIN ?= $(shell command -v docker 2>/dev/null || echo /usr/bin/docker)

WEB_URL ?= http://127.0.0.1:8123/timeline/
HEALTHZ_URL ?= http://127.0.0.1:8124/healthz
HEALTH_WAIT_SECONDS ?= 90

UNIT_NAME ?= timeline-compose.service
UNIT_SRC ?= systemd/timeline-compose.service.in
UNIT_DIR ?= $(HOME)/.config/systemd/user
UNIT_DST ?= $(UNIT_DIR)/$(UNIT_NAME)

.DEFAULT_GOAL := help
.PHONY: help dev start stop status logs env wait-health print-urls install-unit remove-unit

help:
	@echo "Timeline — docker-compose stack control"
	@echo
	@echo "  make dev     Start the dev stack (build + up -d), wait for API health, print URLs"
	@echo "  make start   Prod: stack up (built images, migrations via API CMD) + boot autostart"
	@echo "  make stop    Stop the stack (compose down) and remove boot autostart"
	@echo "  make status  Show compose ps + API health"
	@echo "  make logs    Follow compose logs (web + api)"
	@echo "  make help    This list (default target)"
	@echo
	@echo 'LAN exposure is by design and unauthenticated — trusted LAN only.'
	@echo 'Firewall whitelist: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Dev: .env bootstrap (never overwrites) + build + up + health wait + URLs.
dev: env
	$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls
	@echo 'Reminder: LAN access is unauthenticated (trusted LAN only); firewall: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Prod: stack up + install/enable the boot-autostart systemd --user unit.
start: env
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory install-unit
	@$(MAKE) --no-print-directory wait-health
	@$(MAKE) --no-print-directory print-urls
	@echo 'Boot autostart: $(UNIT_DST) enabled (runs "$(COMPOSE) up -d" in $(CURDIR) at boot/login).'
	@echo 'Reminder: LAN access is unauthenticated (trusted LAN only); firewall: sudo ufw allow 8123/tcp && sudo ufw allow 8124/tcp'

# Stop: compose down + disable/remove the boot-autostart unit. Idempotent.
stop:
	$(COMPOSE) down
	@systemctl --user disable --now $(UNIT_NAME) 2>/dev/null || true
	@rm -f $(UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(UNIT_NAME) 2>/dev/null || true
	@echo "Stack stopped; boot autostart removed (idempotent)."

# Status: compose ps + API healthz.
status:
	$(COMPOSE) ps
	@curl -fsS --max-time 3 $(HEALTHZ_URL) && echo || echo "API unhealthy at $(HEALTHZ_URL)"

# Logs: follow compose logs.
logs:
	$(COMPOSE) logs -f --tail=100

# --- internal targets -------------------------------------------------------

# Internal: copy .env.example -> .env only if .env is missing; never overwrite.
env:
	@if [ -f .env ]; then \
		echo ".env exists — leaving it untouched (secrets stay local)"; \
	else \
		cp .env.example .env && echo "Created .env from .env.example — fill in local values (gitignored)"; \
	fi

# Internal: poll GET $(HEALTHZ_URL) until ok or timeout (migrations run first in the API container).
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

# Internal: install + enable the boot-autostart unit (paths substituted from the template).
install-unit:
	@mkdir -p $(UNIT_DIR)
	@sed -e 's|@REPO_DIR@|$(CURDIR)|g' -e 's|@DOCKER@|$(DOCKER_BIN)|g' $(UNIT_SRC) > $(UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user enable $(UNIT_NAME)
	@echo "Boot autostart enabled: $(UNIT_DST) (requires linger; see README)"

# Internal: disable + remove the boot-autostart unit. Idempotent.
remove-unit:
	@systemctl --user disable --now $(UNIT_NAME) 2>/dev/null || true
	@rm -f $(UNIT_DST)
	@systemctl --user daemon-reload
	@systemctl --user reset-failed $(UNIT_NAME) 2>/dev/null || true
