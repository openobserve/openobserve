// @vitest-environment jsdom
// Tests for useFilterMode — shared filterMode (stream|agent) state + persistence
// extracted from SessionsList.vue. State + persistence ONLY; no side-effects.
//
// Init precedence matched exactly to SessionsList.vue:344-345:
//   const filterMode = ref<"stream" | "agent">(
//     urlType === "stream" ? "stream" : "agent",
//   );
// i.e. initial value comes from urlType ONLY. localStorage is NOT read for
// the initial value (even when persistKey is set) — it is only written to on
// setMode(), matching SessionsList's load-path write at line 595.

import { describe, it, expect, beforeEach } from "vitest";
import { useFilterMode } from "./useFilterMode";

describe("useFilterMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 'agent' when no options are given", () => {
    const { filterMode } = useFilterMode();
    expect(filterMode.value).toBe("agent");
  });

  it("respects an explicit default", () => {
    const { filterMode } = useFilterMode({ default: "agent" });
    expect(filterMode.value).toBe("agent");
  });

  it("starts in 'stream' mode when initialFromUrlType is 'stream'", () => {
    const { filterMode } = useFilterMode({ initialFromUrlType: "stream" });
    expect(filterMode.value).toBe("stream");
  });

  it("starts in 'agent' mode when initialFromUrlType is anything other than 'stream'", () => {
    const { filterMode } = useFilterMode({ initialFromUrlType: "agent" });
    expect(filterMode.value).toBe("agent");

    const { filterMode: filterMode2 } = useFilterMode({ initialFromUrlType: "" });
    expect(filterMode2.value).toBe("agent");

    const { filterMode: filterMode3 } = useFilterMode({ initialFromUrlType: undefined });
    expect(filterMode3.value).toBe("agent");
  });

  it("does NOT read localStorage for the initial value, even when persistKey is set and LS holds 'stream' (matches SessionsList:344-345 — init is urlType-only)", () => {
    localStorage.setItem("sessionsList_filterMode", "stream");

    const { filterMode } = useFilterMode({ persistKey: "sessionsList_filterMode" });

    expect(filterMode.value).toBe("agent");
  });

  it("initialFromUrlType still wins over a stale localStorage value on init", () => {
    localStorage.setItem("sessionsList_filterMode", "stream");

    const { filterMode } = useFilterMode({
      persistKey: "sessionsList_filterMode",
      initialFromUrlType: "agent",
    });

    expect(filterMode.value).toBe("agent");
  });

  it("setMode updates filterMode.value", () => {
    const { filterMode, setMode } = useFilterMode();

    setMode("stream");
    expect(filterMode.value).toBe("stream");

    setMode("agent");
    expect(filterMode.value).toBe("agent");
  });

  it("setMode writes to localStorage when persistKey is set", () => {
    const { setMode } = useFilterMode({ persistKey: "sessionsList_filterMode" });

    setMode("stream");
    expect(localStorage.getItem("sessionsList_filterMode")).toBe("stream");

    setMode("agent");
    expect(localStorage.getItem("sessionsList_filterMode")).toBe("agent");
  });

  it("setMode does NOT write to localStorage when persistKey is not set", () => {
    const { setMode } = useFilterMode();

    setMode("stream");
    expect(localStorage.getItem("sessionsList_filterMode")).toBeNull();
  });

  it("multiple independent instances do not share state", () => {
    const a = useFilterMode();
    const b = useFilterMode();

    a.setMode("stream");

    expect(a.filterMode.value).toBe("stream");
    expect(b.filterMode.value).toBe("agent");
  });
});
