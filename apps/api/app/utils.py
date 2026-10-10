"""Shared pure helpers for the timeline API.

Small, dependency-free functions used across modules (env parsing, wall-clock
parsing) so the logic lives in one place and is unit-tested once. No imports
from other ``app`` modules — everything here is pure.
"""

from __future__ import annotations

import os


def bool_env(name: str, default: bool) -> bool:
    """Return the boolean value of env var ``name`` (``1``/``true``/``yes``/``on``).

    Falls back to ``default`` when the variable is unset. Whitespace and case
    are ignored.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def optional_env(name: str) -> str | None:
    """Return the env value, or ``None`` when unset/blank."""
    raw = os.getenv(name)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


def parse_hhmm(value: str) -> tuple[int, int]:
    """Parse a ``"HH:MM"`` wall-clock string into ``(hour, minute)``.

    A missing minute (``"9"``) yields ``(9, 0)``. Raises ``ValueError`` for
    non-numeric parts so misconfigured quiet-hours / remind-times fail loudly
    instead of silently scheduling at midnight.
    """
    hour_s, _, minute_s = value.partition(":")
    return int(hour_s), int(minute_s or "0")
