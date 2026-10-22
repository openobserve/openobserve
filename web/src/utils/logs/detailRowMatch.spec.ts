// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { b64EncodeUnicode } from "@/utils/formatters";
import { matchDetailRow, trustworthyFields, type LogRecord } from "./detailRowMatch";

const sqlReq = (sql: string, over: { query_fn?: string; encoding?: string } = {}) => ({
  sqlMode: true,
  encoding: over.encoding,
  query: { sql, query_fn: over.query_fn },
});

describe("trustworthyFields", () => {
  it("trusts every field in non-SQL mode", () => {
    expect(trustworthyFields({ sqlMode: false, query: { sql: 'SELECT * FROM "default"' } })).toBe(
      "all",
    );
  });

  it("trusts every field for SQL SELECT *", () => {
    expect(trustworthyFields(sqlReq("SELECT * FROM \"default\" WHERE level = 'error'"))).toBe(
      "all",
    );
    expect(trustworthyFields(sqlReq("SELECT *, host FROM logs"))).toBe("all");
  });

  it("keeps bare unaliased columns and drops expressions and aliases", () => {
    const sql =
      "SELECT _timestamp, host, 'B' AS message, upper(msg) AS msg, code AS code, \"Quoted\" FROM logs";
    expect(trustworthyFields(sqlReq(sql))).toEqual(["_timestamp", "host", "Quoted"]);
  });

  it("trusts only identity and bare columns when * sits beside a computed column", () => {
    expect(trustworthyFields(sqlReq("SELECT *, random() AS sample FROM logs"))).toEqual([
      "_timestamp",
      "_o2_id",
    ]);
    expect(trustworthyFields(sqlReq("SELECT *, upper(msg) AS upper_msg, host FROM logs"))).toEqual([
      "_timestamp",
      "_o2_id",
      "host",
    ]);
    expect(trustworthyFields(sqlReq("SELECT *, host AS h FROM logs"))).toEqual([
      "_timestamp",
      "_o2_id",
    ]);
  });

  it("never trusts a name an alias shadows", () => {
    expect(trustworthyFields(sqlReq("SELECT *, _timestamp + 1 AS _timestamp FROM logs"))).toEqual([
      "_o2_id",
    ]);
    expect(trustworthyFields(sqlReq("SELECT host, upper(msg) AS host, level FROM logs"))).toEqual([
      "level",
    ]);
  });

  it("drops table-qualified columns", () => {
    expect(trustworthyFields(sqlReq("SELECT t.host, level FROM logs t"))).toEqual(["level"]);
  });

  it("trusts nothing extra for an aggregation", () => {
    expect(trustworthyFields(sqlReq("SELECT count(*) AS c FROM logs"))).toEqual([]);
  });

  it("ignores comment lines", () => {
    expect(trustworthyFields(sqlReq("-- pick fields\nSELECT host FROM logs"))).toEqual(["host"]);
  });

  it("decodes a base64 request", () => {
    const sql = b64EncodeUnicode("SELECT host, level FROM logs") as string;
    expect(trustworthyFields(sqlReq(sql, { encoding: "base64" }))).toEqual(["host", "level"]);
  });

  it("trusts nothing from SQL it cannot parse", () => {
    expect(trustworthyFields(sqlReq("SELEKT nonsense"))).toEqual([]);
    expect(trustworthyFields(sqlReq(""))).toEqual([]);
  });

  it("trusts only the timestamp and _o2_id while a query function is active", () => {
    expect(trustworthyFields(sqlReq("SELECT * FROM logs", { query_fn: "LmZvbyA9IDE." }))).toEqual([
      "_timestamp",
      "_o2_id",
    ]);
    expect(
      trustworthyFields({ sqlMode: false, query: { sql: "SELECT * FROM logs", query_fn: "x" } }),
    ).toEqual(["_timestamp", "_o2_id"]);
  });

  it("uses the configured timestamp column under a query function", () => {
    expect(
      trustworthyFields(sqlReq("SELECT * FROM logs", { query_fn: "x" }), { timestampColumn: "ts" }),
    ).toEqual(["ts", "_o2_id"]);
  });
});

describe("matchDetailRow", () => {
  const row = (over: LogRecord): LogRecord => ({
    _timestamp: 100,
    _o2_id: "id-1",
    host: "a",
    msg: "hello",
    ...over,
  });

  it("returns the index of a unique match", () => {
    const hits = [row({ _o2_id: "id-0" }), row({}), row({ _o2_id: "id-2" })];
    expect(matchDetailRow(hits, row({}), "all")).toBe(1);
  });

  it("returns the lowest index among identical duplicates", () => {
    const hits = [row({ _o2_id: "x" }), row({}), row({ _o2_id: "y" }), row({})];
    expect(matchDetailRow(hits, row({}), "all")).toBe(1);
  });

  it("returns null when several distinct hits survive", () => {
    const hits = [row({ msg: "one" }), row({ msg: "two" })];
    expect(matchDetailRow(hits, row({}), ["_timestamp", "_o2_id"])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchDetailRow([row({ _o2_id: "other" })], row({}), "all")).toBeNull();
    expect(matchDetailRow([], row({}), "all")).toBeNull();
  });

  it("tells apart equal _o2_id values from two clusters by their trustworthy fields", () => {
    const fromClusterA = row({ host: "cluster-a-node", msg: "disk full" });
    const fromClusterB = row({ host: "cluster-b-node", msg: "user login" });
    expect(matchDetailRow([fromClusterA, fromClusterB], { ...fromClusterB }, "all")).toBe(1);
    expect(matchDetailRow([fromClusterA, fromClusterB], { ...fromClusterB }, ["host"])).toBe(1);
  });

  it("returns null for equal _o2_id values from two clusters when only identity is trustworthy", () => {
    const fromClusterA = row({ host: "cluster-a-node" });
    const fromClusterB = row({ host: "cluster-b-node" });
    expect(
      matchDetailRow([fromClusterA, fromClusterB], { ...fromClusterA }, ["_timestamp", "_o2_id"]),
    ).toBeNull();
  });

  it("falls back to the timestamp when the snapshot has no _o2_id", () => {
    const noId = (over: LogRecord): LogRecord => ({ _timestamp: 100, host: "a", ...over });
    const hits = [noId({ _timestamp: 99 }), noId({}), noId({ _timestamp: 100, host: "b" })];
    expect(matchDetailRow(hits, noId({}), "all")).toBe(1);
    expect(matchDetailRow(hits, noId({}), [])).toBeNull();
  });

  it("matches through a computed column that changed on refresh (SELECT *, random() AS sample)", () => {
    const fields = trustworthyFields(sqlReq("SELECT *, random() AS sample FROM logs"));
    const hits = [row({ _o2_id: "id-0", sample: 0.1 }), row({ sample: 0.9 })];
    expect(matchDetailRow(hits, row({ sample: 0.4 }), fields)).toBe(1);
  });

  it("matches a stored-record snapshot that lacks the computed column", () => {
    const fields = trustworthyFields(sqlReq("SELECT *, upper(msg) AS upper_msg FROM logs"));
    const hits = [row({ upper_msg: "HELLO" })];
    expect(matchDetailRow(hits, row({}), fields)).toBe(0);
  });

  it("returns null when the snapshot has neither _o2_id nor a timestamp", () => {
    const fields = trustworthyFields(sqlReq("SELECT upper(msg) AS msg FROM logs"));
    expect(fields).toEqual([]);
    expect(matchDetailRow([{ msg: "OTHER" }], { msg: "FIRST" }, fields)).toBeNull();
    expect(matchDetailRow([{ msg: "SAME" }], { msg: "SAME" }, "all")).toBeNull();
    expect(matchDetailRow([{ _timestamp: null }], { _timestamp: null }, "all")).toBeNull();
  });

  it("rejects candidates that lack the chosen identity", () => {
    const { _o2_id: _drop, ...noId } = row({});
    expect(matchDetailRow([noId], row({}), [])).toBeNull();
    const { _timestamp: _ts, ...noTs } = { _timestamp: 100, host: "a" };
    expect(matchDetailRow([noTs], { _timestamp: 100, host: "a" }, [])).toBeNull();
  });

  it("uses the configured timestamp column", () => {
    const hits = [
      { ts: 1, host: "a" },
      { ts: 2, host: "a" },
    ];
    expect(matchDetailRow(hits, { ts: 2, host: "a" }, "all", { timestampColumn: "ts" })).toBe(1);
  });

  it("ignores untrusted fields, so a rewritten expression still matches", () => {
    const hits = [row({ message: "B" })];
    expect(matchDetailRow(hits, row({ message: "stored text" }), ["_timestamp", "host"])).toBe(0);
  });

  it("scopes candidates to the snapshot's stream", () => {
    const hits = [row({ _stream_name: "s1" }), row({ _stream_name: "s2" })];
    expect(matchDetailRow(hits, row({ _stream_name: "s2" }), ["_o2_id"])).toBe(1);
  });

  it("compares nested values structurally", () => {
    const hits = [row({ kube: { pod: "p1" } }), row({ kube: { pod: "p2" } })];
    expect(matchDetailRow(hits, row({ kube: { pod: "p2" } }), "all")).toBe(1);
  });

  it("compares only the fields the hit carries under all (quick mode subset)", () => {
    const hits = [{ _timestamp: 100, _o2_id: "id-1", host: "a" }];
    expect(matchDetailRow(hits, row({}), "all")).toBe(0);
  });
});
