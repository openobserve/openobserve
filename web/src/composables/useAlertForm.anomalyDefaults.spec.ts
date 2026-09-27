// Copyright 2026 OpenObserve Inc.

// The create-form default must match the DB column default, the server default
// and the edit prefill (all 97). A higher value is silently clamped and
// truncated server-side, so the alert reopens showing a number nobody chose.

import { describe, it, expect } from "vitest";
import {
  anomalyIntervalPayload,
  anomalyWindowSecondsToParts,
  defaultAnomalyConfig,
  parseAnomalyInterval,
} from "@/composables/useAlertForm";

describe("defaultAnomalyConfig", () => {
  it("defaults threshold to the 97th percentile", () => {
    expect(defaultAnomalyConfig().threshold).toBe(97);
  });
});

// §4.5: ONE interval grammar (s/m/h/d) shared with the server's parse_interval.
describe("parseAnomalyInterval", () => {
  it("parses every unit of the s/m/h/d grammar", () => {
    expect(parseAnomalyInterval("30s", 5, "m")).toEqual({ value: 30, unit: "s", parsed: true });
    expect(parseAnomalyInterval("5m", 5, "m")).toEqual({ value: 5, unit: "m", parsed: true });
    expect(parseAnomalyInterval("2h", 5, "m")).toEqual({ value: 2, unit: "h", parsed: true });
    expect(parseAnomalyInterval("1d", 5, "m")).toEqual({ value: 1, unit: "d", parsed: true });
  });

  it("reads 90s as ninety SECONDS, not ninety minutes", () => {
    expect(parseAnomalyInterval("90s", 5, "m")).toEqual({ value: 90, unit: "s", parsed: true });
  });

  it("falls back to the given default on anything off-grammar, flagged unparsed", () => {
    expect(parseAnomalyInterval("90x", 5, "m")).toEqual({ value: 5, unit: "m", parsed: false });
    expect(parseAnomalyInterval("", 1, "h")).toEqual({ value: 1, unit: "h", parsed: false });
    expect(parseAnomalyInterval(undefined, 1, "h")).toEqual({ value: 1, unit: "h", parsed: false });
    expect(parseAnomalyInterval("0m", 5, "m")).toEqual({ value: 5, unit: "m", parsed: false });
    expect(parseAnomalyInterval("1.5h", 1, "h")).toEqual({ value: 1, unit: "h", parsed: false });
  });
});

describe("anomalyWindowSecondsToParts", () => {
  it("picks the largest lossless unit so the dirty check compares real values", () => {
    expect(anomalyWindowSecondsToParts(86400)).toEqual({ value: 1, unit: "d" });
    expect(anomalyWindowSecondsToParts(7200)).toEqual({ value: 2, unit: "h" });
    expect(anomalyWindowSecondsToParts(600)).toEqual({ value: 10, unit: "m" });
    expect(anomalyWindowSecondsToParts(90)).toEqual({ value: 90, unit: "s" });
  });
});

// D4/N11: untouched stored fields round-trip VERBATIM; dirty is value comparison, not touched-flags.
describe("anomalyIntervalPayload", () => {
  // A legacy row on odd raw values, as parseAnomalyInterval seeds the form from them.
  const stored = () => ({
    histogram: { raw: "90s", value: 90, unit: "s", parsed: true },
    schedule: { raw: "1h", value: 1, unit: "h", parsed: true },
    window: { raw: 3990, value: 3990, unit: "s", parsed: true },
  });
  const untouchedForm = () => ({
    histogram_interval_value: 90,
    histogram_interval_unit: "s",
    schedule_interval_value: 1,
    schedule_interval_unit: "h",
    detection_window_value: 3990,
    detection_window_unit: "s",
  });

  it("a description-only edit round-trips the stored raw triple byte-identical", () => {
    expect(anomalyIntervalPayload(untouchedForm(), stored())).toEqual({
      histogram_interval: "90s",
      schedule_interval: "1h",
      detection_window_seconds: 3990,
    });
  });

  it("an edit-and-revert saves byte-identical (value comparison, not touched-flags)", () => {
    const form = untouchedForm();
    form.detection_window_value = 7200;
    form.detection_window_unit = "s";
    form.detection_window_value = 3990;
    expect(anomalyIntervalPayload(form, stored())).toEqual({
      histogram_interval: "90s",
      schedule_interval: "1h",
      detection_window_seconds: 3990,
    });
  });

  it("a touched field re-serializes from the form value; untouched fields stay verbatim", () => {
    const form = untouchedForm();
    form.detection_window_value = 2;
    form.detection_window_unit = "h";
    expect(anomalyIntervalPayload(form, stored())).toEqual({
      histogram_interval: "90s",
      schedule_interval: "1h",
      detection_window_seconds: 7200,
    });
  });

  it("an unparsable stored value the user replaced re-serializes; left alone it round-trips", () => {
    const s = stored();
    s.histogram = { raw: "90x", value: 5, unit: "m", parsed: false };
    const form = untouchedForm();
    form.histogram_interval_value = 5;
    form.histogram_interval_unit = "m";
    // Untouched (matches the seeded default) → the raw wire value survives.
    expect(anomalyIntervalPayload(form, s).histogram_interval).toBe("90x");

    form.histogram_interval_value = 10;
    expect(anomalyIntervalPayload(form, s).histogram_interval).toBe("10m");
  });

  it("create mode (no stored triple) always serializes from the form", () => {
    expect(anomalyIntervalPayload(untouchedForm(), null)).toEqual({
      histogram_interval: "90s",
      schedule_interval: "1h",
      detection_window_seconds: 3990,
    });
  });
});
