import { describe, it, expect, vi, afterEach } from "vitest";
import { ALERT_SOURCES, DEFAULT_ALERT_SOURCE, getAlertSource } from "./alertSourceRegistry";

describe("alertSourceRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a registered source", () => {
    expect(getAlertSource("logs").id).toBe("logs");
    expect(getAlertSource("patterns").defaultThreshold).toBe("count");
    expect(getAlertSource("panel").defaultThreshold).toBe("matching-rows");
  });

  it("falls back to defaults for an unregistered source rather than throwing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getAlertSource("something-new")).toEqual(DEFAULT_ALERT_SOURCE);
  });

  it("falls back silently when no id is given", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getAlertSource(undefined)).toEqual(DEFAULT_ALERT_SOURCE);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("every entry's id matches its key", () => {
    for (const [key, definition] of Object.entries(ALERT_SOURCES)) {
      expect(definition.id).toBe(key);
    }
  });

  it("every entry carries the i18n keys the UI needs", () => {
    for (const definition of Object.values(ALERT_SOURCES)) {
      expect(definition.labelKey).toMatch(/^alerts\.prefill\.sources\./);
      expect(definition.toastKey).toMatch(/^alerts\.prefill\.sources\./);
      expect(definition.icon).toBeTruthy();
    }
  });
});
