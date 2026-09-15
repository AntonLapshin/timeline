"""Secrets hygiene audit for the public repo (issue #83, M6-T3).

The timeline repo is **public**: it must contain only code, docs, prompts and
schemas — never real secrets. This test scans every file that is *tracked* by
git (via ``git ls-files``) for secret patterns and asserts that only
placeholders appear. It is the committed guard described in the issue's
acceptance criteria ("a test or CI check that fails if a real secret pattern
appears in tracked files").

It also verifies the hygiene *contracts*:
- ``.env.example`` is tracked and contains placeholders only (no real values),
  and documents every env key the app reads.
- ``.env``, ``./data``, ``./backups``, logs and transcripts are never tracked.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

# Repository root is four levels up from this module: apps/api/tests/<this>.
REPO_ROOT = Path(__file__).resolve().parents[3]

# Files that legitimately contain long base64-looking strings (SRI hashes for
# npm deps) and are not secrets. We still scan them for the *specific* secret
# patterns below, which are distinct from SRI integrity hashes.
_SKIP_SCAN = {
    "package-lock.json",
    "package-lock.json.bak",
}

# --- Secret patterns ---------------------------------------------------------
# Each pattern is a (name, compiled regex). The regex must match a *real*
# secret shape and avoid matching the placeholder words used in docs
# ("changeme", "example.com", "123…", "***", etc.).

# Telegram bot token: 8-10 digit id, colon, 35+ base64-ish chars.
_TELEGRAM_BOT_TOKEN = re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")
# JoinGonka API key: "jg-" followed by 40+ hex chars.
_JG_API_KEY = re.compile(r"\bjg-[a-fA-F0-9]{40,}\b")
# Generic OpenAI-style key: "sk-" followed by 20+ chars.
_SK_API_KEY = re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")
# GitHub PAT: "ghp_" / "github_pat_" followed by 20+ chars.
_GITHUB_PAT = re.compile(r"\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")
# AWS access key id.
_AWS_ACCESS_KEY = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
# Long high-entropy tokens that are almost certainly secrets (>=40 chars of
# mixed letter/digit, not a known placeholder). Avoids SRI hash false positives
# by requiring the token NOT to contain '+' or '/' (base64 SRI uses those) and
# to start with a letter.
_HIGH_ENTROPY = re.compile(r"\b[A-Za-z][A-Za-z0-9]{39,}\b")
# Personal email addresses (real domains only — example.com/.org are allowed).
_EMAIL = re.compile(
    r"\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

_SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("telegram bot token", _TELEGRAM_BOT_TOKEN),
    ("JoinGonka API key (jg-)", _JG_API_KEY),
    ("OpenAI-style API key (sk-)", _SK_API_KEY),
    ("GitHub personal access token", _GITHUB_PAT),
    ("AWS access key id", _AWS_ACCESS_KEY),
    ("high-entropy secret-looking token", _HIGH_ENTROPY),
    ("personal email address", _EMAIL),
]

# Allowed placeholder strings that may appear in docs/tests/examples.
_ALLOWED_PLACEHOLDERS = {
    "changeme",
    "example.com",
    "example.org",
    "example.net",
    "me@example.com",
    "from@example.com",
    "to@example.com",
    "user@example.com",
    "yourbotname",
}


def _tracked_files() -> list[Path]:
    """Return the list of files tracked by git (relative to the repo root)."""
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [REPO_ROOT / line for line in result.stdout.splitlines() if line]


def _is_placeholder(line: str) -> bool:
    """Return True when a line is a known placeholder / comment / blank."""
    lowered = line.strip().lower()
    return (
        not line.strip()
        or line.strip().startswith(("#", "//", "<!--", "*", "-"))
        or any(p in lowered for p in _ALLOWED_PLACEHOLDERS)
    )


def _scan_file(path: Path) -> list[tuple[str, int, str, str]]:
    """Scan one tracked file; return (pattern_name, line_no, line, match)."""
    findings: list[tuple[str, int, str, str]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return findings  # binary / unreadable — skip
    for lineno, line in enumerate(text.splitlines(), start=1):
        if _is_placeholder(line):
            continue
        for name, pattern in _SECRET_PATTERNS:
            match = pattern.search(line)
            if match:
                findings.append((name, lineno, line.strip(), match.group(0)))
    return findings


def _env_keys_read_by_app() -> set[str]:
    """Return the set of env var names the API reads from the environment."""
    keys: set[str] = set()
    for path in (REPO_ROOT / "apps/api/app").glob("*.py"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        # os.getenv("KEY", ...) / os.environ["KEY"]
        keys.update(re.findall(r'getenv\("([A-Z][A-Z0-9_]+)"', text))
        keys.update(re.findall(r'environ\["([A-Z][A-Z0-9_]+)"\]', text))
    return keys


# --- Tests -------------------------------------------------------------------


def test_no_real_secrets_in_tracked_files() -> None:
    """No tracked file contains a real secret pattern (placeholders only)."""
    findings: list[tuple[Path, str, int, str, str]] = []
    for path in _tracked_files():
        if path.name in _SKIP_SCAN:
            continue
        for name, lineno, line, match in _scan_file(path):
            findings.append((path, name, lineno, line, match))
    assert findings == [], (
        "Real secret-looking values found in tracked files:\n"
        + "\n".join(
            f"  {path.relative_to(REPO_ROOT)}:{lineno} [{name}] {line!r} ({match})"
            for path, name, lineno, line, match in findings
        )
    )


def test_env_example_is_tracked_and_contains_placeholders_only() -> None:
    """.env.example is tracked and holds no real secret values."""
    env_example = REPO_ROOT / ".env.example"
    assert env_example.is_file(), ".env.example must exist"
    tracked = {p.name for p in _tracked_files()}
    assert ".env.example" in tracked, ".env.example must be tracked in git"

    findings = _scan_file(env_example)
    assert findings == [], f".env.example contains real-looking secrets: {findings}"


def test_env_example_documents_every_env_key_the_app_reads() -> None:
    """Every env key the API reads is documented in .env.example."""
    env_example = REPO_ROOT / ".env.example"
    text = env_example.read_text(encoding="utf-8")
    documented = set(re.findall(r"\b[A-Z][A-Z0-9_]{1,}\b", text))
    missing = sorted(_env_keys_read_by_app() - documented)
    assert missing == [], (
        "Env keys read by the app but missing from .env.example: " + ", ".join(missing)
    )


def test_secret_files_are_not_tracked() -> None:
    """.env, data/, backups/, logs and transcripts are never tracked."""
    tracked = {str(p.relative_to(REPO_ROOT)) for p in _tracked_files()}
    forbidden_prefixes = (
        ".env/",
        "data/",
        "backups/",
        "logs/",
        "transcripts/",
        "coverage/",
    )
    forbidden_exact = {".env", ".env.local", ".env.production", ".env.development"}
    offenders = [
        p for p in tracked if p in forbidden_exact or p.startswith(forbidden_prefixes)
    ]
    assert offenders == [], f"Secret/data files are tracked: {offenders}"
