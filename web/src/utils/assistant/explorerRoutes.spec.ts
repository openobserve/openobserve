// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import { b64DecodeUnicode } from "@/utils/formatters";

import { epochMs, explorerOf, explorerTarget, streamTypeOf, whereClauseOf } from "./explorerRoutes";

const FROM = 1_760_000_000_000;
const TO = 1_760_000_900_000;

const sql = {
  language: "sql" as const,
  text: "SELECT * FROM \"default\" WHERE level = 'error' ORDER BY _timestamp",
  stream: "default",
  streamType: "logs",
  from: FROM,
  to: TO,
  org: "acme",
};

describe("explorerTarget", () => {
  it("opens Logs with the exact SQL, stream, absolute range in microseconds and a nonce, never a run flag", () => {
    expect(explorerTarget(sql, "logs", "42")).toEqual({
      name: "logs",
      query: {
        org_identifier: "acme",
        type: "ai_chat_query",
        t: "42",
        stream_type: "logs",
        sql_mode: "true",
        quick_mode: "false",
        show_histogram: "true",
        refresh: "0",
        fn_editor: "false",
        stream: "default",
        query: expect.any(String),
        from: String(FROM * 1000),
        to: String(TO * 1000),
      },
    });
    const route = explorerTarget(sql, "logs", "42");
    expect(b64DecodeUnicode(route.query!.query)).toBe(sql.text);
    expect(route.query).not.toHaveProperty("run");
  });

  it("opens Metrics with the PromQL and a millisecond range", () => {
    const route = explorerTarget(
      { language: "promql", text: "rate(x[5m])", from: FROM, to: TO, org: "acme" },
      "metrics",
      "1",
    );
    expect(route.name).toBe("metricsEditor");
    expect(route.query).toMatchObject({ query_type: "promql", from: String(FROM), to: String(TO) });
    expect(b64DecodeUnicode(route.query!.query)).toBe("rate(x[5m])");
  });

  it("opens Traces with only the WHERE clause, since its editor holds a filter", () => {
    const route = explorerTarget(
      { ...sql, streamType: "traces", text: "SELECT * FROM t WHERE duration > 10 ORDER BY 1" },
      "traces",
      "1",
    );
    expect(route.name).toBe("traces");
    expect(b64DecodeUnicode(route.query!.query)).toBe("duration > 10");
  });

  it("falls back to a 15 minute window when the range is unknown", () => {
    const { from: _f, to: _t, ...noRange } = sql;
    expect(explorerTarget(noRange, "logs", "1").query).toMatchObject({ period: "15m" });
  });
});

describe("explorerOf / epochMs", () => {
  it("routes PromQL and metrics streams to Metrics and traces streams to Traces", () => {
    expect(explorerOf({ language: "promql" })).toBe("metrics");
    expect(explorerOf({ language: "sql", streamType: "traces" })).toBe("traces");
    expect(explorerOf({ language: "sql" })).toBe("logs");
  });

  it("reads microseconds and milliseconds, and nothing else", () => {
    expect(epochMs(FROM * 1000)).toBe(FROM);
    expect(epochMs(String(FROM))).toBe(FROM);
    expect(epochMs("nope")).toBeNull();
    expect(epochMs(-1)).toBeNull();
  });
});

describe("whereClauseOf / streamTypeOf", () => {
  it("ends the filter at a top-level clause, never at a keyword inside a literal or subquery", () => {
    expect(whereClauseOf("SELECT * FROM t WHERE msg = 'rate limit hit'")).toBe(
      "msg = 'rate limit hit'",
    );
    expect(
      whereClauseOf(
        "SELECT * FROM t WHERE id IN (SELECT id FROM u WHERE a = 1 GROUP BY id) ORDER BY 1",
      ),
    ).toBe("id IN (SELECT id FROM u WHERE a = 1 GROUP BY id)");
    expect(whereClauseOf("SELECT * FROM t WHERE a = 'it''s' LIMIT 5")).toBe("a = 'it''s'");
  });

  it("reads past comments, ends at a clause right after a parenthesis, and refuses a UNION", () => {
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 /* group by x */ LIMIT 3")).toBe("a = 1");
    expect(whereClauseOf("SELECT * FROM t WHERE (a=1)ORDER BY ts")).toBe("(a=1)");
    expect(
      whereClauseOf("SELECT a FROM t WHERE a = 1 UNION SELECT a FROM u WHERE b = 2"),
    ).toBeNull();
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 /* open")).toBeNull();
  });

  it("drops comments from the filter, at the end and in the middle, and keeps literals as written", () => {
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 -- errors only\nORDER BY ts")).toBe("a = 1");
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 -- trailing")).toBe("a = 1");
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 -- order by\nAND b = 2")).toBe(
      "a = 1 AND b = 2",
    );
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 /* note */ AND b = 2")).toBe(
      "a = 1 AND b = 2",
    );
    expect(whereClauseOf("SELECT * FROM t WHERE a = 1 /* trailing */")).toBe("a = 1");
    expect(whereClauseOf("SELECT * FROM t WHERE msg = '-- not  /* a */ comment' -- x")).toBe(
      "msg = '-- not  /* a */ comment'",
    );
  });

  it("carries no filter when quotes or parentheses do not balance, or there is no WHERE", () => {
    expect(whereClauseOf("SELECT * FROM t WHERE msg = 'open")).toBeNull();
    expect(whereClauseOf("SELECT * FROM t WHERE (a = 1")).toBeNull();
    expect(whereClauseOf("SELECT * FROM t")).toBeNull();
  });

  it("keeps only logs, metrics or traces as a stream type, so no value adds URL parameters", () => {
    expect(streamTypeOf("traces")).toBe("traces");
    expect(streamTypeOf("logs&search_type=dashboards#")).toBeUndefined();
    expect(streamTypeOf(7)).toBeUndefined();
    const route = explorerTarget({ ...sql, streamType: "logs&use_cache=false" }, "logs", "1");
    expect(route.query!.stream_type).toBe("logs");
  });
});
