"""Local speech-to-text for Telegram voice messages (issue #71, M5-T2).

Converts a Telegram ``voice.ogg`` to a 16 kHz mono WAV via ffmpeg, then
transcribes it with whisper.cpp by reusing the local voxtype install/model
(e.g. ``voxtype transcribe``, which loads the installed whisper model under the
hood). Everything runs on this machine — no audio bytes are ever sent to an
external service; only the resulting text leaves this module for parsing.

Design follows the ``llm_parse.py`` pattern: the pure orchestration and guard
logic lives here and is unit-tested with injected dependencies (a ``run_cmd``
callable and ``file_exists``/``voxtype_available`` checks), so no real
subprocess or network happens in tests.

Safety properties (all enforced structurally + tested):

- **2-minute cap**: voice messages over ``MAX_DURATION_SECONDS`` are rejected
  before any conversion/transcription attempt.
- **Local-only**: the only subprocesses we ever launch are ``ffmpeg`` (local
  convert) and ``voxtype transcribe`` (local whisper model). No URL/network
  commands are constructed.
- **Graceful degradation**: when voxtype/whisper is unavailable the orchestrator
  returns ``unavailable`` instead of crashing.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from .config import Settings

logger = logging.getLogger(__name__)

#: The 2-minute cap on Telegram voice messages (seconds).
MAX_DURATION_SECONDS = 120

#: ffmpeg output sample rate / channel count for whisper.cpp (16 kHz mono).
_SAMPLE_RATE = 16000
_CHANNELS = 1

#: The final voxtype line carrying the transcript, e.g.
#: ``INFO Transcription completed in 8.51s: "hello there"``.
_TRANSCRIPT_RE = re.compile(
    r"Transcription completed in [\d.]+s:\s*\"(.*)\"", re.DOTALL
)

#: A command that would send data off-box or otherwise violate the local-only
#: guarantee (defensive: we never build these, and a test asserts it).
_NETWORK_MARKERS = ("http://", "https://", "curl", "wget")


class CommandRunner(Protocol):
    """The subset of a subprocess runner ``transcribe_voice`` needs."""

    def __call__(self, cmd: list[str]) -> tuple[int, str, str]:
        """Run ``cmd`` and return ``(returncode, stdout, stderr)``."""
        ...


# ---------------------------------------------------------------------------
# Pure guards / builders
# ---------------------------------------------------------------------------


def duration_error(duration_seconds: float | None) -> str | None:
    """Return an error message when the voice message exceeds the cap.

    ``None`` means the message is within the 2-minute limit (or the duration is
    unknown, which is allowed through — we cannot reject what we cannot measure).
    """
    if duration_seconds is None:
        return None
    if duration_seconds > MAX_DURATION_SECONDS:
        return (
            f"Voice message is {duration_seconds:.0f}s, over the "
            f"{MAX_DURATION_SECONDS}s (2 min) limit. Please send a shorter one."
        )
    return None


#: ffmpeg flags converting any input audio to 16 kHz mono signed-16 WAV.
_FFMPEG_FLAGS = [
    "-y",
    "-ar",
    str(_SAMPLE_RATE),
    "-ac",
    str(_CHANNELS),
    "-acodec",
    "pcm_s16le",
]


def build_ffmpeg_command(input_path: str, output_path: str) -> list[str]:
    """Build the local ffmpeg command converting input audio to a 16k WAV.

    Pure: returns the command list; the caller runs it via the injected runner.
    Only local file paths are involved — no network destination.
    """
    return ["ffmpeg", "-i", input_path, *_FFMPEG_FLAGS, output_path]


def build_transcribe_command(voxtype_path: str, wav_path: str) -> list[str]:
    """Build the local whisper transcription command via the voxtype CLI.

    ``voxtype transcribe <wav>`` loads the installed whisper model locally
    (e.g. ``ggml-base.en.bin``) and prints the transcript to stderr. Pure: only
    local file paths, never a URL.
    """
    return [voxtype_path, "transcribe", wav_path]


def parse_transcription_output(stdout: str, stderr: str) -> str | None:
    """Extract the transcript text from voxtype's stderr/stdout output.

    Returns ``None`` when no transcript line is present (unparseable output).
    """
    combined = f"{stdout}\n{stderr}"
    match = _TRANSCRIPT_RE.search(combined)
    if match is None:
        return None
    text = match.group(1).strip()
    return text or None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SttResult:
    """The result of a local transcription attempt."""

    ok: bool
    text: str | None = None
    error: str | None = None
    unavailable: bool = False


def transcribe_voice(
    ogg_path: str,
    duration_seconds: float | None,
    settings: Settings,
    run_cmd: CommandRunner,
    *,
    file_exists: Callable[[str], bool] = lambda _p: True,
    voxtype_available: Callable[[], bool] | None = None,
) -> SttResult:
    """Transcribe a Telegram voice file entirely on this machine.

    Orchestrates: 2-min cap guard → check voxtype availability → convert to
    16k mono wav with ffmpeg → transcribe locally with whisper.cpp → extract
    the text. All subprocess I/O goes through the injected ``run_cmd`` (a fake
    in tests), so no real ffmpeg/whisper/network happens here.

    ``file_exists`` and ``voxtype_available`` are injected so tests can simulate
    a missing input file or an absent voxtype/whisper install without touching
    the filesystem. When ``voxtype_available`` is omitted it falls back to the
    real ``voxtype_is_available`` check against ``settings``.
    """
    err = duration_error(duration_seconds)
    if err is not None:
        return SttResult(ok=False, error=err)

    if voxtype_available is None:

        def _real_availability() -> bool:
            return voxtype_is_available(settings)

        voxtype_available = _real_availability
    if not voxtype_available():
        return SttResult(
            ok=False,
            unavailable=True,
            error="Local speech-to-text (voxtype/whisper.cpp) is not available.",
        )

    if not file_exists(ogg_path):
        return SttResult(ok=False, error=f"Voice file not found: {ogg_path}")

    wav_path = _wav_path_for(ogg_path)
    ffmpeg_cmd = build_ffmpeg_command(ogg_path, wav_path)
    code, _out, err_text = run_cmd(ffmpeg_cmd)
    if code != 0:
        return SttResult(
            ok=False, error=f"Audio conversion failed: {err_text.strip() or code}"
        )

    transcribe_cmd = build_transcribe_command(settings.stt_voxtype_path, wav_path)
    code, out, err_text = run_cmd(transcribe_cmd)
    if code != 0:
        return SttResult(
            ok=False, error=f"Transcription failed: {err_text.strip() or code}"
        )

    text = parse_transcription_output(out, err_text)
    if text is None:
        return SttResult(ok=False, error="Transcription produced no text.")
    return SttResult(ok=True, text=text)


def _wav_path_for(ogg_path: str) -> str:
    """Derive the temporary WAV path from the input OGG path (pure)."""
    return ogg_path.rsplit(".", 1)[0] + ".wav" if "." in ogg_path else ogg_path + ".wav"


# ---------------------------------------------------------------------------
# Thin impure adapter (process runner)
# ---------------------------------------------------------------------------


def run_command(cmd: list[str], *, timeout: float = 300.0) -> tuple[int, str, str]:
    """Run a local command via subprocess and return (code, stdout, stderr).

    Thin impure adapter wrapping ``subprocess.run``. Only ever called with the
    local ffmpeg/voxtype commands built above — never with a network command.
    """
    import subprocess

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


def voxtype_is_available(settings: Settings) -> bool:
    """True when the local voxtype binary (and configured model) exist.

    Thin impure check against the filesystem/PATH. When ``stt_model_path`` is
    configured, the model file must exist too; otherwise voxtype is assumed to
    use its installed default model.
    """
    from pathlib import Path

    binary_ok = Path(settings.stt_voxtype_path).expanduser().is_file() or _on_path(
        settings.stt_voxtype_path
    )
    if not binary_ok:
        return False
    if settings.stt_model_path:
        return Path(settings.stt_model_path).expanduser().is_file()
    return True


def _on_path(name: str) -> bool:
    """True when ``name`` resolves on PATH (thin impure check)."""
    import shutil

    return shutil.which(name) is not None


#: A convenience runner bound to the local subprocess adapter (used by callers
#: that don't need to inject a fake; tests inject their own).
default_runner: CommandRunner = run_command
