// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import useAnalyzingMessage from "./useAnalyzingMessage";

describe("useAnalyzingMessage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows nothing until started", () => {
    const { current } = useAnalyzingMessage(["a", "b", "c"]);
    expect(current.value).toBe("");
  });

  it("picks a message as soon as it starts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { current, start } = useAnalyzingMessage(["a", "b", "c"]);
    start();
    expect(current.value).toBe("a");
  });

  it("rotates to a new message every 5 seconds", () => {
    vi.useFakeTimers();
    const draws = [0, 0.5, 0.99];
    let call = 0;
    vi.spyOn(Math, "random").mockImplementation(() => draws[call++]);
    const { current, start } = useAnalyzingMessage(["a", "b", "c"]);

    start();
    expect(current.value).toBe("a");

    vi.advanceTimersByTime(5000);
    expect(current.value).toBe("b");

    vi.advanceTimersByTime(5000);
    expect(current.value).toBe("c");
  });

  it("stops rotating once stopped", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { current, start, stop } = useAnalyzingMessage(["a", "b"]);

    start();
    stop();
    vi.advanceTimersByTime(20000);

    expect(current.value).toBe("a");
  });

  it("clears the previous timer when started again, rather than stacking one", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { start } = useAnalyzingMessage(["a", "b"]);

    start();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    start();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
