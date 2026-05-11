// Copyright 2026 OpenObserve Inc.
//
// Tests for the LLM Insights panel registry + helpers.
//
// Coverage focuses on the two pure helpers (`renderPanelSql` and
// `pickInterval`) plus invariants on the static `LLM_INSIGHTS_PANELS`
// array that the renderer depends on (e.g. unique IDs, valid layout
// spans, table panels declaring columns).

import { describe, it, expect } from "vitest";
import {
  LLM_INSIGHTS_PANELS,
  renderPanelSql,
  pickInterval,
  type LLMPanelDef,
} from "./llmInsightsPanels";

describe("renderPanelSql", () => {
  // The placeholders are global — every occurrence must be replaced, not
  // just the first. SQL templates often reference {{stream}} multiple
  // times (e.g. inside a CTE plus an outer SELECT).
  it("replaces every {{stream}} occurrence and quotes the identifier", () => {
    const sql = renderPanelSql(
      "SELECT * FROM {{stream}} JOIN {{stream}} s ON true",
      { stream: "traces", startTime: 1, endTime: 2, interval: "1 minute" },
    );
    expect(sql).toBe(
      `SELECT * FROM "traces" JOIN "traces" s ON true`,
    );
  });

  // start/end times are stamped in raw, unquoted — DataFusion expects them
  // as numeric literals on the WHERE side of the query.
  it("substitutes startTime / endTime as raw numbers (no quotes)", () => {
    const sql = renderPanelSql(
      "WHERE _timestamp BETWEEN {{startTime}} AND {{endTime}}",
      {
        stream: "x",
        startTime: 1_700_000_000_000_000,
        endTime: 1_700_000_900_000_000,
        interval: "1 minute",
      },
    );
    expect(sql).toBe(
      "WHERE _timestamp BETWEEN 1700000000000000 AND 1700000900000000",
    );
    // No accidental wrapping in quotes.
    expect(sql).not.toContain(`'1700000000000000'`);
    expect(sql).not.toContain(`"1700000900000000"`);
  });

  // Interval lands inside a string literal in real templates
  // (`histogram(_timestamp, '{{interval}}')`). The helper itself doesn't
  // add the quotes — verify it leaves the value verbatim and trusts the
  // template author.
  it("substitutes {{interval}} verbatim without adding quotes", () => {
    const sql = renderPanelSql(
      "histogram(_timestamp, '{{interval}}')",
      { stream: "x", startTime: 1, endTime: 2, interval: "5 minutes" },
    );
    expect(sql).toBe("histogram(_timestamp, '5 minutes')");
  });

  // A template with no placeholders should round-trip unchanged.
  it("returns the input unchanged when no placeholders are present", () => {
    const sql = renderPanelSql("SELECT 1", {
      stream: "x",
      startTime: 1,
      endTime: 2,
      interval: "1 minute",
    });
    expect(sql).toBe("SELECT 1");
  });

  // Verify all four placeholders coexisting in one template — the realistic
  // shape used by every config-driven panel.
  it("substitutes all four placeholders simultaneously", () => {
    const sql = renderPanelSql(
      `SELECT histogram(_timestamp, '{{interval}}') FROM {{stream}}
       WHERE _timestamp BETWEEN {{startTime}} AND {{endTime}}`,
      {
        stream: "default",
        startTime: 100,
        endTime: 200,
        interval: "1 hour",
      },
    );
    expect(sql).toContain(`FROM "default"`);
    expect(sql).toContain("'1 hour'");
    expect(sql).toContain("BETWEEN 100 AND 200");
  });

  // Stream names with special characters (hyphens, dots) must be preserved
  // verbatim inside the quotes — the wrapping quotes are what makes them
  // SQL-safe identifiers.
  it("preserves stream names with hyphens and dots inside the quotes", () => {
    const sql = renderPanelSql("FROM {{stream}}", {
      stream: "my-stream.test",
      startTime: 1,
      endTime: 2,
      interval: "1 minute",
    });
    expect(sql).toBe(`FROM "my-stream.test"`);
  });

  // Large microsecond timestamps (16-digit) must not lose precision via
  // `String(number)` — JS Number can hold integers up to 2^53.
  it("formats Number.MAX_SAFE_INTEGER timestamp without precision loss", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const sql = renderPanelSql("{{startTime}}", {
      stream: "x",
      startTime: big,
      endTime: big,
      interval: "1 minute",
    });
    expect(sql).toBe(String(big));
  });

  // Empty stream name still gets the wrapping quotes — the resulting SQL
  // would be invalid but the helper isn't responsible for input validation.
  it("wraps an empty stream string in quotes (defers validation to caller)", () => {
    expect(
      renderPanelSql("FROM {{stream}}", {
        stream: "",
        startTime: 1,
        endTime: 2,
        interval: "1 minute",
      }),
    ).toBe(`FROM ""`);
  });
});

describe("pickInterval", () => {
  // Each branch is exercised with a value safely inside its range.
  // Thresholds compare `target = seconds/30`; comparison is strict `<`,
  // so the value at the boundary moves to the *next* bucket.

  // 10 min window: 600s / 30 = 20 → < 30 → "10 seconds"
  it('returns "10 seconds" for windows under 15 minutes', () => {
    expect(pickInterval(10 * 60 * 1_000_000)).toBe("10 seconds");
  });

  // 30 min window: 1800s / 30 = 60 → < 120 → "1 minute"
  it('returns "1 minute" for windows in [15 min, 1 hr)', () => {
    expect(pickInterval(30 * 60 * 1_000_000)).toBe("1 minute");
  });

  // 3 hr window: 10800s / 30 = 360 → < 600 → "5 minutes"
  it('returns "5 minutes" for windows in [1 hr, 5 hr)', () => {
    expect(pickInterval(3 * 60 * 60 * 1_000_000)).toBe("5 minutes");
  });

  // 12 hr window: 43200s / 30 = 1440 → < 1800 → "15 minutes"
  it('returns "15 minutes" for windows in [5 hr, 15 hr)', () => {
    expect(pickInterval(12 * 60 * 60 * 1_000_000)).toBe("15 minutes");
  });

  // 24 hr window: 86400s / 30 = 2880 → < 3600 → "30 minutes"
  it('returns "30 minutes" for windows in [15 hr, 30 hr)', () => {
    expect(pickInterval(24 * 60 * 60 * 1_000_000)).toBe("30 minutes");
  });

  // 5 day window: 432000s / 30 = 14400 → < 21600 → "1 hour"
  it('returns "1 hour" for windows in [30 hr, 7.5 d)', () => {
    expect(pickInterval(5 * 24 * 60 * 60 * 1_000_000)).toBe("1 hour");
  });

  // 14 day window: 1209600s / 30 = 40320 → < 86400 → "6 hours"
  it('returns "6 hours" for windows in [7.5 d, 30 d)', () => {
    expect(pickInterval(14 * 24 * 60 * 60 * 1_000_000)).toBe("6 hours");
  });

  // 60 day window: 5184000s / 30 = 172800 → "1 day"
  it('returns "1 day" for windows ≥ 30 days', () => {
    expect(pickInterval(60 * 24 * 60 * 60 * 1_000_000)).toBe("1 day");
  });

  // Edge: zero / negative durations. The helper isn't designed for these
  // but should fail gracefully into the smallest bucket so a panel with
  // bad inputs doesn't crash the page.
  it("returns smallest bucket for zero / negative durations", () => {
    expect(pickInterval(0)).toBe("10 seconds");
    expect(pickInterval(-1)).toBe("10 seconds");
  });

  // Strict `<` means values exactly at a threshold fall through to the
  // next bucket. Pin this behaviour so a future tweak (e.g. switching to
  // `<=`) doesn't silently shift a whole class of windows by one bucket.
  it("uses strict `<` at every boundary (exact threshold falls through)", () => {
    // 15 min exactly → target = 30 → first `< 30` fails → "1 minute"
    expect(pickInterval(15 * 60 * 1_000_000)).toBe("1 minute");
    // 1 hr exactly → target = 120 → `< 120` fails → "5 minutes"
    expect(pickInterval(60 * 60 * 1_000_000)).toBe("5 minutes");
    // 5 hr exactly → target = 600 → `< 600` fails → "15 minutes"
    expect(pickInterval(5 * 60 * 60 * 1_000_000)).toBe("15 minutes");
    // 30 day exactly → target = 86_400 → `< 86_400` fails → "1 day"
    expect(pickInterval(30 * 24 * 60 * 60 * 1_000_000)).toBe("1 day");
  });
});

describe("LLM_INSIGHTS_PANELS — registry invariants", () => {
  // The renderer keys panels by `id`. Duplicate ids would produce ambiguous
  // results in the for-each grid render and break Vue's keyed-list updates.
  it("every panel has a unique id", () => {
    const ids = LLM_INSIGHTS_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // colSpan is constrained to 1 or 2 by the type, but verify at runtime
  // since static analysis doesn't catch literal "3" snuck into JSON.
  it("every panel declares a layout.colSpan of 1 or 2", () => {
    for (const p of LLM_INSIGHTS_PANELS) {
      expect([1, 2]).toContain(p.layout.colSpan);
    }
  });

  // Every SQL template references `{{stream}}` so it can be re-pointed at
  // the user's selected stream. A template missing this would silently
  // query the wrong table on stream switches.
  it("every panel SQL references the {{stream}} placeholder", () => {
    for (const p of LLM_INSIGHTS_PANELS) {
      expect(p.query.sql, `panel ${p.id} sql missing {{stream}}`).toContain(
        "{{stream}}",
      );
    }
  });

  // Time-series panels need a `timeField` so the renderer can pull the
  // x-axis values out of the result rows.
  it("stacked-area panels declare a timeField", () => {
    const areas = LLM_INSIGHTS_PANELS.filter((p) => p.type === "stacked-area");
    expect(areas.length).toBeGreaterThan(0);
    for (const p of areas) {
      expect(p.query.timeField, `panel ${p.id} missing timeField`).toBeTruthy();
    }
  });

  // Horizontal-bar panels render top-N — they must declare both
  // seriesField (categories) and valueField (bar lengths).
  it("horizontal-bar panels declare seriesField and valueField", () => {
    const bars = LLM_INSIGHTS_PANELS.filter((p) => p.type === "horizontal-bar");
    expect(bars.length).toBeGreaterThan(0);
    for (const p of bars) {
      expect(
        p.query.seriesField,
        `panel ${p.id} missing seriesField`,
      ).toBeTruthy();
      expect(
        p.query.valueField,
        `panel ${p.id} missing valueField`,
      ).toBeTruthy();
    }
  });

  // Table panels MUST declare columns; the renderer iterates `panel.columns`
  // and would render an empty table without them.
  it("table panels declare a columns array", () => {
    const tables = LLM_INSIGHTS_PANELS.filter((p) => p.type === "table");
    expect(tables.length).toBeGreaterThan(0);
    for (const p of tables) {
      expect(p.columns, `panel ${p.id} missing columns`).toBeTruthy();
      expect((p.columns as any[]).length).toBeGreaterThan(0);
    }
  });

  // Latency panel pulls raw durations and bucketizes client-side; it
  // needs both the main query and a thresholds query (for the percentile
  // guide lines drawn on the chart).
  it("histogram-with-thresholds panels declare a thresholdsQuery and thresholds[]", () => {
    const histos = LLM_INSIGHTS_PANELS.filter(
      (p) => p.type === "histogram-with-thresholds",
    );
    expect(histos.length).toBeGreaterThan(0);
    for (const p of histos) {
      expect(p.thresholdsQuery?.sql).toBeTruthy();
      expect(Array.isArray(p.thresholds)).toBe(true);
      expect((p.thresholds as any[]).length).toBeGreaterThan(0);
    }
  });

  // The "Recent errors" table renders an Operation column and a Trace ID
  // (View) link. Both are required for the panel's UX to be useful.
  it("recent-errors panel exposes operation + trace_id columns", () => {
    const recentErrors = LLM_INSIGHTS_PANELS.find(
      (p: LLMPanelDef) => p.id === "recent-errors",
    );
    expect(recentErrors).toBeTruthy();
    const fields = recentErrors!.columns!.map((c) => c.field);
    expect(fields).toContain("operation");
    expect(fields).toContain("trace_id");
  });

  // Errors-over-time uses gap-fill so an empty result shows "0 over time"
  // instead of a misleading "No data" — preserve this configuration so a
  // future reader doesn't strip it as cosmetic.
  it("errors-over-time panel keeps gapFill='zero'", () => {
    const errors = LLM_INSIGHTS_PANELS.find(
      (p: LLMPanelDef) => p.id === "errors-over-time",
    );
    expect(errors?.gapFill).toBe("zero");
  });
});
