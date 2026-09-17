"""Pure Telegram user-allowlist parsing and membership checks (issue #112).

The allowlist gates both directions of the Telegram bot:

- **Inbound**: DMs and button callbacks from non-allowlisted users are ignored
  (no processing, no reply, no data leakage) with one warning log line per
  occurrence.
- **Outbound**: reminder cards go only to the allowlisted user ids.

Sources (combined, deduplicated, order preserved):

- ``TELEGRAM_USER_IDS`` — comma-separated numeric ids, whitespace tolerated;
- ``TELEGRAM_USER_ID`` — the legacy single-user variable (backward compatible).

Fail-closed semantics: an empty or fully-invalid allowlist allows nobody.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TelegramAllowlist:
    """A parsed allowlist: valid numeric ids plus the entries dropped.

    ``ids`` holds deduplicated numeric ids (as ``int``) in first-seen order.
    ``invalid`` holds the non-numeric entries that were dropped so the caller
    can warn about them at startup. An empty allowlist (``not allowlist``)
    allows nobody — fail closed.
    """

    ids: tuple[int, ...] = ()
    invalid: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        """True when at least one user id is allowlisted."""
        return bool(self.ids)

    def allows(self, user_id: str | int | None) -> bool:
        """True only when ``user_id`` is allowlisted (``None`` never is).

        Comparison is numeric, so the str/int forms of the same id are
        equivalent (``allows("42")`` and ``allows(42)`` agree).
        """
        if user_id is None:
            return False
        try:
            return int(user_id) in self.ids
        except (TypeError, ValueError):
            return False


def parse_allowlist(*raws: str | None) -> TelegramAllowlist:
    """Parse comma-separated numeric user ids from one or more raw values.

    Each raw value is split on commas; entries are stripped of surrounding
    whitespace; empty entries are dropped; duplicates are removed (first
    occurrence wins, order preserved). Entries that are not purely numeric are
    dropped and reported in ``invalid`` so the caller can warn at startup. An
    empty result means "allow nobody" (fail closed).
    """
    ids: list[int] = []
    invalid: list[str] = []
    for raw in raws:
        if raw is None:
            continue
        for entry in raw.split(","):
            value = entry.strip()
            if not value:
                continue
            if value.isascii() and value.isdigit():
                user_id = int(value)
                if user_id not in ids:
                    ids.append(user_id)
            elif value not in invalid:
                invalid.append(value)
    return TelegramAllowlist(ids=tuple(ids), invalid=tuple(invalid))


def startup_warning(allowlist: TelegramAllowlist) -> str | None:
    """Human-readable startup warning for a fail-closed/partial allowlist.

    Returns ``None`` when the allowlist needs no warning (at least one valid
    id and no dropped entries). An empty allowlist means the bot would ignore
    every message (fail closed); invalid entries were dropped — both deserve a
    startup warning so a misconfiguration is never silent.
    """
    parts: list[str] = []
    if not allowlist.ids:
        parts.append(
            "no valid Telegram user id is configured — the bot will start but "
            "ignore every message (fail closed)"
        )
    if allowlist.invalid:
        parts.append(f"ignoring invalid entries: {', '.join(allowlist.invalid)}")
    if not parts:
        return None
    return (
        "Telegram allowlist problem (TELEGRAM_USER_IDS / TELEGRAM_USER_ID): "
        + "; ".join(parts)
        + "."
    )
