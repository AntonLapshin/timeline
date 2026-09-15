"""Tests for the local STT module (issue #71, M5-T2).

Covers the acceptance criteria:

- **2-minute cap**: voice messages over 120s are rejected with a clear message
  and no conversion/transcription is attempted; at/under the cap is allowed.
- **ffmpeg command construction**: converts to 16 kHz mono signed-16 WAV.
- **whisper command construction**: uses the local voxtype CLI (never a URL).
- **unavailable handling**: missing voxtype/whisper returns ``unavailable``
  gracefully (no crash).
- **no audio leaves the machine**: the orchestrator only ever runs the local
  ffmpeg + voxtype commands; no network command is ever constructed.
"""

from __future__ import annotations

from app.config import Settings
from app.stt import (
    MAX_DURATION_SECONDS,
    build_ffmpeg_command,
    build_transcribe_command,
    duration_error,
    parse_transcription_output,
    transcribe_voice,
)


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"stt_voxtype_path": "/usr/bin/voxtype"}
    values.update(overrides)
    return Settings(**values)


class _FakeRunner:
    """A fake command runner recording every command it is given."""

    def __init__(self, *, code: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.code = code
        self.stdout = stdout
        self.stderr = stderr
        self.commands: list[list[str]] = []

    def __call__(self, cmd: list[str]) -> tuple[int, str, str]:
        self.commands.append(cmd)
        return self.code, self.stdout, self.stderr


# --- 2-minute cap ------------------------------------------------------------


def test_max_duration_constant() -> None:
    """The cap is 120 seconds (2 minutes)."""
    assert MAX_DURATION_SECONDS == 120


def test_duration_error_over_cap() -> None:
    """A voice message over the cap is rejected with a clear message."""
    err = duration_error(121)
    assert err is not None
    assert "2 min" in err
    assert "121" in err


def test_duration_error_at_cap_allowed() -> None:
    """A message exactly at the cap is allowed."""
    assert duration_error(120) is None


def test_duration_error_under_cap_allowed() -> None:
    """A message under the cap is allowed."""
    assert duration_error(30) is None


def test_duration_error_unknown_allowed() -> None:
    """An unknown duration is allowed through (cannot reject what we can't measure)."""
    assert duration_error(None) is None


def test_transcribe_rejects_over_cap_before_any_command() -> None:
    """An over-cap voice message is rejected with no conversion attempted."""
    runner = _FakeRunner()
    result = transcribe_voice(
        "/tmp/voice.ogg", 200, _settings(), runner, voxtype_available=lambda: True
    )
    assert result.ok is False
    assert "2 min" in (result.error or "")
    assert runner.commands == []  # no ffmpeg/whisper ran


# --- ffmpeg command construction ---------------------------------------------


def test_build_ffmpeg_command_16k_mono_wav() -> None:
    """The ffmpeg command converts to 16 kHz mono signed-16 WAV."""
    cmd = build_ffmpeg_command("/tmp/voice.ogg", "/tmp/voice.wav")
    assert cmd[0] == "ffmpeg"
    assert cmd[1] == "-i"
    assert "/tmp/voice.ogg" in cmd
    assert "-ar" in cmd and "16000" in cmd
    assert "-ac" in cmd and "1" in cmd
    assert "pcm_s16le" in cmd
    assert cmd[-1] == "/tmp/voice.wav"


# --- whisper command construction --------------------------------------------


def test_build_transcribe_command_uses_local_voxtype() -> None:
    """The whisper command uses the local voxtype CLI on the local wav path."""
    cmd = build_transcribe_command("/usr/bin/voxtype", "/tmp/voice.wav")
    assert cmd == ["/usr/bin/voxtype", "transcribe", "/tmp/voice.wav"]


def test_build_transcribe_command_uses_configured_voxtype() -> None:
    """The configured voxtype path is honored."""
    cmd = build_transcribe_command(
        "/home/monarch/ws/natalies-corner/voxtype", "/tmp/voice.wav"
    )
    assert cmd[0] == "/home/monarch/ws/natalies-corner/voxtype"


def test_no_network_command_is_ever_built() -> None:
    """Neither command builder produces a URL/network command (local-only)."""
    for cmd in (
        build_ffmpeg_command("/tmp/a.ogg", "/tmp/a.wav"),
        build_transcribe_command("/usr/bin/voxtype", "/tmp/a.wav"),
    ):
        for token in cmd:
            assert not any(m in token for m in ("http://", "https://", "curl", "wget"))


# --- transcript parsing -------------------------------------------------------


def test_parse_transcription_output_extracts_text() -> None:
    """The transcript is extracted from voxtype's completion line."""
    stderr = (
        "INFO Using local whisper transcription mode\n"
        'INFO Transcription completed in 8.51s: "dentist tomorrow at 9am"\n'
    )
    assert parse_transcription_output("", stderr) == "dentist tomorrow at 9am"


def test_parse_transcription_output_empty_text() -> None:
    """An empty transcript is treated as no text."""
    stderr = 'INFO Transcription completed in 8.51s: ""\n'
    assert parse_transcription_output("", stderr) is None


def test_parse_transcription_output_missing_line() -> None:
    """Output without a completion line yields no text."""
    assert parse_transcription_output("nothing here", "") is None


def test_parse_transcription_output_stdout_line() -> None:
    """The completion line may appear on stdout too."""
    stdout = 'Transcription completed in 1.00s: "hello"\n'
    assert parse_transcription_output(stdout, "") == "hello"


# --- orchestrator -------------------------------------------------------------


def test_transcribe_success() -> None:
    """A successful local transcription returns the extracted text."""
    runner = _FakeRunner(
        stderr='INFO Transcription completed in 5.00s: "team standup at noon"\n'
    )
    result = transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), runner, voxtype_available=lambda: True
    )
    assert result.ok is True
    assert result.text == "team standup at noon"
    # Two local commands ran: ffmpeg convert, then voxtype transcribe.
    assert len(runner.commands) == 2
    assert runner.commands[0][0] == "ffmpeg"
    assert runner.commands[1][0] == "/usr/bin/voxtype"
    # The wav path derived from the ogg path is what voxtype transcribes.
    assert runner.commands[1][-1] == "/tmp/voice.wav"


def test_transcribe_ffmpeg_failure() -> None:
    """A non-zero ffmpeg exit surfaces as an error with no transcription."""
    runner = _FakeRunner(code=1, stderr="ffmpeg: invalid file")
    result = transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), runner, voxtype_available=lambda: True
    )
    assert result.ok is False
    assert "conversion failed" in (result.error or "")
    assert len(runner.commands) == 1  # stopped after ffmpeg


def test_transcribe_whisper_failure() -> None:
    """A non-zero voxtype exit surfaces as an error."""

    def _flaky(cmd: list[str]) -> tuple[int, str, str]:
        # ffmpeg succeeds; the voxtype transcription fails.
        if cmd[0] == "ffmpeg":
            return 0, "", ""
        return 1, "", "voxtype: model missing"

    result = transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), _flaky, voxtype_available=lambda: True
    )
    assert result.ok is False
    assert "Transcription failed" in (result.error or "")


def test_transcribe_no_text_output() -> None:
    """A successful run with no transcript text is an error."""
    runner = _FakeRunner(stderr='INFO Transcription completed in 1s: ""\n')
    result = transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), runner, voxtype_available=lambda: True
    )
    assert result.ok is False
    assert "no text" in (result.error or "")


def test_transcribe_unavailable_no_voxtype() -> None:
    """No voxtype/whisper ⇒ graceful unavailable (no crash, no commands)."""
    runner = _FakeRunner()
    result = transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), runner, voxtype_available=lambda: False
    )
    assert result.ok is False
    assert result.unavailable is True
    assert "not available" in (result.error or "")
    assert runner.commands == []


def test_transcribe_missing_input_file() -> None:
    """A missing input file is an error, surfaced before conversion."""
    runner = _FakeRunner()
    result = transcribe_voice(
        "/tmp/voice.ogg",
        30,
        _settings(),
        runner,
        file_exists=lambda _p: False,
        voxtype_available=lambda: True,
    )
    assert result.ok is False
    assert "not found" in (result.error or "")
    assert runner.commands == []


def test_transcribe_uses_configured_voxtype_path() -> None:
    """The configured voxtype path is passed to the transcribe command."""
    runner = _FakeRunner(stderr='INFO Transcription completed in 5.00s: "hello"\n')
    result = transcribe_voice(
        "/tmp/voice.ogg",
        30,
        _settings(stt_voxtype_path="/opt/voxtype/bin/voxtype"),
        runner,
        voxtype_available=lambda: True,
    )
    assert result.ok is True
    assert runner.commands[1][0] == "/opt/voxtype/bin/voxtype"


def test_transcribe_only_runs_local_commands() -> None:
    """The orchestrator never issues a network command (no audio leaves box)."""
    runner = _FakeRunner(stderr='INFO Transcription completed in 5.00s: "hello"\n')
    transcribe_voice(
        "/tmp/voice.ogg", 30, _settings(), runner, voxtype_available=lambda: True
    )
    for cmd in runner.commands:
        for token in cmd:
            assert not any(m in token for m in ("http://", "https://", "curl", "wget"))
    # Exactly the two local commands, in order.
    assert [c[0] for c in runner.commands] == ["ffmpeg", "/usr/bin/voxtype"]


# --- thin impure adapters ----------------------------------------------------


def test_run_command_success() -> None:
    """run_command runs a local command and returns its stdout."""
    from app.stt import run_command

    code, out, err = run_command(["echo", "hello"])
    assert code == 0
    assert "hello" in out
    assert err == ""


def test_run_command_failure() -> None:
    """run_command surfaces a non-zero exit code."""
    from app.stt import run_command

    code, _out, _err = run_command(["false"])
    assert code == 1


def test_run_command_timeout() -> None:
    """run_command propagates a timeout as an error."""
    import subprocess

    from app.stt import run_command

    try:
        run_command(["sleep", "5"], timeout=0.1)
    except subprocess.TimeoutExpired:
        pass
    else:  # pragma: no cover - only reached if the timeout did not fire
        raise AssertionError("expected TimeoutExpired")


def test_voxtype_is_available_existing_path() -> None:
    """A real voxtype binary on disk is reported available."""
    import sys

    from app.stt import voxtype_is_available

    assert voxtype_is_available(_settings(stt_voxtype_path=sys.executable)) is True


def test_voxtype_is_available_missing_path() -> None:
    """A nonexistent binary path (not on PATH) is unavailable."""
    from app.stt import voxtype_is_available

    assert (
        voxtype_is_available(
            _settings(stt_voxtype_path="/definitely/not/a/real/binary")
        )
        is False
    )


def test_voxtype_is_available_via_path() -> None:
    """A bare voxtype name on PATH is reported available."""
    from app.stt import voxtype_is_available

    assert voxtype_is_available(_settings(stt_voxtype_path="echo")) is True


def test_voxtype_is_available_missing_model() -> None:
    """A configured model path that does not exist makes STT unavailable."""
    import sys

    from app.stt import voxtype_is_available

    assert (
        voxtype_is_available(
            _settings(
                stt_voxtype_path=sys.executable,
                stt_model_path="/definitely/not/a/model.bin",
            )
        )
        is False
    )


def test_voxtype_is_available_present_model() -> None:
    """A configured model path that exists makes STT available."""
    import sys

    from app.stt import voxtype_is_available

    assert (
        voxtype_is_available(
            _settings(
                stt_voxtype_path=sys.executable,
                stt_model_path=sys.executable,
            )
        )
        is True
    )


def test_transcribe_default_availability_check() -> None:
    """Omitting voxtype_available uses the real filesystem check (here False)."""
    runner = _FakeRunner()
    result = transcribe_voice(
        "/tmp/voice.ogg",
        30,
        _settings(stt_voxtype_path="/definitely/not/a/real/binary"),
        runner,
    )
    assert result.ok is False
    assert result.unavailable is True
    assert runner.commands == []
