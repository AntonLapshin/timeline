# Timeline API — FastAPI + SQLAlchemy + Alembic image.
#
# Runs the backend bound to loopback only (127.0.0.1) with a SQLite (WAL)
# database under /data (mounted as a volume). No auth — the API must never be
# exposed to the LAN or internet (never set host to 0.0.0.0).

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

# Loopback bind only — no auth. Never change to 0.0.0.0.
ENV TIMELINE_HOST=127.0.0.1 \
    TIMELINE_PORT=8124 \
    TIMELINE_DATA_DIR=/data

EXPOSE 8124

# On first start, apply any pending Alembic migrations, then serve.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 127.0.0.1 --port 8124"]
