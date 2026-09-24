// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  acceptOutcome,
  entityAggSql,
  failureRate,
  entitySignals,
  entityTimelineSql,
  isExternalIp,
  mergeEntities,
  planStream,
  relatedSql,
  type EntityRow,
} from "./entities";
import { SOURCE_TYPE_BY_ID } from "./sourceTypes";

const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
const ctFields = [
  "_timestamp",
  "eventname",
  "eventsource",
  "useridentity_username",
  "useridentity_arn",
  "sourceipaddress",
  "recipientaccountid",
  "errorcode",
];
const authFields = ["_timestamp", "user", "src_ip", "host", "outcome", "level", "message"];

describe("planStream", () => {
  it("reads entity columns from the source's field map", () => {
    const plan = planStream("ct", ctFields, cloudtrail);
    expect(plan.columns.user).toBe("useridentity_username");
    expect(plan.columns.ip).toBe("sourceipaddress");
    expect(plan.failure).toContain(`"errorcode" IS NOT NULL`);
  });

  it("falls back to common names when the source maps no actor", () => {
    const plan = planStream("auth", authFields, SOURCE_TYPE_BY_ID.get("syslog_generic")!);
    expect(plan.columns).toEqual({ user: "user", ip: "src_ip", host: "host" });
    // A value-style outcome is only a candidate until its values are read.
    expect(plan.outcomeColumn).toBe("outcome");
    expect(plan.failure).toBeNull();
  });

  it("trusts an outcome column only when its values can be read", () => {
    const plan = planStream("auth", authFields, null);
    const words = acceptOutcome(plan, [
      { value: "success", n: 80 },
      { value: "failure", n: 20 },
    ]);
    expect(words.failure).toContain(`LOWER(TRIM(CAST("outcome" AS VARCHAR))) IN ('failure'`);
    expect(words.failure).toContain("BETWEEN 400 AND 599");
    // gRPC-style codes: mostly unreadable, so failures stay unknown.
    const grpc = acceptOutcome(plan, [
      { value: "0", n: 50 },
      { value: "7", n: 50 },
    ]);
    expect(grpc.failure).toBeNull();
    // HTTP codes are readable.
    expect(
      acceptOutcome(plan, [
        { value: "200", n: 9 },
        { value: "503", n: 1 },
      ]).failure,
    ).not.toBeNull();
  });

  it("says nothing about failure when the stream has no outcome", () => {
    const plan = planStream("x", ["_timestamp", "user"], null);
    expect(plan.failure).toBeNull();
    expect(plan.outcomeColumn).toBeNull();
  });
});

describe("entity SQL", () => {
  const plan = acceptOutcome(planStream("auth", authFields, null), [{ value: "success", n: 1 }]);

  it("counts events, failures and distinct non-empty peers per entity, capped", () => {
    const sql = entityAggSql(plan, "user", 200)!;
    expect(sql).toContain(
      `COUNT(DISTINCT CASE WHEN "src_ip" IS NOT NULL AND CAST("src_ip" AS VARCHAR) != '' THEN CAST("src_ip" AS VARCHAR) END) AS zo_peers`,
    );
    expect(sql).toMatch(/GROUP BY zo_entity ORDER BY zo_n DESC LIMIT 200$/);
  });

  it("returns null for a kind the stream cannot answer", () => {
    expect(entityAggSql(planStream("x", ["_timestamp", "user"], null), "ip", 10)).toBeNull();
  });

  it("escapes the entity value in filters", () => {
    expect(entityTimelineSql(plan, "user", "o'brien", "1 hour")).toContain(`= 'o''brien'`);
    expect(relatedSql(plan, "user", "bob", "ip", 10)).toContain(
      `CAST("src_ip" AS VARCHAR) AS zo_value`,
    );
    expect(relatedSql(plan, "user", "bob", "user", 10)).toBeNull();
  });
});

describe("mergeEntities", () => {
  it("adds counts across streams and keeps the widest time span", () => {
    const a = acceptOutcome(planStream("a", authFields, null), [{ value: "failure", n: 1 }]);
    const b = planStream("b", ["_timestamp", "user"], null);
    const rows = mergeEntities([
      {
        plan: a,
        hits: [{ zo_entity: "bob", zo_n: 10, zo_fail: 3, zo_first: 5, zo_last: 9, zo_peers: 2 }],
      },
      {
        plan: b,
        hits: [{ zo_entity: "bob", zo_n: 4, zo_fail: 0, zo_first: 2, zo_last: 7, zo_peers: 0 }],
      },
    ]);
    expect(rows).toEqual([
      {
        value: "bob",
        events: 14,
        failures: 3,
        failureEvents: 10,
        firstSeen: 2,
        lastSeen: 9,
        streams: ["a", "b"],
        peers: 2,
        failureKnown: true,
      },
    ]);
    // The rate divides by the 10 events that could report failure, not all 14.
    expect(failureRate(rows[0])).toBeCloseTo(0.3);
  });
});

describe("entitySignals", () => {
  const row = (over: Partial<EntityRow>): EntityRow => ({
    value: "x",
    events: 100,
    failures: 0,
    failureEvents: 100,
    firstSeen: 0,
    lastSeen: 0,
    streams: ["s"],
    peers: 1,
    failureKnown: true,
    ...over,
  });

  it("flags a high failure share only past the minimum count", () => {
    expect(entitySignals("user", row({ failures: 30 }))).toContain("failures");
    expect(entitySignals("user", row({ events: 10, failures: 4 }))).not.toContain("failures");
    expect(entitySignals("user", row({ failures: 30, failureKnown: false }))).toEqual([]);
  });

  it("flags spread and public addresses", () => {
    expect(entitySignals("user", row({ peers: 5 }))).toContain("spread");
    expect(entitySignals("ip", row({ value: "185.220.101.4" }))).toContain("external");
    expect(entitySignals("ip", row({ value: "10.0.1.5" }))).not.toContain("external");
  });

  it("recognises non-public ranges and non-addresses", () => {
    expect(isExternalIp("172.16.4.2")).toBe(false);
    expect(isExternalIp("172.32.0.1")).toBe(true);
    expect(isExternalIp("web-1")).toBe(false);
    expect(isExternalIp("host:22")).toBe(false);
    expect(isExternalIp("10.0.0.1:443")).toBe(false);
    expect(isExternalIp("100.64.1.1")).toBe(false); // CGNAT
    expect(isExternalIp("100.128.0.1")).toBe(true);
    expect(isExternalIp("198.18.0.5")).toBe(false); // benchmarking
    expect(isExternalIp("224.0.0.251")).toBe(false); // multicast
    expect(isExternalIp("0.0.0.0")).toBe(false);
    expect(isExternalIp("999.1.1.1")).toBe(false);
    expect(isExternalIp("::ffff:10.1.2.3")).toBe(false);
    expect(isExternalIp("::ffff:8.8.8.8")).toBe(true);
    expect(isExternalIp("fe80::1")).toBe(false);
    expect(isExternalIp("2001:db8::1")).toBe(false);
    expect(isExternalIp("2606:4700::1111")).toBe(true);
    // Documentation (TEST-NET) ranges, like IPv6 2001:db8::/32.
    expect(isExternalIp("192.0.2.10")).toBe(false);
    expect(isExternalIp("198.51.100.23")).toBe(false);
    expect(isExternalIp("203.0.113.77")).toBe(false);
  });
});
