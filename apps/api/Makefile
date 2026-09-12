# Timeline API — local development commands.
#
# Requires a Python 3.11+ environment with dependencies installed:
#   python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt

.PHONY: install dev lint typecheck test coverage migrate upgrade

install:
	pip install -r requirements.txt

dev:
	uvicorn app.main:app --reload --host 127.0.0.1 --port 8123

lint:
	ruff check app tests

format:
	ruff format app tests

typecheck:
	mypy --config-file pyproject.toml app

test:
	pytest

coverage:
	pytest --cov=app --cov-report=term-missing

migrate:
	alembic upgrade head

upgrade:
	alembic upgrade head
