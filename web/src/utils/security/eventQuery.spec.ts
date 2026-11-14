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
  isAggregateSql,
  projectedColumns,
  searchErrorText,
  selectedColumns,
  selectsAll,
  resultColumns,
  splitSeverity,
  topValuesSql,
  whereParts,
  type EventFilters,
} from "./eventQuery";

const SEV = "CASE x END";
const base: EventFilters = { severitySql: null, severity: [], filters: [] };

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
  it("filters on the server's severity expression by OCSF id", () => {
    expect(whereParts({ ...base, severitySql: SEV, severity: [5] })).toEqual([`(${SEV}) = 5`]);
    expect(whereParts({ ...base, severitySql: SEV, severity: [5, 6] })).toEqual([
      `(${SEV}) IN (5, 6)`,
    ]);
  });

  it("can leave the severity facet out so the chart shows the whole distribution", () => {
    const f = {
      ...base,
      severitySql: SEV,
      severity: [4],
      filters: [{ field: "host", op: "=", value: "db1" }],
    };
    expect(whereParts(f, false)).toEqual([`"host" = 'db1'`]);
    expect(whereParts(f)).toHaveLength(2);
  });

  it("ignores severity when the stream has none", () => {
    expect(whereParts({ ...base, severity: [4] })).toEqual([]);
  });
});

describe("SQL builders", () => {
  it("builds the rows query newest first", () => {
    expect(eventsSql("okta", [`"a" = '1'`])).toBe(
      `SELECT * FROM "okta" WHERE "a" = '1' ORDER BY _timestamp DESC`,
    );
    expect(eventsSql("okta", [])).toBe(`SELECT * FROM "okta" ORDER BY _timestamp DESC`);
  });

  it("projects the server's severity onto every row and sorts by its expression", () => {
    expect(eventsSql("okta", [], null, SEV)).toBe(
      `SELECT *, (${SEV}) AS zo_severity_id FROM "okta" ORDER BY _timestamp DESC`,
    );
    expect(eventsSql("okta", [], { field: "zo_severity_id", order: "desc" }, SEV)).toContain(
      `ORDER BY (${SEV}) DESC NULLS LAST, _timestamp DESC`,
    );
  });

  it("splits the histogram by the same severity expression the rows use", () => {
    expect(histogramSql("s", [], SEV, "1 minute")).toContain(`(${SEV}) AS zo_sev`);
    expect(histogramSql("s", [], SEV, "1 minute")).toContain("GROUP BY zo_ts, zo_sev");
    expect(histogramSql("s", [], null, "1 minute")).not.toContain("zo_sev");
  });

  it("limits top values", () => {
    expect(topValuesSql("s", [], "user", 5)).toMatch(
      /GROUP BY zo_value ORDER BY zo_n DESC LIMIT 5$/,
    );
  });
});

describe("splitSeverity", () => {
  it("takes the projected severity off each row", () => {
    const { rows, severity } = splitSeverity([
      { _timestamp: 1, user: "a", zo_severity_id: 3 },
      { _timestamp: 2, user: "b" },
    ]);
    expect(rows).toEqual([
      { _timestamp: 1, user: "a" },
      { _timestamp: 2, user: "b" },
    ]);
    expect(severity).toEqual([3, null]);
  });
});

describe("isAggregateSql", () => {
  it("spots GROUP BY, aggregates and DISTINCT", () => {
    expect(isAggregateSql(`SELECT user, COUNT(*) AS n FROM "okta" GROUP BY user`)).toBe(true);
    expect(isAggregateSql(`select count(*) from okta`)).toBe(true);
    expect(isAggregateSql(`SELECT DISTINCT user FROM okta`)).toBe(true);
  });

  it("leaves plain row queries alone, including keywords in literals and names", () => {
    expect(isAggregateSql(`SELECT * FROM okta WHERE msg = 'group by count(x)'`)).toBe(false);
    expect(isAggregateSql(`SELECT "count", user FROM okta ORDER BY _timestamp`)).toBe(false);
  });
});

describe("resultColumns", () => {
  it("prefers the server's column order, else the hit keys as first seen", () => {
    expect(resultColumns(["n", "user"], [{ user: "a", n: 1 }])).toEqual(["n", "user"]);
    expect(resultColumns(undefined, [{ user: "a", n: 1 }, { ip: "x" }])).toEqual([
      "user",
      "n",
      "ip",
    ]);
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
  it("folds OCSF ids onto tones and counts each id across buckets", () => {
    const result = foldHistogram(
      [
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 4, zo_n: 3 },
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 1, zo_n: 10 },
        { zo_ts: "2026-01-01T00:01:00", zo_sev: 5, zo_n: 1 },
        { zo_ts: "2026-01-01T00:01:00", zo_sev: "4", zo_n: 2 },
      ],
      true,
    );
    expect(result.total).toBe(16);
    expect(result.totals.high).toBe(5);
    expect(result.totals.info).toBe(10);
    expect(result.totals.critical).toBe(1);
    expect(result.idCounts).toEqual({ 1: 10, 4: 5, 5: 1 });
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0].counts.high).toBe(3);
  });

  it("puts everything in one neutral series when the stream has no severity", () => {
    const result = foldHistogram([{ zo_ts: "2026-01-01T00:00:00", zo_n: 7 }], false);
    expect(result.totals.info).toBe(7);
    expect(result.idCounts).toEqual({});
  });

  it("maps Fatal onto critical", () => {
    const result = foldHistogram(
      [
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 5, zo_n: 1 },
        { zo_ts: "2026-01-01T00:00:00", zo_sev: 6, zo_n: 1 },
      ],
      true,
    );
    expect(result.totals.critical).toBe(2);
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

  it("places the clause before GROUP BY, HAVING and LIMIT", () => {
    expect(addToSqlWhere(`SELECT a, COUNT(*) FROM "s" GROUP BY a`, "x = 1")).toBe(
      `SELECT a, COUNT(*) FROM "s" WHERE x = 1 GROUP BY a`,
    );
    expect(
      addToSqlWhere(
        `SELECT a, COUNT(*) AS n FROM "s" WHERE b = 2 GROUP BY a HAVING n > 1`,
        "x = 1",
      ),
    ).toBe(`SELECT a, COUNT(*) AS n FROM "s" WHERE (b = 2) AND x = 1 GROUP BY a HAVING n > 1`);
    expect(addToSqlWhere(`SELECT * FROM "s" LIMIT 5`, "x = 1")).toBe(
      `SELECT * FROM "s" WHERE x = 1 LIMIT 5`,
    );
  });

  it("refuses shapes it cannot edit safely", () => {
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE a IN (SELECT b FROM t)`, "x")).toBeNull();
    expect(addToSqlWhere(`SELECT * FROM "s" JOIN t ON s.a = t.a`, "x")).toBeNull();
  });
});

describe("addToSqlWhere with comments", () => {
  it("refuses a line comment, which would swallow the added clause", () => {
    expect(addToSqlWhere(`SELECT * FROM "web_access" -- recent`, `"status" = 500`)).toBeNull();
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE a = 1 --x\nORDER BY b`, "x = 1")).toBeNull();
  });

  it("refuses a block comment", () => {
    expect(addToSqlWhere(`SELECT * FROM "s" /* WHERE x */`, "x = 1")).toBeNull();
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE a = 1 /* ORDER BY b */`, "x = 1")).toBeNull();
  });

  it("keeps comment markers inside literals and quoted names", () => {
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE msg = '--help /* x'`, "x = 1")).toBe(
      `SELECT * FROM "s" WHERE (msg = '--help /* x') AND x = 1`,
    );
    expect(addToSqlWhere(`SELECT * FROM "a--b"`, "x = 1")).toBe(`SELECT * FROM "a--b" WHERE x = 1`);
  });

  it("refuses a backslash escape inside a literal", () => {
    expect(addToSqlWhere(`SELECT * FROM "s" WHERE u = 'x\\' -- '`, "x = 1")).toBeNull();
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

describe("eventsSql sorting", () => {
  it("defaults to newest first", () => {
    expect(eventsSql("okta", [])).toBe(`SELECT * FROM "okta" ORDER BY _timestamp DESC`);
  });

  it("sorts on the server by a column, newest first within a value", () => {
    expect(eventsSql("okta", [`"a" = 'b'`], { field: "client_ipaddress", order: "asc" })).toBe(
      `SELECT * FROM "okta" WHERE "a" = 'b' ORDER BY "client_ipaddress" ASC NULLS LAST, _timestamp DESC`,
    );
    expect(eventsSql("okta", [], { field: "_timestamp", order: "asc" })).toBe(
      `SELECT * FROM "okta" ORDER BY _timestamp ASC`,
    );
  });
});

describe("selectsAll", () => {
  it("tells whole rows from a chosen column list", () => {
    expect(selectsAll(`SELECT * FROM "okta"`)).toBe(true);
    expect(selectsAll(`select t.*, lower(a) as b from "okta" t`)).toBe(true);
    expect(selectsAll(`SELECT _timestamp, a, b FROM "okta"`)).toBe(false);
    expect(selectsAll(`SELECT a, '*' AS star FROM "okta"`)).toBe(false);
    expect(selectsAll(`SELECT a * 2 AS twice FROM "okta"`)).toBe(false);
  });

  it("still sees a column list when a literal holds a backslash", () => {
    expect(selectsAll(STAGING_SQL)).toBe(false);
    expect(isAggregateSql(STAGING_SQL)).toBe(false);
    expect(selectsAll(`SELECT * FROM "sysmon" WHERE cmd LIKE '%\\%'`)).toBe(true);
  });
});

// The analyst's round-4 hunts that fell back to the normalized grid.
const STAGING_SQL = String.raw`SELECT _timestamp, winlog_computer_name AS h, winlog_event_id AS id, winlog_event_data_user AS u, winlog_event_data_image AS img, winlog_event_data_commandline AS cmd, winlog_event_data_targetfilename AS tf FROM "sysmon" WHERE winlog_event_id <> 1 AND winlog_event_id <> 3 AND winlog_event_id <> 22 OR winlog_event_data_commandline LIKE '%\\%' OR winlog_event_data_commandline LIKE '%robocopy%' OR winlog_event_data_commandline LIKE '%xcopy%' OR winlog_event_data_commandline LIKE '%rar%' OR winlog_event_data_commandline LIKE '%7z%' ORDER BY _timestamp DESC`;
const EDR_TF_SQL = `SELECT _timestamp, computername, username, event_simplename, imagefilename, commandline, targetfilename FROM "edr" WHERE targetfilename IS NOT NULL ORDER BY _timestamp DESC`;
const OKTA_PUB_SQL = `SELECT client_ipaddress AS ip, actor_alternateid AS u, client_geographicalcontext_city AS city, eventtype, outcome_result AS o, count(*) AS n, max(_timestamp) AS last FROM "okta" WHERE client_ipaddress NOT LIKE '10.%' AND client_ipaddress NOT IN ('198.51.100.10','198.51.100.20') GROUP BY ip, u, city, eventtype, o ORDER BY n DESC`;

describe("selectedColumns", () => {
  it("names each column a hand-written query projects, aliases included", () => {
    expect(selectedColumns(STAGING_SQL)).toEqual([
      "_timestamp",
      "h",
      "id",
      "u",
      "img",
      "cmd",
      "tf",
    ]);
    expect(selectedColumns(EDR_TF_SQL)).toEqual([
      "_timestamp",
      "computername",
      "username",
      "event_simplename",
      "imagefilename",
      "commandline",
      "targetfilename",
    ]);
    expect(selectedColumns(OKTA_PUB_SQL)).toEqual([
      "ip",
      "u",
      "city",
      "eventtype",
      "o",
      "n",
      "last",
    ]);
  });

  it("reads quoted names, qualified columns and commas inside calls", () => {
    expect(selectedColumns(`select t."Src IP", coalesce(a, 'x,y') AS "Who", b from "s" t`)).toEqual(
      ["Src IP", "Who", "b"],
    );
  });

  it("leaves the naming to the server for star and unnamed expressions", () => {
    expect(selectedColumns(`SELECT * FROM "s"`)).toBeNull();
    expect(selectedColumns(`SELECT a, count(*) FROM "s" GROUP BY a`)).toBeNull();
    expect(selectedColumns(`SELECT 1`)).toBeNull();
  });
});

describe("projectedColumns", () => {
  it("keeps every named column even when no row carried it", () => {
    expect(projectedColumns(EDR_TF_SQL, [])).toHaveLength(7);
    expect(projectedColumns(EDR_TF_SQL, ["_timestamp", "username"])[6]).toBe("targetfilename");
  });

  it("keeps the server's spelling and order of extra columns", () => {
    expect(projectedColumns(`SELECT Host, a FROM "s"`, ["host", "a", "zo_extra"])).toEqual([
      "host",
      "a",
      "zo_extra",
    ]);
    expect(projectedColumns(`SELECT * FROM "s"`, ["b", "a"])).toEqual(["b", "a"]);
  });
});

describe("searchErrorText", () => {
  it("adds the engine's reason to the headline", () => {
    expect(
      searchErrorText({
        code: 20003,
        message: "Search SQL not valid",
        error_detail: "Invalid function 'match_all_x'",
      }),
    ).toBe("Search SQL not valid: Invalid function 'match_all_x'");
  });

  it("does not repeat a detail the message already holds", () => {
    expect(searchErrorText({ message: "boom", error_detail: "boom" })).toBe("boom");
    expect(searchErrorText({ error: "bad", error_detail: "" })).toBe("bad");
    expect(searchErrorText({ error_detail: "only detail" })).toBe("only detail");
    expect(searchErrorText(undefined)).toBe("");
  });
});
