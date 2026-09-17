import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSmartInput } from "../../src/ui/viewModels/useSmartInput";

const { useServicesMock } = vi.hoisted(() => ({
  useServicesMock: vi.fn(),
}));
vi.mock("../../src/ui/services/useServices", () => ({
  useServices: useServicesMock,
}));

describe("useSmartInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn(),
      },
    });
  });

  it("starts empty with no error", () => {
    const { result } = renderHook(() => useSmartInput(() => {}));
    expect(result.current.text).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);
    expect(result.current.parsing).toBe(false);
  });

  it("setText updates the text and clears error", () => {
    const { result } = renderHook(() => useSmartInput(() => {}));
    act(() => result.current.setText("dentist tuesday"));
    expect(result.current.text).toBe("dentist tuesday");
  });

  it("submit parses text and calls onParsed with the converted draft", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: true,
          draft: { title: "Dentist", start_at: "2026-09-22T15:00:00", tz: "UTC" },
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("dentist tuesday 3pm"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).toHaveBeenCalledTimes(1);
    const draft = onParsed.mock.calls[0][0] as { title: string; date: string; time: string };
    expect(draft.title).toBe("Dentist");
    expect(draft.date).toBe("2026-09-22");
    expect(draft.time).toBe("15:00");
    // The box clears after a successful parse.
    expect(result.current.text).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.parsing).toBe(false);
  });

  it("submit shows the error and does not call onParsed on a failed parse", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: false,
          error: "could not parse",
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("gibberish"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.error).toBe("could not parse");
    expect(result.current.unavailable).toBe(false);
  });

  it("submit flags unavailable when the parse reports the LLM key is absent", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: false,
          unavailable: true,
          error: "Parsing is unavailable (LLM key not configured).",
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("dentist"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.error).toContain("unavailable");
  });

  it("submit shows an inline error when the draft cannot be converted", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: true,
          draft: { title: "" },
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("nothing"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.error).toContain("manually");
  });

  it("renders the distinct 502 LLM-failure message from core verbatim", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: false,
          error:
            "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API logs (server: LLM request failed (HTTP 401))",
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("dentist"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "LLM parsing failed — check LLM_API_KEY / LLM_MODEL in .env and the API logs (server: LLM request failed (HTTP 401))",
    );
    expect(result.current.unavailable).toBe(false);
  });

  it("renders the distinct cannot-reach-API message from core verbatim", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockResolvedValue({
          ok: false,
          error:
            "Cannot reach the API — check that the backend is running and the address is correct.",
        }),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("dentist"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.error).toContain("Cannot reach the API");
    expect(result.current.unavailable).toBe(false);
  });

  it("falls back to the generic message only for truly unexpected throws", async () => {
    const onParsed = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: {
        parse: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });
    const { result } = renderHook(() => useSmartInput(onParsed));
    act(() => result.current.setText("dentist"));
    await act(async () => {
      await result.current.submit();
    });
    expect(onParsed).not.toHaveBeenCalled();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.error).toBe(
      "Parsing is unavailable right now. You can still add the event manually.",
    );
  });

  it("submit does nothing for empty text", async () => {
    const parse = vi.fn();
    useServicesMock.mockReturnValue({
      apiClient: {},
      llmParser: { parse },
    });
    const { result } = renderHook(() => useSmartInput(() => {}));
    await act(async () => {
      await result.current.submit();
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("clear resets text and error", () => {
    const { result } = renderHook(() => useSmartInput(() => {}));
    act(() => result.current.setText("dentist"));
    act(() => result.current.clear());
    expect(result.current.text).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);
  });
});
