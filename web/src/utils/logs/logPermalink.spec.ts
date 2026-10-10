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

import { describe, it, expect } from "vitest";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  LOG_LINK_I18N,
  RESOLVE_SIZE,
  buildLineLinkQuery,
  buildResolveRequest,
  canonicalRecordJson,
  decideCopyLink,
  fingerprintRecord,
  isResolveComplete,
  isWideStream,
  lineLinkEligibility,
  lineStreamOf,
  parsePermalinkQuery,
  permalinkOutcome,
  readRowTimestamp,
  type CopyLinkInput,
  type LineLinkEligibilityInput,
  type LogRow,
  type ParsedPermalink,
  type ResolveResult,
} from "./logPermalink";

const parser = new Parser();
const TS = 1_759_700_000_123_456;
const ID = "7385610212340123456";

const ast = (sql: string): unknown => parser.astify(sql);

const fnv1a64Base36 = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(36);
};

const ok = (hits: unknown[], extra: Record<string, unknown> = {}): ResolveResult => ({
  status: 200,
  data: { hits, is_partial: false, ...extra },
});

const valid = (link: {
  stream: string;
  ts: number;
  id?: string;
  fp?: string;
}): Extract<ParsedPermalink, { kind: "valid" }> => ({
  kind: "valid",
  link,
});

const eligibility = (overrides: Partial<LineLinkEligibilityInput> = {}) =>
  lineLinkEligibility({
    viewMode: "logs",
    functionActive: false,
    sqlMode: false,
    parsedSql: null,
    timestampColumn: "_timestamp",
    streamType: "logs",
    row: { _timestamp: TS, message: "hello" },
    ...overrides,
  });

const sqlEligibility = (sql: string, row: LogRow = { _timestamp: TS }) =>
  eligibility({ sqlMode: true, parsedSql: ast(sql), row });

const copyInput = (overrides: Partial<CopyLinkInput> = {}): CopyLinkInput => ({
  stream: "app_logs",
  ts: TS,
  row: { _timestamp: TS, host: "h1", message: "boom" },
  timestampColumn: "_timestamp",
  trustworthy: "all",
  wide: false,
  resolve: ok([]),
  allFieldsName: "_all",
  ...overrides,
});

describe("canonicalRecordJson", () => {
  it("sorts keys so field order does not matter", () => {
    expect(canonicalRecordJson({ b: "2", a: "1" })).toBe(canonicalRecordJson({ a: "1", b: "2" }));
    expect(canonicalRecordJson({ b: "2", a: "1" })).toBe('{"a":"1","b":"2"}');
  });

  it("drops null and empty values but keeps zero and false", () => {
    expect(canonicalRecordJson({ a: null, b: "", c: 0, d: false, e: undefined })).toBe(
      '{"c":"0","d":"false"}',
    );
  });

  it("excludes internal columns, the all-fields column and _stream_name", () => {
    const record = {
      _timestamp: TS,
      _o2_ingest_ts: TS + 5,
      _o2_id: ID,
      _original: "{}",
      _all_values: "x",
      _all: "everything",
      _stream_name: "app_logs",
      message: "hi",
    };
    expect(canonicalRecordJson(record, "_all")).toBe('{"message":"hi"}');
    expect(canonicalRecordJson(record)).toBe('{"_all":"everything","message":"hi"}');
  });

  it("keeps a JSON-parsed __proto__ field as data at every level", () => {
    const first = JSON.parse('{"__proto__":"first","message":"m","obj":{"__proto__":{"k":1}}}');
    expect(canonicalRecordJson(first)).toBe(
      '{"__proto__":"first","message":"m","obj":{"__proto__":{"k":"1"}}}',
    );
  });

  it("canonicalises nested values with sorted keys and string scalars", () => {
    expect(canonicalRecordJson({ obj: { z: 1, a: null, m: [1, null, "x"] } })).toBe(
      '{"obj":{"m":["1",null,"x"],"z":"1"}}',
    );
  });
});

describe("fingerprintRecord", () => {
  it("is 64-bit FNV-1a over the canonical JSON in base36", () => {
    expect(fnv1a64Base36("a")).toBe(BigInt("0xaf63dc4c8601ec8c").toString(36));
    const record = { message: "hello", code: 5 };
    expect(fingerprintRecord(record)).toBe(fnv1a64Base36(canonicalRecordJson(record)));
    expect(fingerprintRecord(record)).toMatch(/^[0-9a-z]{1,14}$/);
  });

  it("is stable across type widening and key order", () => {
    expect(fingerprintRecord({ code: 5, msg: "a" })).toBe(
      fingerprintRecord({ msg: "a", code: "5" }),
    );
  });

  it("ignores internal columns and changes with content", () => {
    const base = { message: "a", _timestamp: TS };
    expect(fingerprintRecord(base)).toBe(
      fingerprintRecord({ ...base, _timestamp: TS + 1, _o2_id: ID }),
    );
    expect(fingerprintRecord(base)).not.toBe(fingerprintRecord({ ...base, message: "b" }));
  });
});

describe("parsePermalinkQuery", () => {
  it("treats old links and bookmarks without log_* as no permalink", () => {
    expect(parsePermalinkQuery({ stream: "app_logs", from: "1", to: "2", refresh: "0" })).toEqual({
      kind: "none",
    });
    expect(parsePermalinkQuery({ log_ts: undefined })).toEqual({ kind: "none" });
  });

  it("parses id, fingerprint and timestamp-only links", () => {
    expect(parsePermalinkQuery({ log_stream: "app_logs", log_ts: String(TS), log_id: ID })).toEqual(
      valid({ stream: "app_logs", ts: TS, id: ID }),
    );
    expect(parsePermalinkQuery({ log_stream: "app_logs", log_ts: "0", log_fp: "abc123" })).toEqual(
      valid({ stream: "app_logs", ts: 0, fp: "abc123" }),
    );
    expect(parsePermalinkQuery({ log_stream: "app_logs", log_ts: String(TS) })).toEqual(
      valid({ stream: "app_logs", ts: TS }),
    );
  });

  it.each([
    ["non-numeric ts", { log_stream: "s", log_ts: "abc" }],
    ["negative ts", { log_stream: "s", log_ts: "-1" }],
    ["20-digit ts", { log_stream: "s", log_ts: "12345678901234567890" }],
    ["ts above MAX_SAFE_INTEGER", { log_stream: "s", log_ts: "9007199254740992" }],
    ["ts as array", { log_stream: "s", log_ts: ["1", "2"] }],
    ["ts without value", { log_stream: "s", log_ts: null }],
    ["missing ts", { log_stream: "s", log_id: ID }],
    ["missing stream", { log_ts: String(TS) }],
    ["empty stream", { log_stream: "", log_ts: String(TS) }],
    ["257-char stream", { log_stream: "a".repeat(257), log_ts: String(TS) }],
    ["stream with newline", { log_stream: "a\nb", log_ts: String(TS) }],
    ["stream with NUL", { log_stream: "a\u0000b", log_ts: String(TS) }],
    ["stream with C1 control", { log_stream: "a\u0085b", log_ts: String(TS) }],
    ["id with SQL", { log_stream: "s", log_ts: "1", log_id: "1 OR 1=1" }],
    ["quoted id", { log_stream: "s", log_ts: "1", log_id: "'1'" }],
    ["21-digit id", { log_stream: "s", log_ts: "1", log_id: "1".repeat(21) }],
    ["uppercase fp", { log_stream: "s", log_ts: "1", log_fp: "ABC" }],
    ["15-char fp", { log_stream: "s", log_ts: "1", log_fp: "a".repeat(15) }],
    ["empty fp", { log_stream: "s", log_ts: "1", log_fp: "" }],
    ["both id and fp", { log_stream: "s", log_ts: "1", log_id: "1", log_fp: "a" }],
  ])("rejects %s as invalid", (_label, query) => {
    expect(parsePermalinkQuery(query as Record<string, unknown>)).toEqual({ kind: "invalid" });
  });

  it("accepts boundary values", () => {
    expect(parsePermalinkQuery({ log_stream: "s", log_ts: "9007199254740991" })).toEqual(
      valid({ stream: "s", ts: Number.MAX_SAFE_INTEGER }),
    );
    expect(
      parsePermalinkQuery({ log_stream: "a".repeat(256), log_ts: "1", log_id: "-42" }),
    ).toEqual(valid({ stream: "a".repeat(256), ts: 1, id: "-42" }));
  });

  it("keeps adversarial but control-free stream names for quoting later", () => {
    const stream = 'x"; DROP TABLE t; --';
    expect(parsePermalinkQuery({ log_stream: stream, log_ts: "1" })).toEqual(
      valid({ stream, ts: 1 }),
    );
  });
});

describe("buildLineLinkQuery", () => {
  const share = {
    stream_type: "logs",
    stream: "app_logs",
    from: TS - 1000,
    to: TS + 1000,
    refresh: 10,
    sql_mode: false,
    query: "bGV2ZWw9J2Vycm9yJw==",
    org_identifier: "default",
    quick_mode: true,
    columns: "WyJtZXNzYWdlIl0=",
    rows: 25,
    page: 3,
    cmp_sel: "x",
    cmp_mode: "y",
    period: "15m",
    log_stream: "stale",
    log_fp: "stale",
  };

  it("adds log_* and refresh=0 and never writes page, cmp_* or period", () => {
    const query = buildLineLinkQuery(share, { stream: "app_logs", ts: TS, id: ID });
    expect(query).toEqual({
      stream_type: "logs",
      stream: "app_logs",
      from: TS - 1000,
      to: TS + 1000,
      refresh: 0,
      sql_mode: false,
      query: "bGV2ZWw9J2Vycm9yJw==",
      org_identifier: "default",
      quick_mode: true,
      columns: "WyJtZXNzYWdlIl0=",
      rows: 25,
      log_stream: "app_logs",
      log_ts: String(TS),
      log_id: ID,
    });
  });

  it("writes log_fp for fingerprint links and nothing for timestamp-only", () => {
    expect(buildLineLinkQuery(share, { stream: "s", ts: TS, fp: "abc" })).toMatchObject({
      log_fp: "abc",
    });
    const tsOnly = buildLineLinkQuery(share, { stream: "s", ts: TS });
    expect(tsOnly).not.toHaveProperty("log_id");
    expect(tsOnly).not.toHaveProperty("log_fp");
  });

  it.each([
    ["inside the window", TS - 10, TS + 10, TS - 10, TS + 10],
    ["before from", TS + 10, TS + 20, TS, TS + 20],
    ["equal to the exclusive to", TS - 10, TS, TS - 10, TS + 1],
    ["after to", TS - 20, TS - 10, TS - 20, TS + 1],
    ["string bounds from the URL", String(TS + 5), String(TS + 9), TS, TS + 9],
  ])("widens from/to so from <= log_ts < to when %s", (_label, from, to, wantFrom, wantTo) => {
    const query = buildLineLinkQuery({ from, to }, { stream: "s", ts: TS });
    expect(query?.from).toBe(wantFrom);
    expect(query?.to).toBe(wantTo);
    expect(Number(query?.from)).toBeLessThanOrEqual(TS);
    expect(Number(query?.to)).toBeGreaterThan(TS);
  });

  it("uses [log_ts, log_ts + 1) when the share query has no bounds", () => {
    expect(buildLineLinkQuery({ period: "15m" }, { stream: "s", ts: TS })).toMatchObject({
      from: TS,
      to: TS + 1,
    });
  });

  it("round-trips through parsePermalinkQuery", () => {
    for (const link of [
      { stream: "app_logs", ts: TS, id: ID },
      { stream: "my-stream.v2", ts: 0, fp: fingerprintRecord({ a: 1 }) },
      { stream: 'we"ird name', ts: TS },
    ]) {
      const query = buildLineLinkQuery(share, link);
      expect(query).not.toBeNull();
      expect(parsePermalinkQuery(query as Record<string, unknown>)).toEqual(valid(link));
    }
  });

  it("copies a __proto__ query param as data without touching the prototype", () => {
    const query = buildLineLinkQuery(JSON.parse('{"__proto__":{"polluted":true},"stream":"s"}'), {
      stream: "s",
      ts: TS,
    });
    expect(Object.getPrototypeOf(query)).toBe(Object.prototype);
    expect(Object.keys(query ?? {})).toContain("__proto__");
    expect((query as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("returns null for a link that would not parse back", () => {
    expect(buildLineLinkQuery(share, { stream: "", ts: TS })).toBeNull();
    expect(buildLineLinkQuery(share, { stream: "s", ts: 1.5 })).toBeNull();
    expect(buildLineLinkQuery(share, { stream: "s", ts: TS, id: "abc" })).toBeNull();
    expect(buildLineLinkQuery(share, { stream: "s", ts: TS, fp: "NOPE" })).toBeNull();
    expect(buildLineLinkQuery(share, { stream: "s", ts: TS, id: "1", fp: "a" })).toBeNull();
  });

  it("writes no log content into the URL", () => {
    const row = { _timestamp: TS, message: "secret-token-value" };
    const decision = decideCopyLink(copyInput({ row, resolve: ok([row]) }));
    const query = buildLineLinkQuery({ from: TS, to: TS + 1 }, decision.link);
    expect(JSON.stringify(query)).not.toContain("secret-token-value");
  });
});

describe("lineStreamOf and readRowTimestamp", () => {
  it("takes the hit's _stream_name in multi-stream, else the first selected stream", () => {
    expect(lineStreamOf({ _stream_name: "b" }, ["a", "b"])).toBe("b");
    expect(lineStreamOf({}, ["a"])).toBe("a");
    expect(lineStreamOf({ _stream_name: "" }, [])).toBeNull();
  });

  it("reads safe integer timestamps from the configured column only", () => {
    expect(readRowTimestamp({ _timestamp: TS }, "_timestamp")).toBe(TS);
    expect(readRowTimestamp({ event_ts: String(TS) }, "event_ts")).toBe(TS);
    expect(readRowTimestamp({ _timestamp: TS }, "event_ts")).toBeNull();
    expect(readRowTimestamp({ _timestamp: 1.5 }, "_timestamp")).toBeNull();
    expect(readRowTimestamp({ _timestamp: -1 }, "_timestamp")).toBeNull();
    expect(readRowTimestamp({ _timestamp: "2026-10-06" }, "_timestamp")).toBeNull();
  });
});

describe("lineLinkEligibility", () => {
  const NOT_SINGLE = { kind: "disabled", reasonKey: LOG_LINK_I18N.disabledNotSingleLines };
  const REWRITE = { kind: "disabled", reasonKey: LOG_LINK_I18N.disabledTimestampRewrite };

  it("is enabled for a plain row in non-SQL mode", () => {
    expect(eligibility()).toEqual({ kind: "enabled" });
  });

  it("is hidden in Visualize, Build and Patterns but not in Drill down", () => {
    expect(eligibility({ viewMode: "visualize" })).toEqual({ kind: "hidden" });
    expect(eligibility({ viewMode: "build" })).toEqual({ kind: "hidden" });
    expect(eligibility({ viewMode: "patterns" })).toEqual({ kind: "hidden" });
    expect(eligibility({ viewMode: "drilldown" })).toEqual({ kind: "enabled" });
  });

  it("disables with the function reason first while a VRL function is active", () => {
    expect(
      eligibility({
        functionActive: true,
        sqlMode: true,
        parsedSql: ast("SELECT count(*) AS _timestamp FROM t GROUP BY host"),
        streamType: "enrichment_tables",
        row: {},
      }),
    ).toEqual({ kind: "disabled", reasonKey: LOG_LINK_I18N.disabledFunction });
  });

  it.each([
    "SELECT * FROM \"default\" WHERE level = 'error'",
    "SELECT _timestamp, host, 'B' AS message FROM logs",
    "SELECT _timestamp AS _timestamp, _o2_id FROM logs",
    "SELECT logs._timestamp, msg FROM logs ORDER BY _timestamp DESC LIMIT 10",
    "SELECT _timestamp, upper(msg) AS msg FROM logs",
    "SELECT _timestamp, count(*) OVER () AS total FROM logs",
    "SELECT _TIMESTAMP AS _timestamp, msg FROM logs",
    "SELECT _TIMESTAMP, _O2_ID, msg FROM logs",
  ])("enables single-stream row query: %s", (sql) => {
    expect(sqlEligibility(sql)).toEqual({ kind: "enabled" });
  });

  it.each([
    "SELECT _timestamp + 1 AS _timestamp FROM logs",
    "SELECT _timestamp AS ts, msg FROM logs",
    "SELECT *, 'x' AS _o2_id FROM logs",
    "SELECT _o2_id AS id, _timestamp FROM logs",
    "SELECT count(*) AS _timestamp FROM logs GROUP BY host",
    "SELECT _timestamp + 1 AS _TIMESTAMP, message FROM logs",
    'SELECT _timestamp + 1 AS "_TIMESTAMP", message FROM logs',
    "SELECT *, 'x' AS _O2_ID FROM logs",
    "SELECT _timestamp, message AS _O2_Id FROM logs",
    'SELECT "_TIMESTAMP" AS _timestamp FROM logs',
    "SELECT _TIMESTAMP AS ts, msg FROM logs",
  ])("disables a query that rewrites the timestamp or id: %s", (sql) => {
    expect(sqlEligibility(sql)).toEqual(REWRITE);
  });

  it("checks a custom timestamp column for aliasing", () => {
    expect(
      eligibility({
        sqlMode: true,
        timestampColumn: "event_ts",
        parsedSql: ast("SELECT event_ts + 1 AS event_ts FROM logs"),
        row: { event_ts: TS },
      }),
    ).toEqual(REWRITE);
  });

  it.each([
    "SELECT count(*) FROM logs",
    "SELECT host FROM logs GROUP BY host",
    "SELECT approx_distinct(host) FROM logs",
    "SELECT DISTINCT host FROM logs",
    "SELECT a FROM t1 JOIN t2 ON t1.x = t2.x",
    "SELECT a FROM t1, t2",
    "SELECT a FROM t1 UNION SELECT a FROM t2",
    "SELECT a FROM (SELECT a FROM t1)",
    "SELECT a FROM t WHERE b IN (SELECT b FROM u)",
    "WITH x AS (SELECT * FROM t) SELECT * FROM x",
    "SELECT a FROM t1; SELECT b FROM t2",
  ])("disables a query whose rows are not single lines: %s", (sql) => {
    expect(sqlEligibility(sql)).toEqual(NOT_SINGLE);
  });

  it("fails closed when the SQL could not be parsed", () => {
    const unparsed = {
      columns: [],
      from: [],
      orderby: null,
      limit: null,
      groupby: null,
      where: null,
    };
    expect(eligibility({ sqlMode: true, parsedSql: unparsed })).toEqual(NOT_SINGLE);
    expect(eligibility({ sqlMode: true, parsedSql: null })).toEqual(NOT_SINGLE);
  });

  it("disables a row without a timestamp, then enrichment tables", () => {
    expect(eligibility({ row: { message: "x" } })).toEqual({
      kind: "disabled",
      reasonKey: LOG_LINK_I18N.disabledNoTimestamp,
    });
    expect(sqlEligibility("SELECT host FROM logs", { host: "h" })).toEqual({
      kind: "disabled",
      reasonKey: LOG_LINK_I18N.disabledNoTimestamp,
    });
    expect(eligibility({ streamType: "enrichment_tables" })).toEqual({
      kind: "disabled",
      reasonKey: LOG_LINK_I18N.disabledEnrichmentTable,
    });
  });
});

describe("isWideStream", () => {
  it("defaults to 500 fields and force on when config is absent", () => {
    expect(isWideStream({ schemaFieldCount: 501 })).toBe(true);
    expect(isWideStream({ schemaFieldCount: 500 })).toBe(false);
    expect(
      isWideStream({
        schemaFieldCount: 501,
        quickModeNumFields: null,
        quickModeForceEnabled: null,
      }),
    ).toBe(true);
  });

  it("follows the configured threshold and force flag", () => {
    expect(
      isWideStream({ schemaFieldCount: 150, quickModeNumFields: 100, quickModeForceEnabled: true }),
    ).toBe(true);
    expect(
      isWideStream({
        schemaFieldCount: 150,
        quickModeNumFields: 100,
        quickModeForceEnabled: false,
      }),
    ).toBe(false);
    expect(isWideStream({ schemaFieldCount: 90, quickModeNumFields: 100 })).toBe(false);
  });
});

describe("buildResolveRequest", () => {
  it("builds a one-microsecond, uncached, non-quick 'other' search without VRL", () => {
    const request = buildResolveRequest({ orgIdentifier: "default", stream: "app_logs", ts: TS });
    expect(request).toEqual({
      searchType: "other",
      useCache: false,
      options: {
        org_identifier: "default",
        page_type: "logs",
        query: {
          query: {
            sql: "SELECT * FROM app_logs",
            start_time: TS,
            end_time: TS + 1,
            from: 0,
            size: RESOLVE_SIZE,
            quick_mode: false,
          },
        },
      },
    });
    expect(RESOLVE_SIZE).toBe(5000);
    expect(JSON.stringify(request)).not.toContain("query_fn");
  });

  it("filters on _o2_id as an escaped string literal", () => {
    expect(
      buildResolveRequest({ orgIdentifier: "o", stream: "s", ts: TS, id: ID }).options.query.query
        .sql,
    ).toBe(`SELECT * FROM s WHERE _o2_id = '${ID}'`);
    expect(
      buildResolveRequest({ orgIdentifier: "o", stream: "s", ts: TS, id: "1' OR '1'='1" }).options
        .query.query.sql,
    ).toBe("SELECT * FROM s WHERE _o2_id = '1'' OR ''1''=''1'");
  });

  it.each([
    ["my-stream", 'SELECT * FROM "my-stream"'],
    ['a"b; DROP TABLE t; --', 'SELECT * FROM "a""b; DROP TABLE t; --"'],
    ["Ünïcode name", 'SELECT * FROM "Ünïcode name"'],
  ])("quotes adversarial stream %s", (stream, sql) => {
    expect(
      buildResolveRequest({ orgIdentifier: "o", stream, ts: TS }).options.query.query.sql,
    ).toBe(sql);
  });

  it("carries the link's regions and clusters only when set", () => {
    const withRegions = buildResolveRequest({
      orgIdentifier: "o",
      stream: "s",
      ts: TS,
      regions: ["us"],
      clusters: ["c1", "c2"],
    });
    expect(withRegions.options.query.regions).toEqual(["us"]);
    expect(withRegions.options.query.clusters).toEqual(["c1", "c2"]);
    const without = buildResolveRequest({ orgIdentifier: "o", stream: "s", ts: TS, regions: [] });
    expect(without.options.query).not.toHaveProperty("regions");
    expect(without.options.query).not.toHaveProperty("clusters");
  });

  it("builds the open-time request from a parsed URL", () => {
    const parsed = parsePermalinkQuery({ log_stream: "app_logs", log_ts: String(TS), log_id: ID });
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    const request = buildResolveRequest({ orgIdentifier: "o", ...parsed.link });
    expect(request.options.query.query.sql).toBe(`SELECT * FROM app_logs WHERE _o2_id = '${ID}'`);
    expect(request.options.query.query.start_time).toBe(TS);
    expect(request.options.query.query.end_time).toBe(TS + 1);
  });
});

describe("isResolveComplete", () => {
  it("is complete for a 200, non-partial response under the size cap", () => {
    expect(isResolveComplete(ok([{ a: 1 }]))).toBe(true);
    expect(isResolveComplete(ok([], { function_error: [] }))).toBe(true);
    expect(isResolveComplete(ok([], { function_error: "" }))).toBe(true);
  });

  it.each([
    ["partial flag", ok([{ a: 1 }], { is_partial: true })],
    ["function_error array", ok([{ a: 1 }], { function_error: ["bad vrl"] })],
    ["function_error string", ok([{ a: 1 }], { function_error: "bad vrl" })],
    ["hits at the size cap", ok(new Array(RESOLVE_SIZE).fill({ a: 1 }))],
    ["non-200", { status: 500, data: { hits: [] } }],
    ["no response", { status: null }],
    ["missing hits", { status: 200, data: { is_partial: false } }],
  ])("is incomplete with %s", (_label, result) => {
    expect(isResolveComplete(result as ResolveResult)).toBe(false);
  });

  it("honours a custom size", () => {
    expect(isResolveComplete(ok([{ a: 1 }, { a: 2 }]), 2)).toBe(false);
    expect(isResolveComplete(ok([{ a: 1 }]), 2)).toBe(true);
  });
});

describe("decideCopyLink", () => {
  const NOT_UNIQUE = LOG_LINK_I18N.toastNotUnique;

  it("links by _o2_id when one candidate has the row's id", () => {
    const row = { _timestamp: TS, _o2_id: ID, message: "boom" };
    const other = { _timestamp: TS, _o2_id: "1", message: "boom" };
    expect(decideCopyLink(copyInput({ row, resolve: ok([other, row]) }))).toEqual({
      kind: "exact",
      link: { stream: "app_logs", ts: TS, id: ID },
    });
  });

  it("links by fingerprint of the candidate as the resolve returns it", () => {
    const visible = { _timestamp: TS, host: "h1", message: "boom" };
    const stored = { _timestamp: TS, host: "h1", message: "boom", extra: "only-in-full-record" };
    const decision = decideCopyLink(
      copyInput({
        row: visible,
        resolve: ok([{ _timestamp: TS, host: "h2", message: "boom" }, stored]),
      }),
    );
    expect(decision).toEqual({
      kind: "exact",
      link: { stream: "app_logs", ts: TS, fp: fingerprintRecord(stored, "_all") },
    });
  });

  it("matches only on trustworthy fields, ignoring an expression alias (J-C24)", () => {
    const visible = { _timestamp: TS, host: "h1", message: "B" };
    const stored = { _timestamp: TS, host: "h1", message: "real message" };
    const resolve = ok([stored, { _timestamp: TS, host: "h2", message: "other" }]);
    expect(
      decideCopyLink(copyInput({ row: visible, trustworthy: ["_timestamp", "host"], resolve })),
    ).toEqual({
      kind: "exact",
      link: { stream: "app_logs", ts: TS, fp: fingerprintRecord(stored, "_all") },
    });
    expect(decideCopyLink(copyInput({ row: visible, trustworthy: "all", resolve }))).toEqual({
      kind: "timestamp",
      link: { stream: "app_logs", ts: TS },
      toastKey: NOT_UNIQUE,
    });
  });

  it("compares widened types and ignores _stream_name from a multi-stream hit", () => {
    const visible = { _timestamp: TS, code: 5, _stream_name: "app_logs" };
    const stored = { _timestamp: TS, code: "5" };
    expect(decideCopyLink(copyInput({ row: visible, resolve: ok([stored]) })).kind).toBe("exact");
  });

  it("treats identical duplicates as one match and distinct duplicates as none", () => {
    const row = { _timestamp: TS, message: "dup" };
    expect(decideCopyLink(copyInput({ row, resolve: ok([{ ...row }, { ...row }]) })).kind).toBe(
      "exact",
    );
    expect(
      decideCopyLink(
        copyInput({
          row: { _timestamp: TS },
          trustworthy: ["_timestamp"],
          resolve: ok([
            { _timestamp: TS, message: "a" },
            { _timestamp: TS, message: "b" },
          ]),
        }),
      ),
    ).toEqual({ kind: "timestamp", link: { stream: "app_logs", ts: TS }, toastKey: NOT_UNIQUE });
  });

  it("falls back to the timestamp when nothing matches or the resolve is incomplete", () => {
    const row = { _timestamp: TS, message: "boom" };
    for (const resolve of [
      ok([{ _timestamp: TS, message: "other" }]),
      ok([row], { is_partial: true }),
      ok([row], { function_error: ["x"] }),
      ok(new Array(RESOLVE_SIZE).fill(row)),
      { status: 500, data: {} },
      null,
    ]) {
      expect(decideCopyLink(copyInput({ row, resolve }))).toEqual({
        kind: "timestamp",
        link: { stream: "app_logs", ts: TS },
        toastKey: NOT_UNIQUE,
      });
    }
  });

  it("gives a timestamp-only link with the wide-stream toast on a wide stream without _o2_id", () => {
    const row = { _timestamp: TS, message: "boom" };
    expect(decideCopyLink(copyInput({ row, wide: true, resolve: ok([row]) }))).toEqual({
      kind: "timestamp",
      link: { stream: "app_logs", ts: TS },
      toastKey: LOG_LINK_I18N.toastWideStream,
    });
  });

  it("stays exact on a wide stream with _o2_id", () => {
    const row = { _timestamp: TS, _o2_id: ID, message: "boom" };
    expect(decideCopyLink(copyInput({ row, wide: true, resolve: ok([row]) }))).toEqual({
      kind: "exact",
      link: { stream: "app_logs", ts: TS, id: ID },
    });
  });
});

describe("permalinkOutcome", () => {
  const stream = "app_logs";
  const idLink = valid({ stream, ts: TS, id: ID });
  const tsLink = valid({ stream, ts: TS });
  const record = { _timestamp: TS, _o2_id: ID, message: "boom" };

  it("row 1: invalid params win over any response", () => {
    expect(
      permalinkOutcome({ parsed: { kind: "invalid" }, result: { status: 403 } }),
    ).toMatchObject({
      state: "invalid",
      severity: "warning",
      messageKey: LOG_LINK_I18N.bannerInvalid,
      record: null,
    });
  });

  it("row 2: 403 is denied with the stream name and no record", () => {
    const outcome = permalinkOutcome({
      parsed: idLink,
      result: { status: 403, data: { code: 20002, hits: [record] } },
    });
    expect(outcome).toEqual({
      state: "denied",
      severity: "error",
      messageKey: LOG_LINK_I18N.bannerDenied,
      messageParams: { stream },
      pluralCount: null,
      actionKey: null,
      record: null,
    });
  });

  it("row 3: error code 20002 is stream_missing", () => {
    for (const status of [400, 404, 500]) {
      expect(
        permalinkOutcome({ parsed: idLink, result: { status, data: { code: 20002 } } }),
      ).toMatchObject({
        state: "stream_missing",
        messageKey: LOG_LINK_I18N.bannerStreamMissing,
        messageParams: { stream },
      });
    }
  });

  it("row 4: any other failure is error with Retry", () => {
    for (const result of [
      { status: 500, data: { code: 20009 } },
      { status: null },
      null,
      { status: 200, data: { is_partial: false } },
      { status: 200, data: "not json" },
    ]) {
      expect(permalinkOutcome({ parsed: idLink, result })).toMatchObject({
        state: "error",
        severity: "error",
        messageKey: LOG_LINK_I18N.bannerError,
        actionKey: LOG_LINK_I18N.actionRetry,
        record: null,
      });
    }
  });

  it("row 5: an incomplete response is incomplete even with an identity match (J-C12)", () => {
    for (const result of [
      ok([record], { is_partial: true }),
      ok([record], { function_error: ["vrl"] }),
      ok(new Array(RESOLVE_SIZE).fill(record)),
    ]) {
      expect(permalinkOutcome({ parsed: idLink, result })).toMatchObject({
        state: "incomplete",
        severity: "warning",
        messageKey: LOG_LINK_I18N.bannerIncomplete,
        actionKey: LOG_LINK_I18N.actionShowLines,
        record: null,
      });
    }
  });

  it("row 6: a complete empty response is gone, with retention when known", () => {
    expect(permalinkOutcome({ parsed: idLink, result: ok([]) })).toMatchObject({
      state: "gone",
      messageKey: LOG_LINK_I18N.bannerGone,
      pluralCount: null,
    });
    expect(permalinkOutcome({ parsed: tsLink, result: ok([]), retentionDays: 30 })).toMatchObject({
      state: "gone",
      messageKey: LOG_LINK_I18N.bannerGoneRetention,
      messageParams: { days: 30 },
      pluralCount: 30,
    });
  });

  it("row 7: found for one distinct identity match, lowest index among identical copies", () => {
    const first = { ...record };
    const outcome = permalinkOutcome({ parsed: idLink, result: ok([first, { ...record }]) });
    expect(outcome).toMatchObject({
      state: "found",
      severity: "info",
      messageKey: LOG_LINK_I18N.bannerFound,
      actionKey: LOG_LINK_I18N.actionShowInContext,
    });
    expect(outcome.record).toBe(first);
  });

  it("row 7: a fingerprint link finds its row among other lines at the timestamp", () => {
    const target = { _timestamp: TS, message: "right", code: 5 };
    const fp = fingerprintRecord(target, "_all");
    const outcome = permalinkOutcome({
      parsed: valid({ stream, ts: TS, fp }),
      result: ok([
        { _timestamp: TS, message: "wrong" },
        { ...target, code: "5" },
      ]),
      allFieldsName: "_all",
    });
    expect(outcome.state).toBe("found");
    expect(outcome.record).toMatchObject({ message: "right" });
  });

  it("row 7/8: a timestamp-only link is found with one row and ambiguous with more", () => {
    expect(permalinkOutcome({ parsed: tsLink, result: ok([record]) })).toMatchObject({
      state: "found",
      record,
    });
    expect(permalinkOutcome({ parsed: tsLink, result: ok([record, { ...record }]) })).toMatchObject(
      {
        state: "ambiguous",
        messageKey: LOG_LINK_I18N.bannerAmbiguous,
        messageParams: { count: 2 },
        actionKey: LOG_LINK_I18N.actionShowLines,
        record: null,
      },
    );
  });

  it("row 8: distinct identity matches (equal _o2_id from two clusters) are ambiguous", () => {
    const outcome = permalinkOutcome({
      parsed: idLink,
      result: ok([record, { ...record, message: "from another cluster" }]),
    });
    expect(outcome).toMatchObject({
      state: "ambiguous",
      messageKey: LOG_LINK_I18N.bannerAmbiguous,
      messageParams: { count: 2 },
      record: null,
    });
  });

  it("row 8: a fingerprint link whose __proto__ field changed is not found", () => {
    const copied = JSON.parse(`{"_timestamp":${TS},"__proto__":"first","message":"m"}`);
    const changed = JSON.parse(`{"_timestamp":${TS},"__proto__":"second","message":"m"}`);
    const fp = fingerprintRecord(copied, "_all");
    expect(fp).not.toBe(fingerprintRecord(changed, "_all"));
    expect(
      permalinkOutcome({
        parsed: valid({ stream, ts: TS, fp }),
        result: ok([changed]),
        allFieldsName: "_all",
      }),
    ).toMatchObject({ state: "ambiguous", messageKey: LOG_LINK_I18N.bannerChanged, record: null });
  });

  it("row 8: a fingerprint link whose line changed (UDS subset) says the line may have changed (J-C16)", () => {
    const copied = { _timestamp: TS, message: "boom", user: "alice" };
    const fp = fingerprintRecord(copied, "_all");
    const udsSubset = { _timestamp: TS, message: "boom" };
    expect(
      permalinkOutcome({
        parsed: valid({ stream, ts: TS, fp }),
        result: ok([udsSubset]),
        allFieldsName: "_all",
      }),
    ).toMatchObject({ state: "ambiguous", messageKey: LOG_LINK_I18N.bannerChanged, record: null });
  });

  it("an _o2_id link still opens the row under a UDS subset or redaction", () => {
    const current = { _timestamp: TS, _o2_id: ID, message: "[REDACTED]" };
    expect(permalinkOutcome({ parsed: idLink, result: ok([current]) })).toMatchObject({
      state: "found",
      record: current,
    });
  });

  it("copies then opens the same line end to end", () => {
    const rows = [
      { _timestamp: TS, host: "h1", message: "same ts, other line" },
      { _timestamp: TS, host: "h2", message: "the shared line", _all: "x" },
    ];
    const decision = decideCopyLink(
      copyInput({ row: { ...rows[1], _stream_name: "app_logs" }, resolve: ok(rows) }),
    );
    expect(decision.kind).toBe("exact");
    const query = buildLineLinkQuery(
      { org_identifier: "default", from: TS, to: TS },
      decision.link,
    );
    const parsed = parsePermalinkQuery(query as Record<string, unknown>);
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    const request = buildResolveRequest({ orgIdentifier: "default", ...parsed.link });
    expect(request.options.query.query.sql).toBe("SELECT * FROM app_logs");
    const outcome = permalinkOutcome({ parsed, result: ok(rows), allFieldsName: "_all" });
    expect(outcome.state).toBe("found");
    expect(outcome.record).toBe(rows[1]);
  });
});
