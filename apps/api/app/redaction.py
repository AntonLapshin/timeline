"""Log redaction helpers (issue #76, M5-T4B).

Sensitive content — user message text, parsed event content, LLM prompt
bodies, and audio/voice file paths — must never be written to logs. These
pure helpers produce safe, content-free references (a length + short hash, or
a file basename) so operators can correlate log lines without leaking private
data. No secret or raw text is ever recoverable from the output.
"""

from __future__ import annotations

import hashlib
from pathlib import PurePosixPath


def redact_text(text: str) -> str:
    """Return a content-free reference for a chunk of user/parsed text.

    Only the byte length and a short SHA-256 prefix are included; the original
    text is never written and cannot be recovered from the reference.
    """
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    return f"<text len={len(text)} sha={digest}>"


def redact_path(path: str) -> str:
    """Return a safe reference for a file path (e.g. an audio/voice file).

    Only the basename is kept; directory components (which may contain
    usernames, temp dirs, or machine paths) are dropped so the path never
    leaks into logs.
    """
    name = PurePosixPath(path.replace("\\", "/")).name
    return f"<file {name}>"


def redact_prompt(system: str, user: str) -> str:
    """Return a content-free reference for an LLM prompt body.

    Prompt bodies embed the user's raw text; never log them. This returns a
    single placeholder describing the prompt without any content.
    """
    return f"<prompt system={len(system)} user={len(user)}>"
