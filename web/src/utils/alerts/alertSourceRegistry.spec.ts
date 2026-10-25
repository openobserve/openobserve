import i18n from "@/locales";
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

  it("keeps the query-only dialog to the dashboard panel and metrics explorer flows", () => {
    const pickers = Object.values(ALERT_SOURCES)
      .filter((definition) => definition.pickQueryOnly)
      .map((definition) => definition.id);
    expect(pickers).toEqual(["panel", "explorer"]);
    expect(DEFAULT_ALERT_SOURCE.pickQueryOnly).toBeFalsy();
  });

  it("treats only the panel flows' aggregation as a Builder seed rather than a trigger", () => {
    const seeds = Object.values(ALERT_SOURCES)
      .filter((definition) => definition.aggregationIsSeed)
      .map((definition) => definition.id);
    expect(seeds).toEqual(["panel", "explorer"]);
  });

  it("names the Metrics Explorer in an Explorer alert's toast", () => {
    expect(getAlertSource("explorer").toastKey).toBe("alerts.prefill.sources.explorer.toast");
    expect(i18n.global.t(getAlertSource("explorer").toastKey)).toBe(
      "Query imported from the Metrics Explorer",
    );
  });

  it("registers the intent and suggestion sources as the only intent-path sources", () => {
    expect(getAlertSource("intent").id).toBe("intent");
    expect(getAlertSource("suggestion").id).toBe("suggestion");
    const intentPath = Object.values(ALERT_SOURCES)
      .filter((definition) => definition.intentPath)
      .map((definition) => definition.id);
    expect(intentPath).toEqual(["intent", "suggestion"]);
    expect(DEFAULT_ALERT_SOURCE.intentPath).toBeFalsy();
  });

  it("names the stream in the intent and suggestion toasts", () => {
    expect(i18n.global.t(getAlertSource("intent").toastKey, { sourceLabel: "payment" })).toBe(
      "Alert started for payment. Check it, then save.",
    );
    expect(i18n.global.t(getAlertSource("suggestion").toastKey, { sourceLabel: "payment" })).toBe(
      "Suggested alert for payment. Check it, then save.",
    );
  });
});
