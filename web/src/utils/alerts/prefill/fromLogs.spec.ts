import { describe, it, expect } from "vitest";
import { buildPrefillFromLogs, logsAlertSnapshot, type LogsPrefillInput } from "./fromLogs";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";
import { parseWhereClauseToFilterChecked } from "@/utils/query/sqlUtils";

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
    it("uses the editor content in SQL mode, projecting the timestamp instead of *", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" WHERE a = 1' }),
      );
      expect(p.queryType).toBe("sql");
      expect(p.sql).toBe('SELECT _timestamp FROM "k8s_logs" WHERE a = 1');
      expect(keys(p)).not.toContain("convertedToSql");
      expect(keys(p)).toContain("selectStarReplaced");
    });

    it("uses the resolved payload in filter mode and says the query changed shape", () => {
      const p = buildPrefillFromLogs(logs());
      expect(p.queryType).toBe("sql");
      expect(p.sql).toBe('select _timestamp from "k8s_logs" WHERE code = 200');
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

  describe("builder prefill from a filter-mode search", () => {
    const parsed = (conditions: any[], complete = true) => ({
      filter: { filterType: "group", logicalOperator: "AND", conditions },
      complete,
    });
    const leaf = (field: string, operator: string, value: any, logicalOperator = "AND") => ({
      type: "condition",
      values: [],
      column: { field, streamAlias: null },
      operator,
      value,
      logicalOperator,
      filterType: "condition",
    });

    it("opens the condition builder when the whole filter converts", () => {
      const p = buildPrefillFromLogs(logs({ parsedFilter: parsed([leaf("code", "=", "200")]) }));
      expect(p.queryType).toBe("custom");
      expect(p.sql).toBeUndefined();
      expect(p.conditions?.filterType).toBe("group");
      expect(p.conditions?.groupId).toEqual(expect.any(String));
      expect(p.conditions?.groupId).not.toBe("");
      expect(p.conditions?.conditions).toEqual([
        expect.objectContaining({
          filterType: "condition",
          column: "code",
          operator: "=",
          value: "200",
          logicalOperator: "AND",
          id: expect.any(String),
        }),
      ]);
      expect(keys(p)).not.toContain("convertedToSql");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    });

    it("maps the logs operator spellings onto the alert form's", () => {
      const p = buildPrefillFromLogs(
        logs({
          parsedFilter: parsed([
            leaf("a", "<>", "1"),
            leaf("b", "Contains", "x", "OR"),
            leaf("c", "Not Contains", "y"),
            leaf("d", "Is Null", null),
            leaf("e", "Is Not Null", null),
          ]),
        }),
      );
      const ops = p.conditions?.conditions.map((c: any) => [
        c.operator,
        c.value,
        c.logicalOperator,
      ]);
      expect(ops).toEqual([
        ["!=", "1", "AND"],
        ["Contains", "x", "OR"],
        ["NotContains", "y", "AND"],
        ["is_null", "", "AND"],
        ["is_not_null", "", "AND"],
      ]);
    });

    it("keeps nested groups as nested groups", () => {
      const nested = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [leaf("b", "=", "2"), leaf("c", "=", "3", "OR")],
      };
      const p = buildPrefillFromLogs(logs({ parsedFilter: parsed([leaf("a", "=", "1"), nested]) }));
      const group = p.conditions?.conditions[1];
      expect(group.filterType).toBe("group");
      expect(group.groupId).toEqual(expect.any(String));
      expect(group.conditions.map((c: any) => c.column)).toEqual(["b", "c"]);
    });

    it("opens an empty builder for an empty search", () => {
      const p = buildPrefillFromLogs(
        logs({ rawQuery: "", resolvedSql: 'select * from "k8s_logs"' }),
      );
      expect(p.queryType).toBe("custom");
      expect(p.conditions?.conditions).toEqual([]);
      expect(p.conditions?.groupId).toEqual(expect.any(String));
      expect(keys(p)).toContain("broadMatch");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    });

    it("falls back to SQL when the filter only partly parsed", () => {
      const p = buildPrefillFromLogs(
        logs({ parsedFilter: parsed([leaf("code", "=", "200")], false) }),
      );
      expect(p.queryType).toBe("sql");
      expect(p.conditions).toBeUndefined();
      expect(p.sql).toBe('select _timestamp from "k8s_logs" WHERE code = 200');
      expect(keys(p)).toContain("convertedToSql");
    });

    it("falls back to SQL when a parsed clause has no builder operator", () => {
      const p = buildPrefillFromLogs(
        logs({
          rawQuery: "str_match(msg, 'x')",
          resolvedSql: "select * from \"k8s_logs\" WHERE str_match(msg, 'x')",
          parsedFilter: parsed([leaf("msg", "str_match", "x")]),
        }),
      );
      expect(p.queryType).toBe("sql");
      expect(keys(p)).toContain("convertedToSql");
    });

    it("falls back to SQL for an IN list", () => {
      const list = { ...leaf("a", null as any, null), type: "list", values: ["1", "2"] };
      expect(buildPrefillFromLogs(logs({ parsedFilter: parsed([list]) })).queryType).toBe("sql");
    });

    it("keeps SQL when the filter was held", () => {
      const p = buildPrefillFromLogs(
        logs({
          resolvedSql: 'select * from "k8s_logs"',
          heldFilterDropped: true,
          parsedFilter: parsed([leaf("code", "=", "200")]),
        }),
      );
      expect(p.queryType).toBe("sql");
    });

    it("never uses the builder in SQL mode", () => {
      const p = buildPrefillFromLogs(
        logs({
          sqlMode: true,
          rawQuery: 'SELECT * FROM "k8s_logs" WHERE code = 200',
          parsedFilter: parsed([leaf("code", "=", "200")]),
        }),
      );
      expect(p.queryType).toBe("sql");
    });

    it("converts a real parse of a quick-mode filter", async () => {
      const parsedFilter = await parseWhereClauseToFilterChecked("code = 200 and level != 'debug'");
      const p = buildPrefillFromLogs(
        logs({ rawQuery: "code = 200 and level != 'debug'", parsedFilter }),
      );
      expect(p.queryType).toBe("custom");
      expect(p.conditions?.conditions.map((c: any) => [c.column, c.operator, c.value])).toEqual([
        ["code", "=", "200"],
        ["level", "!=", "debug"],
      ]);
    });
  });

  describe("select * rewrite", () => {
    it("projects the configured timestamp column", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'select * from "a"', timestampColumn: "ts" }),
      );
      expect(p.sql).toBe('select ts from "a"');
    });

    it("leaves an explicit projection alone", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT count(*) AS total FROM "a"' }),
      );
      expect(p.sql).toBe('SELECT count(*) AS total FROM "a"');
      expect(keys(p)).not.toContain("selectStarReplaced");
    });
  });

  describe("display-only clauses", () => {
    it("strips LIMIT, which would otherwise cap the alert's count", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" LIMIT 100' }),
      );
      expect(p.sql).toBe('SELECT _timestamp FROM "k8s_logs"');
      expect(keys(p)).toContain("limitStripped");
    });

    it("strips ORDER BY", () => {
      const p = buildPrefillFromLogs(
        logs({ sqlMode: true, rawQuery: 'SELECT * FROM "k8s_logs" ORDER BY _timestamp DESC' }),
      );
      expect(p.sql).toBe('SELECT _timestamp FROM "k8s_logs"');
      expect(keys(p)).toContain("orderByStripped");
    });

    it("leaves a subquery's LIMIT alone", () => {
      const sql = 'SELECT * FROM "k8s_logs" WHERE id IN (SELECT id FROM "t" LIMIT 5)';
      const p = buildPrefillFromLogs(logs({ sqlMode: true, rawQuery: sql }));
      expect(p.sql).toBe(
        'SELECT _timestamp FROM "k8s_logs" WHERE id IN (SELECT id FROM "t" LIMIT 5)',
      );
    });
  });

  describe("blocking cases", () => {
    it("blocks a histogram query — per-bucket rows cannot drive a threshold", () => {
      const p = buildPrefillFromLogs(
        logs({
          sqlMode: true,
          rawQuery: "SELECT histogram(_timestamp, '10 second') AS x, count(*) FROM \"k8s_logs\"",
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
      expect(
        keys(buildPrefillFromLogs(logs({ sqlMode: true, rawQuery: 'SELECT * FROM "a"' }))),
      ).not.toContain("joinSingleStream");
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
        logs({
          datetime: { type: "absolute", startTime: start, endTime: start + 20 * 60_000_000 },
        }),
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

    it("opens a held filter with the filter-dropped warning, the same as patterns", () => {
      const p = normalizePrefill(
        buildPrefillFromLogs(
          logs({
            rawQuery: "status=500 -404 AND is_error",
            resolvedSql: 'select * from "k8s_logs"',
            heldFilterDropped: true,
          }),
        ),
      );
      expect(keys(p)).toContain("heldFilterDropped");
      expect(keys(p)).not.toContain("textFilterDropped");
      expect(keys(p)).toContain("broadMatch");
      expect(keys(p)).not.toContain("convertedToSql");
      expect(isPrefillBlocked(p)).toBe(false);
      expect(p.sql).toBe('select _timestamp from "k8s_logs"');
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

  it("carries the dropped-filter flag through to the adapter", () => {
    expect(logsAlertSnapshot(searchObj(), "SELECT 1", undefined, true).heldFilterDropped).toBe(
      true,
    );
    expect(logsAlertSnapshot(searchObj(), "SELECT 1").heldFilterDropped).toBeFalsy();
  });

  it("carries the parsed filter and timestamp column through to the adapter", () => {
    const parsedFilter = {
      filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      complete: true,
    };
    const snapshot = logsAlertSnapshot(searchObj(), "SELECT 1", undefined, false, {
      parsedFilter,
      timestampColumn: "ts",
    });
    expect(snapshot.parsedFilter).toBe(parsedFilter);
    expect(snapshot.timestampColumn).toBe("ts");
  });

  it("feeds the adapter end to end", () => {
    const p = buildPrefillFromLogs(logsAlertSnapshot(searchObj(), "SELECT 1"));
    expect(p.source).toBe("logs");
    expect(p.streamCandidates).toHaveLength(2);
    expect(p.periodMinutes).toBe(30);
  });
});
