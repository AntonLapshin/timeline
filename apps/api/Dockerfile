# Timeline API — FastAPI + SQLAlchemy + Alembic image.
#
# Runs the backend with a SQLite (WAL) database under /data (mounted as a
# compose volume). Inside the container the server must bind 0.0.0.0 — Docker
# port publishing forwards to the container's eth0, so a loopback bind would
# make the published port unreachable. Host-side exposure is 0.0.0.0:8124 by
# design (trusted LAN only — the API has no auth; see docker-compose.yml and
# README "Host-system / LAN access").

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install Python dependencies first (better layer caching).
COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the API application and Alembic wiring.
COPY apps/api/app ./app
COPY apps/api/alembic ./alembic
COPY apps/api/alembic.ini ./alembic.ini

# Data directory for the SQLite database (persisted via a compose volume).
RUN mkdir -p /data

# Bind all interfaces inside the container (required for Docker port
# publishing); the bind guard needs an explicit opt-in for the non-loopback
# host. Host-side exposure is 0.0.0.0:8124 by design (trusted LAN only).
ENV TIMELINE_HOST=0.0.0.0 \
    TIMELINE_PORT=8124 \
    TIMELINE_DATA_DIR=/data \
    TIMELINE_ALLOW_NON_LOOPBACK=1

EXPOSE 8124

# On first start, apply any pending Alembic migrations, then serve.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host \"${TIMELINE_HOST:-0.0.0.0}\" --port \"${TIMELINE_PORT:-8124}\""]
