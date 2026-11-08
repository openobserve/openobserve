// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  addToSqlWhere,
  eventKey,
  eventMatchWhere,
  eventsSql,
  filterClause,
  foldHistogram,
  histogramInterval,
  histogramKeyToMs,
  histogramSql,
  topValuesSql,
  whereParts,
} from "./eventQuery";

const base = { severityField: null, severityNumeric: false, severity: [], filters: [] };

describe("filterClause", () => {
  it("quotes identifiers and escapes single quotes in values", () => {
    expect(filterClause({ field: "user", op: "=", value: "o'brien" })).toBe(`"user" = 'o''brien'`);
    expect(filterClause({ field: 'a"b', op: "=", value: "x" })).toBe(`"a""b" = 'x'`);
  });

  it("wraps contains in wildcards", () => {
    expect(filterClause({ field: "msg", op: "contains", value: "fail" })).toBe(
      `CAST("msg" AS VARCHAR) LIKE '%fail%'`,
    );
  });

  it("keeps rows without the field when excluding a value", () => {
    expect(filterClause({ field: "err", op: "!=", value: "Denied" })).toBe(
      `("err" != 'Denied' OR "err" IS NULL)`,
    );
    expect(filterClause({ field: "msg", op: "not_contains", value: "ok" })).toBe(
      `(CAST("msg" AS VARCHAR) NOT LIKE '%ok%' OR "msg" IS NULL)`,
    );
  });

  it("treats LIKE wildcards in a typed value as literal characters", () => {
    expect(filterClause({ field: "f", op: "contains", value: "50%_a\\b" })).toBe(
      `CAST("f" AS VARCHAR) LIKE '%50\\%\\_a\\\\b%'`,
    );
  });

  it("treats an unknown op as equality rather than dropping the filter", () => {
    expect(filterClause({ field: "a", op: "??", value: "1" })).toBe(`"a" = '1'`);
  });
});

describe("whereParts", () => {
  it("emits numeric severity unquoted and text severity quoted", () => {
    expect(
      whereParts({ ...base, severityField: "severity_id", severityNumeric: true, severity: [5] }),
    ).toEqual([`"severity_id" = 5`]);
    expect(whereParts({ ...base, severityField: "level", severity: ["error", "warn"] })).toEqual([
      `"level" IN ('error', 'warn')`,
    ]);
  });

  it("can leave the severity facet out so the chart shows the whole distribution", () => {
    const f = {
      ...base,
      severityField: "level",
      severity: ["error"],
      filters: [{ field: "host", op: "=", value: "db1" }],
    };
    expect(whereParts(f, false)).toEqual([`"host" = 'db1'`]);
    expect(whereParts(f)).toHaveLength(2);
  });

  it("ignores severity when the stream has no severity field", () => {
    expect(whereParts({ ...base, severity: ["error"] })).toEqual([]);
  });
});

describe("SQL builders", () => {
  it("builds the rows query newest first", () => {
    expect(eventsSql("okta", [`"a" = '1'`])).toBe(
      `SELECT * FROM "okta" WHERE "a" = '1' ORDER BY _timestamp DESC`,
    );
    expect(eventsSql("okta", [])).toBe(`SELECT * FROM "okta" ORDER BY _timestamp DESC`);
  });

  it("splits the histogram by severity only when there is a severity field", () => {
    expect(histogramSql("s", [], "level", "1 minute")).toContain(`"level" AS zo_sev`);
    expect(histogramSql("s", [], "level", "1 minute")).toContain("GROUP BY zo_ts, zo_sev");
    expect(histogramSql("s", [], null, "1 minute")).not.toContain("zo_sev");
  });

  it("limits top values", () => {
    expect(topValuesSql("s", [], "user", 5)).toMatch(
      /GROUP BY zo_value ORDER BY zo_n DESC LIMIT 5$/,
    );
  });
});

describe("histogramInterval", () => {
  it("keeps the chart at or under sixty bars", () => {
    expect(histogramInterval(15 * 60_000).sql).toBe("30 second");
    expect(histogramInterval(24 * 3_600_000).sql).toBe("30 minute");
    expect(histogramInterval(7 * 86_400_000).sql).toBe("3 hour");
  });
});

describe("histogramKeyToMs", () => {
  it("reads a zone-less ISO key as UTC", () => {
    expect(histogramKeyToMs("2026-01-01T00:00:00")).toBe(Date.UTC(2026, 0, 1));
  });

  it("reads epoch microseconds", () => {
    expect(histogramKeyToMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(histogramKeyToMs("1700000000000000")).toBe(1_700_000_000_000);
  });

  it("rejects garbage", () => {
    expect(histogramKeyToMs("")).toBeNull();
    expect(histogramKeyToMs("not a date")).toBeNull();
  });
});

describe("foldHistogram", () => {
  it("folds raw severity values onto tones and remembers which raw values made each tone", () => {
    const result = foldHistogram(
      [
        { zo_ts: "2026-01-01T00:00:00", zo_sev: "error", zo_n: 3 },
        { zo_ts: "2026-01-01T00:00:00", zo_sev: "info", zo_n: 10 },
        { zo_ts: "2026-01-01T00:01:00", zo_sev: "critical", zo_n: 1 },
      ],
      true,
    );
    expect(result.total).toBe(14);
    expect(result.totals.high).toBe(3);
    expect(result.totals.info).toBe(10);
    expect(result.totals.critical).toBe(1);
    expect(result.rawByTone.high).toEqual(["error"]);
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0].counts.high).toBe(3);
  });

  it("puts everything in one neutral series when the stream has no severity", () => {
    const result = foldHistogram([{ zo_ts: "2026-01-01T00:00:00", zo_n: 7 }], false);
    expect(result.totals.info).toBe(7);
    expect(result.rawByTone.info).toEqual([]);
  });

  it("maps numeric OCSF ids, including Fatal, onto critical", () => {
    const result = foldHistogram(
      [
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 5, zo_n: 1 },
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 6, zo_n: 1 },
      ],
      true,
    );
    expect(result.totals.critical).toBe(2);
    expect(result.rawByTone.critical.sort()).toEqual(["5", "6"]);
  });
});

describe("foldHistogram rawCounts", () => {
  it("counts each raw severity value across buckets", () => {
    const result = foldHistogram(
      [
        { zo_ts: "2026-01-01T00:00:00", zo_sev: "error", zo_n: 3 },
        { zo_ts: "2026-01-01T00:01:00", zo_sev: "error", zo_n: 2 },
        { zo_ts: "2026-01-01T00:01:00", zo_sev: "info", zo_n: 4 },
      ],
      true,
    );
    expect(result.rawCounts).toEqual({ error: 5, info: 4 });
  });
});

describe("eventMatchWhere / eventKey", () => {
  const row = { _timestamp: 1700, user: "o'brien", port: 22, nested: { a: 1 }, empty: null };

  it("pins the row by its scalar fields, not the timestamp alone", () => {
    expect(eventMatchWhere(row)).toBe(`_timestamp = 1700 AND "user" = 'o''brien' AND "port" = 22`);
  });

  it("gives two rows on the same timestamp different keys", () => {
    expect(eventKey(row)).not.toBe(eventKey({ ...row, user: "bob" }));
    expect(eventKey(row)).toBe(eventKey({ ...row }));
  });
});

describe("addToSqlWhere", () => {
  it("ANDs onto an existing WHERE and keeps ORDER BY", () => {
    expect(
      addToSqlWhere(`SELECT * FROM "s" WHERE a = 1 OR b = 2 ORDER BY _timestamp DESC`, `"u" = 'x'`),
    ).toBe(`SELECT * FROM "s" WHERE (a = 1 OR b = 2) AND "u" = 'x' ORDER BY _timestamp DESC`);
  });

  it("adds a WHERE when there is none", () => {
    expect(addToSqlWhere(`SELECT * FROM "s"`, `"u" = 'x'`)).toBe(
      `SELECT * FROM "s" WHERE "u" = 'x'`,
    );
  });

  it("accepts an unquoted table name", () => {
    expect(addToSqlWhere(`SELECT * FROM auth_events WHERE level='error'`, "x = 1")).toBe(
      `SELECT * FROM auth_events WHERE (level='error') AND x = 1`,
    );
  });

  it("ignores keywords inside string literals", () => {
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE msg = 'a ORDER BY b'`, "x = 1")).toBe(
      `SELECT * FROM "s" WHERE (msg = 'a ORDER BY b') AND x = 1`,
    );
  });

  it("refuses shapes it cannot edit safely", () => {
    expect(addToSqlWhere(`SELECT a, COUNT(*) FROM "s" GROUP BY a`, "x")).toBeNull();
    expect(addToSqlWhere(`SELECT * FROM "s" LIMIT 5`, "x")).toBeNull();
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE a IN (SELECT b FROM t)`, "x")).toBeNull();
  });
});

describe("addToSqlWhere with astral characters", () => {
  it("keeps slices aligned when a literal contains emoji", () => {
    expect(
      addToSqlWhere(`SELECT * FROM "s" WHERE msg = '😀😀' ORDER BY _timestamp DESC`, "a = 1"),
    ).toBe(`SELECT * FROM "s" WHERE (msg = '😀😀') AND a = 1 ORDER BY _timestamp DESC`);
  });
});

describe("eventMatchWhere precision", () => {
  it("does not match on integers beyond 2^53", () => {
    expect(eventMatchWhere({ _timestamp: 1, big: 2 ** 60, ok: 7 })).toBe(
      `_timestamp = 1 AND "ok" = 7`,
    );
  });
});
