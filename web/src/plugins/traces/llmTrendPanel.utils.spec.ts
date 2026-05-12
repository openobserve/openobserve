// Copyright 2026 OpenObserve Inc.
//
// Tests for the small pure helpers that LLMTrendPanel uses for axis
// labels, table cells and the gap-fill bucket math. Extracted into a
// utils module so they can be tested without mounting the SFC (which
// pulls in echarts / quasar at mount time).

import { describe, it, expect } from "vitest";
import {
  intervalToMs,
  formatCompact,
  formatLatencyMs,
  formatTimeCell,
  formatCostCell,
  chipColor,
  formatTimeLabel,
} from "./llmTrendPanel.utils";

// ===========================================================================
// intervalToMs
// ===========================================================================

describe("intervalToMs", () => {
  // Every supported unit, both singular and plural — pickInterval emits
  // strings like "10 seconds", "1 minute", "5 minutes" interchangeably.
  it.each([
    ["1 second", 1_000],
    ["10 seconds", 10_000],
    ["1 minute", 60_000],
    ["5 minutes", 300_000],
    ["1 hour", 3_600_000],
    ["6 hours", 21_600_000],
    ["1 day", 86_400_000],
    ["7 days", 7 * 86_400_000],
  ])('parses "%s" as %dms', (input, expected) => {
    expect(intervalToMs(input)).toBe(expected);
  });

  // Case insensitive — pickInterval is consistent but be defensive.
  it("is case-insensitive", () => {
    expect(intervalToMs("5 MINUTES")).toBe(300_000);
    expect(intervalToMs("1 Hour")).toBe(3_600_000);
  });

  // Defensive default — keeps the gap-fill math from collapsing when
  // an unexpected interval string sneaks through.
  it("falls back to 60_000ms for unparseable input", () => {
    expect(intervalToMs("garbage")).toBe(60_000);
    expect(intervalToMs("")).toBe(60_000);
    expect(intervalToMs("5")).toBe(60_000);
    expect(intervalToMs("milliseconds")).toBe(60_000);
  });

  // Negative or weird leading chars don't match the regex (no leading
  // sign allowed) → fall back.
  it("does not accept negative numbers (falls back)", () => {
    expect(intervalToMs("-1 minute")).toBe(60_000);
  });
});

// ===========================================================================
// formatCompact
// ===========================================================================

describe("formatCompact", () => {
  // Each branch of the if-ladder.
  it.each([
    [2_500_000, "2.5M"],
    [1_000_000, "1.0M"],
    [12_345, "12.3K"],
    [1_000, "1.0K"],
    [999, "999"],          // ≥ 100, no decimal
    [100, "100"],
    [99.5, "99.5"],         // ≥ 1, 1 decimal
    [1.5, "1.5"],
    [1, "1.0"],
    [0.5, "0.5"],           // < 1, raw toString()
    [0, "0"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });
});

// ===========================================================================
// formatLatencyMs
// ===========================================================================

describe("formatLatencyMs", () => {
  // Sub-second values use ms with rounding.
  it.each([
    [0, "0ms"],
    [1, "1ms"],
    [123, "123ms"],
    [123.7, "124ms"],   // rounded
    [999, "999ms"],
    [999.4, "999ms"],
  ])("formats %d as %s (sub-second)", (input, expected) => {
    expect(formatLatencyMs(input)).toBe(expected);
  });

  // ≥ 1000ms switches to seconds with 1-decimal precision.
  it.each([
    [1000, "1.0s"],
    [1500, "1.5s"],
    [12_300, "12.3s"],
    [60_000, "60.0s"],
  ])("formats %d as %s (seconds)", (input, expected) => {
    expect(formatLatencyMs(input)).toBe(expected);
  });
});

// ===========================================================================
// formatTimeCell
// ===========================================================================

describe("formatTimeCell", () => {
  // Empty / null → empty string (not "Invalid Date").
  it("returns empty string for null / undefined / empty", () => {
    expect(formatTimeCell(null)).toBe("");
    expect(formatTimeCell(undefined)).toBe("");
  });

  // Microseconds (>1e15) — divides by 1000 to get milliseconds.
  it("treats values > 1e15 as microseconds", () => {
    // Pick a known timestamp: 2026-05-08 in UTC = 1778198400000ms
    const us = 1778198400_000_000;
    const result = formatTimeCell(us);
    // Format is HH:mm:ss in local TZ — just verify shape.
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  // Milliseconds (1e12 – 1e15) — used as-is.
  it("treats values 1e12 – 1e15 as milliseconds", () => {
    const ms = 1778198400_000;
    expect(formatTimeCell(ms)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  // Seconds (<1e12) — multiplied by 1000.
  it("treats values < 1e12 as seconds", () => {
    const s = 1778198400;
    expect(formatTimeCell(s)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  // SQL-style "2026-05-08 12:30:45" → parses as if it had a T separator.
  it('parses "YYYY-MM-DD HH:mm:ss" strings', () => {
    const result = formatTimeCell("2026-05-08 12:30:45");
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  // ISO 8601 strings parse natively.
  it("parses ISO 8601 strings", () => {
    expect(formatTimeCell("2026-05-08T12:30:45Z")).toMatch(
      /^\d{2}:\d{2}:\d{2}$/,
    );
  });

  // Unparseable strings → returned as-is so the cell never shows
  // "Invalid Date" or NaN.
  it("falls back to the raw input string for unparseable values", () => {
    expect(formatTimeCell("totally not a date")).toBe("totally not a date");
  });
});

// ===========================================================================
// formatCostCell
// ===========================================================================

describe("formatCostCell", () => {
  // Each branch of the precision ladder.
  it.each([
    [{ cost: 0 }, "$0"],
    [{ cost: -1 }, "$0"],            // negative treated as zero
    [{ cost: 12.34 }, "$12.34"],     // ≥ 1 → 2 decimals
    [{ cost: 1.5 }, "$1.50"],
    [{ cost: 0.5 }, "$0.500"],       // 0.01 ≤ x < 1 → 3 decimals
    [{ cost: 0.05 }, "$0.050"],
    [{ cost: 0.01 }, "$0.010"],
    [{ cost: 0.001 }, "$0.0010"],   // < 0.01 → 4 decimals
    [{ cost: 0.0001 }, "$0.0001"],
  ])("formats %j as %s", (row, expected) => {
    expect(formatCostCell(row)).toBe(expected);
  });

  // Non-numeric cost (NaN after Number()) → "—". Note: `null` coerces
  // to 0 in JS, so `{ cost: null }` falls through to the "$0" branch
  // instead of "—" — that's the documented behaviour.
  it.each([
    [{}],                          // missing cost → Number(undefined)=NaN
    [{ cost: undefined }],
    [{ cost: "abc" }],             // non-numeric string → NaN
    [null],                        // null row → optional chain → undefined → NaN
    [undefined],
  ])('returns "—" for missing / non-numeric cost: %j', (row) => {
    expect(formatCostCell(row)).toBe("—");
  });

  // Explicit `null` cost coerces to 0 (Number(null) === 0).
  it("explicit null cost → $0 (Number(null) coerces to 0)", () => {
    expect(formatCostCell({ cost: null })).toBe("$0");
  });

  // String numbers are coerced (backend may return cost as string).
  it("coerces numeric strings", () => {
    expect(formatCostCell({ cost: "1.5" })).toBe("$1.50");
  });
});

// ===========================================================================
// chipColor
// ===========================================================================

describe("chipColor", () => {
  // Determinism — same input always produces the same color, so a
  // service named "api" gets a stable visual identity across renders.
  it("returns the same color for the same input", () => {
    const a = chipColor("payments");
    const b = chipColor("payments");
    expect(a).toBe(b);
  });

  // Picks from a known palette of 8 colors.
  it("returns a color from the documented palette", () => {
    const palette = [
      "#6366f1", "#10b981", "#f97316", "#ec4899",
      "#0ea5e9", "#a855f7", "#eab308", "#14b8a6",
    ];
    expect(palette).toContain(chipColor("anything"));
  });

  // Distribution check — different strings should not all collapse to
  // the same color (the hash should spread input across the palette).
  it("distributes different strings across multiple palette entries", () => {
    const colors = new Set<string>();
    for (const s of ["api", "worker", "frontend", "ingest", "db", "queue", "cache", "auth"]) {
      colors.add(chipColor(s));
    }
    // 8 distinct service names → expect at least 4 distinct colors.
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  // Defensive — null / empty string still returns a valid color (not
  // undefined or a runtime error).
  it("returns a color for null / undefined / empty", () => {
    const palette = [
      "#6366f1", "#10b981", "#f97316", "#ec4899",
      "#0ea5e9", "#a855f7", "#eab308", "#14b8a6",
    ];
    expect(palette).toContain(chipColor(null));
    expect(palette).toContain(chipColor(undefined));
    expect(palette).toContain(chipColor(""));
  });

  // Stringifies non-string inputs (numbers, booleans).
  it("stringifies non-string inputs", () => {
    const palette = [
      "#6366f1", "#10b981", "#f97316", "#ec4899",
      "#0ea5e9", "#a855f7", "#eab308", "#14b8a6",
    ];
    expect(palette).toContain(chipColor(42));
    expect(palette).toContain(chipColor(true));
  });
});

// ===========================================================================
// formatTimeLabel
// ===========================================================================

describe("formatTimeLabel", () => {
  // Standard SQL-style histogram bucket → "HH:mm".
  it('parses "YYYY-MM-DD HH:mm:ss" buckets to HH:mm', () => {
    expect(formatTimeLabel("2026-05-08 12:30:00")).toMatch(/^\d{2}:\d{2}$/);
  });

  // ISO 8601 → also "HH:mm".
  it("parses ISO 8601 buckets", () => {
    expect(formatTimeLabel("2026-05-08T12:30:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  // Unparseable → returned verbatim (avoid "Invalid Date" labels).
  it("returns raw input when parsing fails", () => {
    expect(formatTimeLabel("not a date")).toBe("not a date");
    expect(formatTimeLabel("")).toBe("");
  });

  // Pads single-digit components.
  it("zero-pads single-digit hour and minute", () => {
    const result = formatTimeLabel("2026-05-08T03:04:05Z");
    // hh / mm are at least 2 chars each.
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});
