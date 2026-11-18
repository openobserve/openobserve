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

import type { ProfileFilter } from "@/services/profiles";
import { describe, expect, it } from "vitest";
import {
  buildTopTracesSql,
  hasTraceIdFilter,
  isIncompleteSearchResponse,
  isSafeFilterKey,
  isTraceLinkedProfileType,
  openTraceLocation,
  parseTopTraceRows,
  requestRange,
  shortTraceId,
} from "./traceLink";

const traceFilter = { key: "trace_id", op: "=" as const, value: "abc" };
const range = { startTime: 1_700_000_000_000_000, endTime: 1_700_000_900_000_000 };

describe("requestRange", () => {
  it("pads 120 s back and 60 s forward (microseconds) with a trace_id filter", () => {
    expect(requestRange(range, [traceFilter])).toEqual({
      startTime: range.startTime - 120_000_000,
      endTime: range.endTime + 60_000_000,
    });
  });

  it("returns the window unchanged without a trace_id filter", () => {
    expect(requestRange(range, [])).toBe(range);
    expect(requestRange(range, [{ key: "span_id", op: "=", value: "s" }])).toBe(range);
    expect(requestRange(range, [{ key: "trace_id", op: "=", value: "" }])).toBe(range);
  });

  it("never sends a non-positive start", () => {
    expect(requestRange({ startTime: 50_000_000, endTime: 200_000_000 }, [traceFilter])).toEqual({
      startTime: 1,
      endTime: 260_000_000,
    });
  });

  it("does not change its input, so a window padded from the original is always the same", () => {
    const first = requestRange(range, [traceFilter]);
    const second = requestRange(range, [traceFilter]);
    expect(second).toEqual(first);
    expect(range.startTime).toBe(1_700_000_000_000_000);
    expect(hasTraceIdFilter([traceFilter])).toBe(true);
  });
});

describe("hasTraceIdFilter", () => {
  it.each([
    [{ key: "trace_id", op: "=", value: "abc" }, true],
    [{ key: "trace_id", op: "in", values: ["a", "b"] }, true],
    [{ key: "trace_id", op: "in", value: "a,b" }, true],
    [{ key: "trace_id", op: "!=", value: "abc" }, false],
    [{ key: "trace_id", op: "not_in", values: ["a"] }, false],
    [{ key: "trace_id", op: "=", value: "" }, false],
    [{ key: "span_id", op: "=", value: "abc" }, false],
  ] as const)("%o is a trace filter: %s", (filter, expected) => {
    expect(hasTraceIdFilter([filter as ProfileFilter])).toBe(expected);
  });
});

describe("isTraceLinkedProfileType", () => {
  it("accepts cpu and wall only", () => {
    expect(isTraceLinkedProfileType("cpu")).toBe(true);
    expect(isTraceLinkedProfileType("WALL")).toBe(true);
    expect(isTraceLinkedProfileType("inuse_space")).toBe(false);
    expect(isTraceLinkedProfileType("alloc_objects")).toBe(false);
    expect(isTraceLinkedProfileType(undefined)).toBe(false);
  });
});

describe("isSafeFilterKey", () => {
  it("mirrors the backend rule", () => {
    expect(isSafeFilterKey("k8s.pod_name-1")).toBe(true);
    expect(isSafeFilterKey("a".repeat(128))).toBe(true);
    expect(isSafeFilterKey("a".repeat(129))).toBe(false);
    expect(isSafeFilterKey("")).toBe(false);
    expect(isSafeFilterKey('x" OR 1=1 --')).toBe(false);
    expect(isSafeFilterKey("a b")).toBe(false);
    expect(isSafeFilterKey("naïve")).toBe(false);
  });
});

describe("buildTopTracesSql", () => {
  it("builds the grouped query with quoted identifiers and literals", () => {
    const sql = buildTopTracesSql({
      stream: 'prof"iles',
      profileType: "cpu",
      profileUnit: "nanoseconds",
      service: "o'brien",
      filters: [{ key: "k8s.pod_name", op: "=", value: "pod'1" }],
    });
    expect(sql).toBe(
      'SELECT trace_id, SUM("value") AS total, MIN(_timestamp) AS first_ts, MAX(_timestamp) AS last_ts FROM "prof""iles" ' +
        "WHERE profile_type = 'cpu' AND profile_unit = 'nanoseconds' AND \"stack\" IS NOT NULL AND trace_id IS NOT NULL AND trace_id != '' " +
        "AND service_name = 'o''brien' AND \"k8s_pod_name\" = 'pod''1' " +
        "GROUP BY trace_id ORDER BY total DESC LIMIT 20",
    );
  });

  it.each([
    [{ key: "env", op: "!=", value: "prod" }, "\"env\" != 'prod'"],
    [{ key: "env", op: "=~", value: "pr.*" }, "regexp_like(\"env\", 'pr.*')"],
    [{ key: "env", op: "!~", value: "pr.*" }, "NOT regexp_like(\"env\", 'pr.*')"],
    [{ key: "v", op: "in", values: ["a", "b'c"] }, "\"v\" IN ('a', 'b''c')"],
    [{ key: "v", op: "not_in", value: "a, b" }, "\"v\" NOT IN ('a', 'b')"],
  ] as const)("applies a %o filter as the profiles API does", (filter, expected) => {
    const sql = buildTopTracesSql({
      stream: "p",
      profileType: "cpu",
      filters: [filter as ProfileFilter],
    });
    expect(sql).toContain(`AND ${expected} GROUP BY`);
  });

  it("skips unsafe keys and empty lists, and keeps an empty value as the server does", () => {
    const sql = buildTopTracesSql({
      stream: "p",
      profileType: "wall",
      filters: [
        { key: 'a" OR 1=1 --', op: "=", value: "x" },
        { key: "good", op: "=", value: "" },
        { key: "bad op", op: "=", value: "v" },
        { key: "ok", op: "=", value: "v" },
        { key: "none", op: "in", values: [] },
      ],
    });
    expect(sql).toContain("\"ok\" = 'v'");
    expect(sql).not.toContain('"none"');
    expect(sql).not.toContain("OR 1=1");
    expect(sql).toContain("\"good\" = ''");
    expect(sql).not.toContain("profile_unit");
    expect(sql).not.toContain("service_name");
  });
});

describe("isIncompleteSearchResponse", () => {
  it("flags is_partial and a function_error, as the backend does", () => {
    expect(isIncompleteSearchResponse({ is_partial: true })).toBe(true);
    expect(isIncompleteSearchResponse({ function_error: ["boom"] })).toBe(true);
    expect(isIncompleteSearchResponse({ function_error: "boom" })).toBe(true);
  });

  it("accepts a complete answer", () => {
    expect(isIncompleteSearchResponse({ is_partial: false, function_error: [] })).toBe(false);
    expect(isIncompleteSearchResponse({ function_error: "" })).toBe(false);
    expect(isIncompleteSearchResponse({})).toBe(false);
    expect(isIncompleteSearchResponse(undefined)).toBe(false);
  });
});

describe("parseTopTraceRows", () => {
  it("reads numbers, tolerates strings and drops rows without a trace id", () => {
    expect(
      parseTopTraceRows([
        { trace_id: "t1", total: "10", first_ts: 5, last_ts: "9" },
        { trace_id: "", total: 1, first_ts: 1, last_ts: 1 },
        { total: 1 },
      ]),
    ).toEqual([{ traceId: "t1", total: 10, firstTs: 5, lastTs: 9 }]);
  });
});

describe("openTraceLocation", () => {
  it("routes to traceDetails with the profile timestamps padded by 15 minutes, in microseconds", () => {
    expect(
      openTraceLocation("org1", "default", {
        traceId: "t1",
        firstTs: 2_000_000_000_000,
        lastTs: 2_000_060_000_000,
      }),
    ).toEqual({
      name: "traceDetails",
      query: {
        stream: "default",
        trace_id: "t1",
        from: 2_000_000_000_000 - 900_000_000,
        to: 2_000_060_000_000 + 900_000_000,
        refresh: 0,
        org_identifier: "org1",
        reload: "true",
      },
    });
  });

  it("never sends a non-positive start", () => {
    expect(openTraceLocation("o", "s", { traceId: "t", firstTs: 10, lastTs: 20 }).query.from).toBe(
      1,
    );
  });
});

describe("shortTraceId", () => {
  it("shortens long ids and keeps short ones", () => {
    expect(shortTraceId("0123456789abcdef0123456789abcdef")).toBe("01234567…");
    expect(shortTraceId("short")).toBe("short");
  });
});
