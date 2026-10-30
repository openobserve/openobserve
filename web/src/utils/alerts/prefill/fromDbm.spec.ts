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
import { buildDbmPrefill, suggestedLatencyMs, DBM_STATS_STREAM } from "./fromDbm";
import { normalizePrefill, isPrefillBlocked } from "../alertPrefill";

const QUERY_ROW = {
  scope: "query" as const,
  kind: "latency" as const,
  fingerprint: "a1b2c3d4e5f60718",
  queryNorm: "SELECT * FROM orders WHERE customer_id = ?",
  fpVersion: 1,
  dbSystem: "postgresql",
  dbInstance: "orders-db",
  p95Ns: 380_000_000,
  rollupIntervalSecs: 900,
};

describe("suggestedLatencyMs", () => {
  // Headroom, not the observed value: an alert armed exactly at today's p95
  // fires on the next ordinary fluctuation, gets muted, and never comes back.
  it("suggests 1.5x the observed p95, in whole milliseconds", () => {
    expect(suggestedLatencyMs(380_000_000)).toBe(570);
  });

  it("falls back to a usable default when there is no observation", () => {
    expect(suggestedLatencyMs(null)).toBe(1000);
    expect(suggestedLatencyMs(0)).toBe(1000);
  });

  // A sub-millisecond query must not produce a 0ms threshold, which would fire
  // on literally every call.
  it("never suggests a zero threshold", () => {
    expect(suggestedLatencyMs(1_000)).toBeGreaterThanOrEqual(1);
  });
});

describe("buildDbmPrefill — query scope", () => {
  it("targets the rollup stream, not raw spans", () => {
    const prefill = buildDbmPrefill(QUERY_ROW);
    expect(prefill.streamName).toBe(DBM_STATS_STREAM);
    expect(prefill.streamType).toBe("logs");
    expect(prefill.queryType).toBe("sql");
  });

  it("pins the alert to the fingerprint AND its version", () => {
    const sql = buildDbmPrefill(QUERY_ROW).sql!;
    expect(sql).toContain("fingerprint = 'a1b2c3d4e5f60718'");
    // Without fp_version a normalizer bump silently re-buckets traffic and the
    // alert compares two different populations of statements.
    expect(sql).toContain("fp_version = '1'");
    expect(sql).toContain("record_type = 'query_stats'");
    expect(sql).toContain("db_instance = 'orders-db'");
  });

  it("thresholds on the stored percentile with headroom", () => {
    const sql = buildDbmPrefill(QUERY_ROW).sql!;
    expect(sql).toContain("MAX(p95_ns)");
    // 380ms observed -> 570ms armed, expressed in nanoseconds.
    expect(sql).toContain("570000000");
  });

  it("matches the evaluation period to the rollup window", () => {
    const prefill = buildDbmPrefill(QUERY_ROW);
    // A shorter period would read a window the rollup has not produced yet.
    expect(prefill.periodMinutes).toBe(15);
    expect(prefill.frequencyMinutes).toBe(15);
  });

  it("warns about rollup lag and fingerprint fragility", () => {
    const keys = buildDbmPrefill(QUERY_ROW).warnings.map((w) => w.key);
    expect(keys).toContain("dbmRollupLag");
    expect(keys).toContain("dbmFingerprintVersion");
  });

  it("produces a usable, unblocked prefill", () => {
    expect(isPrefillBlocked(normalizePrefill(buildDbmPrefill(QUERY_ROW)))).toBe(false);
  });
});

describe("buildDbmPrefill — database scope", () => {
  const DB_ROW = {
    scope: "database" as const,
    kind: "latency" as const,
    dbSystem: "mysql",
    dbInstance: "billing-db",
    p95Ns: 100_000_000,
  };

  it("watches the instance without pinning any one statement", () => {
    const sql = buildDbmPrefill(DB_ROW).sql!;
    expect(sql).toContain("db_instance = 'billing-db'");
    expect(sql).not.toContain("fingerprint =");
    expect(sql).not.toContain("fp_version =");
  });

  it("does not claim fingerprint fragility it is not exposed to", () => {
    const keys = buildDbmPrefill(DB_ROW).warnings.map((w) => w.key);
    expect(keys).not.toContain("dbmFingerprintVersion");
  });
});

describe("buildDbmPrefill — error alerts", () => {
  it("counts errors rather than reading a percentile", () => {
    const sql = buildDbmPrefill({ ...QUERY_ROW, kind: "errors" }).sql!;
    expect(sql).toContain("SUM(errors)");
    expect(sql).not.toContain("p95_ns");
  });
});

describe("buildDbmPrefill — degradation", () => {
  // A query-scoped alert with no fingerprint has nothing stable to match on.
  // Emitting one anyway would produce an alert labelled "this query" that
  // silently watches the entire instance.
  it("falls back to database scope when the fingerprint is missing", () => {
    const prefill = buildDbmPrefill({ ...QUERY_ROW, fingerprint: null });
    expect(prefill.sql).not.toContain("fingerprint =");
    expect(prefill.warnings.map((w) => w.key)).toContain("dbmNoFingerprint");
    expect(prefill.meta?.scope).toBe("database");
  });

  it("never throws on empty input", () => {
    expect(() => buildDbmPrefill({ scope: "query", kind: "latency" })).not.toThrow();
  });
});

describe("buildDbmPrefill — naming", () => {
  it("builds a name that survives being an identifier", () => {
    const name = buildDbmPrefill(QUERY_ROW).name!;
    expect(name).toContain("orders-db");
    expect(name).not.toMatch(/[\s:#?&%'"]/);
  });

  it("distinguishes two queries on the same database", () => {
    const a = buildDbmPrefill(QUERY_ROW).name;
    const b = buildDbmPrefill({ ...QUERY_ROW, fingerprint: "ffffffffffffffff" }).name;
    expect(a).not.toBe(b);
  });
});

describe("buildDbmPrefill — SQL safety", () => {
  it("escapes quotes in identifiers rather than breaking the statement", () => {
    const sql = buildDbmPrefill({
      ...QUERY_ROW,
      dbInstance: "o'brien-db",
    }).sql!;
    expect(sql).toContain("db_instance = 'o''brien-db'");
  });
});
