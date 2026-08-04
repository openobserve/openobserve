import { describe, it, expect } from "vitest";
import { buildPrefillFromLogs, logsAlertSnapshot, type LogsPrefillInput } from "./fromLogs";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";

const logs = (overrides: Partial<LogsPrefillInput> = {}): LogsPrefillInput => ({
  streamNames: ["k8s_logs"],
  streamType: "logs",
  sqlMode: false,
  rawQuery: "code = 200",
  resolvedSql: 'select * from "k8s_logs" WHERE code = 200',
  datetime: { type: "relative", relativeTimePeriod: "15m" },
  ...overrides,
});

const keys = (p: ReturnType<typeof buildPrefillFromLogs>) => p.warnings.map((w) => w.key);

describe("buildPrefillFromLogs", () => {
  describe("query selection", () => {
    it("uses the editor content verbatim in SQL mode", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" WHERE a = 1' }),
      );
      expect(p.sql).toBe('SELECT * FROM "k8s_logs" WHERE a = 1');
      expect(keys(p)).not.toContain("convertedToSql");
    });

    it("uses the resolved payload in filter mode and says the query changed shape", () => {
      const p = buildPrefillFromLogs(logs());
      expect(p.sql).toBe('select * from "k8s_logs" WHERE code = 200');
      expect(keys(p)).toContain("convertedToSql");
    });

    it("never leaks the unresolved WHERE template", () => {
      const p = normalizePrefill(
        buildPrefillFromLogs(
          logs({ resolvedSql: 'select [FIELD_LIST] from "[INDEX_NAME]" [WHERE_CLAUSE]' }),
        ),
      );
      expect(keys(p)).toContain("unresolvedQuery");
      expect(isPrefillBlocked(p)).toBe(true);
    });
  });

  describe("display-only clauses", () => {
    it("strips LIMIT, which would otherwise cap the alert's count", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" LIMIT 100' }),
      );
      expect(p.sql).toBe('SELECT * FROM "k8s_logs"');
      expect(keys(p)).toContain("limitStripped");
    });

    it("strips ORDER BY", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" ORDER BY _timestamp DESC' }),
      );
      expect(p.sql).toBe('SELECT * FROM "k8s_logs"');
      expect(keys(p)).toContain("orderByStripped");
    });

    it("leaves a subquery's LIMIT alone", () => {
      const sql = 'SELECT * FROM "k8s_logs" WHERE id IN (SELECT id FROM "t" LIMIT 5)';
      const p = buildPrefillFromLogs(logs({ sqlMode: true, rawQuery: sql }));
      expect(p.sql).toBe(sql);
    });
  });

  describe("blocking cases", () => {
    it("blocks a histogram query — per-bucket rows cannot drive a threshold", () => {
      const p = buildPrefillFromLogs(
        logs({
          sqlMode: true,
          rawQuery: 'SELECT histogram(_timestamp, \'10 second\') AS x, count(*) FROM "k8s_logs"',
        }),
      );
      expect(keys(p)).toContain("histogramNotSupported");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
    });

    it("blocks when no stream is selected", () => {
      const p = buildPrefillFromLogs(logs({ streamNames: [] }));
      expect(keys(p)).toContain("noStream");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
    });
  });

  describe("streams", () => {
    it("offers every selected stream as a candidate for the dialog", () => {
      const p = buildPrefillFromLogs(logs({ streamNames: ["a", "b"] }));
      expect(p.streamCandidates).toEqual([
        { name: "a", type: "logs" },
        { name: "b", type: "logs" },
      ]);
      expect(p.streamName).toBe("a");
    });

    it("warns that a join collapses to a single stream", () => {
      const p = buildPrefillFromLogs(
        logs({
          sqlMode: true,
          rawQuery: 'SELECT * FROM "a" JOIN "b" ON a.id = b.id',
          streamNames: ["a", "b"],
        }),
      );
      expect(keys(p)).toContain("joinSingleStream");
    });

    it("does not cry join for a single-stream query", () => {
      expect(keys(buildPrefillFromLogs(logs({ sqlMode: true, rawQuery: 'SELECT * FROM "a"' })))).not.toContain(
        "joinSingleStream",
      );
    });

    it("carries the stream type through for metrics and traces", () => {
      expect(buildPrefillFromLogs(logs({ streamType: "traces" })).streamType).toBe("traces");
    });
  });

  describe("transforms", () => {
    it("carries a VRL function and notes it was copied by value", () => {
      const p = buildPrefillFromLogs(logs({ transformType: "function", vrl: ".foo = 1" }));
      expect(p.vrlFunction).toBe(".foo = 1");
      expect(keys(p)).toContain("savedFunctionCopied");
    });

    it("drops an action, which alerts cannot represent", () => {
      const p = buildPrefillFromLogs(logs({ transformType: "action", vrl: "whatever" }));
      expect(p.vrlFunction).toBeNull();
      expect(keys(p)).toContain("actionsDropped");
    });
  });

  describe("time range", () => {
    it("maps a relative range to the rolling window", () => {
      expect(
        buildPrefillFromLogs(logs({ datetime: { type: "relative", relativeTimePeriod: "1h" } }))
          .periodMinutes,
      ).toBe(60);
    });

    it("converts an absolute range and warns", () => {
      const start = 1_700_000_000_000_000;
      const p = buildPrefillFromLogs(
        logs({ datetime: { type: "absolute", startTime: start, endTime: start + 20 * 60_000_000 } }),
      );
      expect(p.periodMinutes).toBe(20);
      expect(keys(p)).toContain("absoluteToRolling");
    });
  });

  describe("advisories", () => {
    it("warns when the search has no filter at all", () => {
      expect(keys(buildPrefillFromLogs(logs({ rawQuery: "  " })))).toContain("broadMatch");
    });

    it("stays quiet about breadth when a filter is present", () => {
      expect(keys(buildPrefillFromLogs(logs()))).not.toContain("broadMatch");
    });

    it("notes an empty result set without blocking", () => {
      const p = buildPrefillFromLogs(logs({ hasResults: false }));
      expect(keys(p)).toContain("noResults");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    });

    it("exposes an aggregate alias so the form can threshold on the number", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT count(*) AS total FROM "k8s_logs"' }),
      );
      expect(p.meta?.aggregateAlias).toBe("total");
    });
  });

  it("names the alert after the stream", () => {
    expect(buildPrefillFromLogs(logs()).name).toBe("Alert_from_k8s_logs");
  });

  it("produces a contract-valid prefill for an ordinary search", () => {
    const p = normalizePrefill(buildPrefillFromLogs(logs()));
    expect(isPrefillBlocked(p)).toBe(false);
    expect(p.source).toBe("logs");
    expect(p.streamName).toBe("k8s_logs");
  });
});

describe("logsAlertSnapshot", () => {
  const searchObj = () => ({
    data: {
      query: "code = 200",
      tempFunctionContent: ".a = 1",
      transformType: "function",
      stream: { selectedStream: ["k8s_logs", "app_logs"], streamType: "logs" },
      datetime: {
        type: "relative",
        relativeTimePeriod: "30m",
        startTime: 1,
        endTime: 2,
      },
      queryResults: { hits: [{ a: 1 }] },
    },
    meta: { sqlMode: true },
  });

  it("flattens searchObj into the adapter's input", () => {
    const snapshot = logsAlertSnapshot(searchObj(), "SELECT 1", "Asia/Kolkata");

    expect(snapshot).toEqual({
      streamNames: ["k8s_logs", "app_logs"],
      streamType: "logs",
      sqlMode: true,
      rawQuery: "code = 200",
      resolvedSql: "SELECT 1",
      vrl: ".a = 1",
      transformType: "function",
      datetime: { type: "relative", relativeTimePeriod: "30m", startTime: 1, endTime: 2 },
      timezone: "Asia/Kolkata",
      hasResults: true,
    });
  });

  it("reports no results when the last run returned none", () => {
    const obj = searchObj();
    obj.data.queryResults = { hits: [] };
    expect(logsAlertSnapshot(obj, "SELECT 1").hasResults).toBe(false);
  });

  it("survives a half-initialised searchObj without throwing", () => {
    expect(() => logsAlertSnapshot({}, "")).not.toThrow();

    const snapshot = logsAlertSnapshot({}, "");
    expect(snapshot.streamNames).toEqual([]);
    expect(snapshot.streamType).toBe("logs");
    expect(snapshot.datetime).toBeNull();
    expect(snapshot.hasResults).toBe(false);
  });

  it("feeds the adapter end to end", () => {
    const p = buildPrefillFromLogs(logsAlertSnapshot(searchObj(), "SELECT 1"));
    expect(p.source).toBe("logs");
    expect(p.streamCandidates).toHaveLength(2);
    expect(p.periodMinutes).toBe(30);
  });
});
