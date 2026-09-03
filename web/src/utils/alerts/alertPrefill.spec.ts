import { describe, it, expect } from "vitest";
import {
  MAX_PERIOD_MINUTES,
  clampPeriodMinutes,
  firstAggregateAlias,
  hasHistogramBucketing,
  isPrefillBlocked,
  needsConfirmation,
  normalizePrefill,
  periodMinutesFromRange,
  sanitizeAlertNamePart,
  stripDisplayOnlyClauses,
} from "./alertPrefill";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const basePrefill = (overrides: Partial<AlertPrefill> = {}): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "test",
  sourceLabel: "test",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: 'SELECT * FROM "k8s_logs"',
  warnings: [],
  ...overrides,
});

const warningKeys = (p: AlertPrefill) => p.warnings.map((w) => w.key);

describe("clampPeriodMinutes", () => {
  it("clamps below the floor", () => {
    expect(clampPeriodMinutes(0)).toBe(1);
    expect(clampPeriodMinutes(-30)).toBe(1);
  });

  it("clamps above the ceiling", () => {
    expect(clampPeriodMinutes(100_000)).toBe(MAX_PERIOD_MINUTES);
  });

  it("rounds fractional minutes", () => {
    expect(clampPeriodMinutes(15.4)).toBe(15);
    expect(clampPeriodMinutes(15.6)).toBe(16);
  });
});

describe("periodMinutesFromRange", () => {
  it("maps relative periods across units", () => {
    expect(periodMinutesFromRange({ type: "relative", relativeTimePeriod: "15m" }).minutes).toBe(
      15,
    );
    expect(periodMinutesFromRange({ type: "relative", relativeTimePeriod: "2h" }).minutes).toBe(
      120,
    );
    expect(periodMinutesFromRange({ type: "relative", relativeTimePeriod: "1d" }).minutes).toBe(
      1440,
    );
  });

  it("defaults to 15 minutes when the range is missing or unparseable", () => {
    expect(periodMinutesFromRange(null).minutes).toBe(15);
    expect(periodMinutesFromRange({ type: "relative", relativeTimePeriod: "banana" }).minutes).toBe(
      15,
    );
  });

  it("converts an absolute range to a rolling window and says so", () => {
    const start = 1_700_000_000_000_000;
    const result = periodMinutesFromRange({
      type: "absolute",
      startTime: start,
      endTime: start + 30 * 60_000_000,
    });
    expect(result.minutes).toBe(30);
    expect(result.warnings.map((w) => w.key)).toContain("absoluteToRolling");
  });

  it("clamps an over-long range and warns", () => {
    const result = periodMinutesFromRange({ type: "relative", relativeTimePeriod: "30d" });
    expect(result.minutes).toBe(MAX_PERIOD_MINUTES);
    expect(result.warnings.map((w) => w.key)).toContain("periodClamped");
  });
});

describe("stripDisplayOnlyClauses", () => {
  it("strips a trailing LIMIT and warns", () => {
    const result = stripDisplayOnlyClauses('SELECT * FROM "logs" WHERE a = 1 LIMIT 100');
    expect(result.sql).toBe('SELECT * FROM "logs" WHERE a = 1');
    expect(result.warnings.map((w) => w.key)).toEqual(["limitStripped"]);
  });

  it("strips a trailing ORDER BY and warns", () => {
    const result = stripDisplayOnlyClauses('SELECT * FROM "logs" ORDER BY _timestamp DESC');
    expect(result.sql).toBe('SELECT * FROM "logs"');
    expect(result.warnings.map((w) => w.key)).toEqual(["orderByStripped"]);
  });

  it("strips both, reporting each once", () => {
    const result = stripDisplayOnlyClauses(
      'SELECT * FROM "logs" ORDER BY _timestamp DESC LIMIT 50',
    );
    expect(result.sql).toBe('SELECT * FROM "logs"');
    expect(result.warnings.map((w) => w.key)).toEqual(["limitStripped", "orderByStripped"]);
  });

  it("does NOT strip a LIMIT inside a subquery", () => {
    const sql = 'SELECT * FROM "logs" WHERE id IN (SELECT id FROM "t" ORDER BY x LIMIT 10)';
    const result = stripDisplayOnlyClauses(sql);
    expect(result.sql).toBe(sql);
    expect(result.warnings).toEqual([]);
  });

  it("does NOT strip the word LIMIT inside a string literal", () => {
    const sql = "SELECT * FROM \"logs\" WHERE msg = 'rate LIMIT exceeded'";
    expect(stripDisplayOnlyClauses(sql).sql).toBe(sql);
  });

  it("does NOT strip LIMIT embedded in an identifier", () => {
    const sql = 'SELECT rate_limited FROM "logs"';
    expect(stripDisplayOnlyClauses(sql).sql).toBe(sql);
  });

  it("drops a trailing semicolon", () => {
    expect(stripDisplayOnlyClauses('SELECT * FROM "logs";').sql).toBe('SELECT * FROM "logs"');
  });
});

describe("hasHistogramBucketing", () => {
  it("detects histogram()", () => {
    expect(hasHistogramBucketing("SELECT histogram(_timestamp, '10 second') FROM \"l\"")).toBe(
      true,
    );
    expect(hasHistogramBucketing('SELECT count(*) FROM "l"')).toBe(false);
  });
});

describe("firstAggregateAlias", () => {
  it("finds the alias of the first aggregate", () => {
    expect(firstAggregateAlias('SELECT count(*) as "total" FROM "l"')).toBe("total");
    expect(firstAggregateAlias("SELECT avg(latency) AS avg_latency FROM l")).toBe("avg_latency");
  });

  it("returns null when there is no aggregate", () => {
    expect(firstAggregateAlias('SELECT * FROM "l"')).toBeNull();
  });
});

describe("sanitizeAlertNamePart", () => {
  it("replaces unsafe characters", () => {
    expect(sanitizeAlertNamePart("My Panel: #1")).toBe("My_Panel_1");
  });

  it("falls back when empty", () => {
    expect(sanitizeAlertNamePart("")).toBe("source");
    expect(sanitizeAlertNamePart("   ", "panel")).toBe("panel");
  });
});

describe("normalizePrefill — invariants", () => {
  it("stamps the contract version", () => {
    expect(normalizePrefill(basePrefill({ version: 0 as any })).version).toBe(
      ALERT_PREFILL_VERSION,
    );
  });

  it("blocks a query still carrying source-syntax markers", () => {
    const result = normalizePrefill(
      basePrefill({ sql: 'select [FIELD_LIST] from "[INDEX_NAME]" [WHERE_CLAUSE]' }),
    );
    expect(warningKeys(result)).toContain("unresolvedQuery");
    expect(isPrefillBlocked(result)).toBe(true);
  });

  it("blocks when there is no stream and no candidates", () => {
    const result = normalizePrefill(basePrefill({ streamName: "" }));
    expect(warningKeys(result)).toContain("noStream");
    expect(isPrefillBlocked(result)).toBe(true);
  });

  it("falls back to the first candidate when the stream is unset", () => {
    const result = normalizePrefill(
      basePrefill({
        streamName: "",
        streamCandidates: [
          { name: "a", type: "logs" },
          { name: "b", type: "logs" },
        ],
      }),
    );
    expect(result.streamName).toBe("a");
    expect(isPrefillBlocked(result)).toBe(false);
  });

  it("blocks a sql prefill with no sql", () => {
    expect(warningKeys(normalizePrefill(basePrefill({ sql: "   " })))).toContain("emptyQuery");
  });

  it("blocks a promql prefill with no promql", () => {
    const result = normalizePrefill(
      basePrefill({ queryType: "promql", sql: undefined, promql: "" }),
    );
    expect(warningKeys(result)).toContain("emptyQuery");
  });

  it("clamps the period", () => {
    expect(normalizePrefill(basePrefill({ periodMinutes: 99_999 })).periodMinutes).toBe(
      MAX_PERIOD_MINUTES,
    );
  });

  it("leaves an absent period absent", () => {
    expect(normalizePrefill(basePrefill()).periodMinutes).toBeUndefined();
  });

  it("floors the trigger threshold at 1 — the form's own rule", () => {
    expect(normalizePrefill(basePrefill({ triggerThreshold: 0 })).triggerThreshold).toBe(1);
    expect(normalizePrefill(basePrefill({ triggerThreshold: 4.6 })).triggerThreshold).toBe(5);
  });

  it("keeps a silence of 0 — 'notify every time' is a real choice, not unset", () => {
    expect(normalizePrefill(basePrefill({ silenceMinutes: 0 })).silenceMinutes).toBe(0);
    expect(normalizePrefill(basePrefill({ silenceMinutes: -5 })).silenceMinutes).toBe(0);
  });

  it("leaves the trigger fields absent when the surface has no opinion", () => {
    const result = normalizePrefill(basePrefill());
    expect(result.triggerThreshold).toBeUndefined();
    expect(result.triggerOperator).toBeUndefined();
    expect(result.silenceMinutes).toBeUndefined();
  });

  it("dedupes identical warnings", () => {
    const result = normalizePrefill(
      basePrefill({
        warnings: [
          { key: "limitStripped", level: "warning" },
          { key: "limitStripped", level: "warning" },
        ],
      }),
    );
    expect(warningKeys(result)).toEqual(["limitStripped"]);
  });

  it("keeps the most severe level when the same warning arrives twice", () => {
    // An advisory must never mask a block: "some patterns were unusable" and
    // "all of them were" share a key but not a consequence.
    const result = normalizePrefill(
      basePrefill({
        warnings: [
          { key: "noConstants", level: "warning" },
          { key: "noConstants", level: "blocking" },
        ],
      }),
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].level).toBe("blocking");
    expect(isPrefillBlocked(result)).toBe(true);
  });

  it("keeps same-key warnings with different params", () => {
    const result = normalizePrefill(
      basePrefill({
        warnings: [
          { key: "periodClamped", level: "warning", params: { minutes: 60 } },
          { key: "periodClamped", level: "warning", params: { minutes: 30 } },
        ],
      }),
    );
    expect(result.warnings).toHaveLength(2);
  });

  it("empties blank query strings rather than passing whitespace through", () => {
    const result = normalizePrefill(basePrefill({ queryType: "custom", sql: "  ", promql: " " }));
    expect(result.sql).toBeUndefined();
    expect(result.promql).toBeUndefined();
  });
});

describe("needsConfirmation — when the dialog earns its click", () => {
  it("skips the dialog for the ordinary case: one stream, no patterns, nothing lossy", () => {
    expect(needsConfirmation(basePrefill())).toBe(false);
  });

  it("skips it for non-blocking warnings, which ride along to the form instead", () => {
    const p = basePrefill({
      warnings: [
        { key: "limitStripped", level: "warning" },
        { key: "absoluteToRolling", level: "warning", params: { minutes: 30 } },
      ],
    });
    expect(needsConfirmation(p)).toBe(false);
  });

  it("asks when more than one stream could be meant", () => {
    const p = basePrefill({
      streamCandidates: [
        { name: "a", type: "logs" },
        { name: "b", type: "logs" },
      ],
    });
    expect(needsConfirmation(p)).toBe(true);
  });

  it("does not ask when the surface offered exactly one candidate", () => {
    expect(
      needsConfirmation(basePrefill({ streamCandidates: [{ name: "a", type: "logs" }] })),
    ).toBe(false);
  });

  it("asks when there are patterns to include or exclude", () => {
    const p = basePrefill({
      patternFilter: { mode: "exclude", visibleCount: 6, totalCount: 15, filtered: true },
    });
    expect(needsConfirmation(p)).toBe(true);
  });

  it("skips it when the patterns tab found nothing to offer", () => {
    const p = basePrefill({
      patternFilter: { mode: "exclude", visibleCount: 0, totalCount: 0, filtered: false },
    });
    expect(needsConfirmation(p)).toBe(false);
  });

  it("always asks when the prefill is blocked, so the reason gets stated", () => {
    expect(
      needsConfirmation(basePrefill({ warnings: [{ key: "noStream", level: "blocking" }] })),
    ).toBe(true);
  });
});
