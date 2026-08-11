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

import type { QueryStatsRow } from "@/services/db_monitoring";

import { buildDatabaseBreakdown, rowNamespace, rowService, SHORTFALL_FLOOR } from "./breakdown";

/**
 * The lab shape, verbatim from the live endpoint: the merged rows carry
 * `namespaces[]` / `services[]` arrays and NO `db_namespace` / `service_name`
 * scalar, so every fixture here uses the array form. A test built on the scalar
 * would pass while the real page rendered nothing.
 */
const row = (over: Partial<QueryStatsRow> = {}): QueryStatsRow => ({
  fingerprint: "fp",
  db_system: "postgresql",
  db_instance: "postgres",
  calls: 100,
  errors: 0,
  total_time_ns: 1_000_000,
  p95_ns: 5_000,
  ...over,
});

describe("rowNamespace", () => {
  it("prefers the scalar the merge emits when constituents agreed", () => {
    expect(rowNamespace(row({ db_namespace: "shop", namespaces: ["other"] }))).toBe("shop");
  });

  it("falls back to a single-entry namespaces array", () => {
    expect(rowNamespace(row({ namespaces: ["dbmlab"] }))).toBe("dbmlab");
  });

  it("is null when no namespace was reported at all", () => {
    expect(rowNamespace(row())).toBeNull();
    expect(rowNamespace(row({ namespaces: [] }))).toBeNull();
  });

  it("is null when the row spans several schemas, rather than picking one", () => {
    expect(rowNamespace(row({ namespaces: ["a", "b"] }))).toBeNull();
  });
});

describe("rowService", () => {
  it("prefers service_name", () => {
    expect(rowService(row({ service_name: "checkout", services: ["cart"] }))).toBe("checkout");
  });

  it("falls back to services[0] when that is the only entry", () => {
    expect(rowService(row({ services: ["dbm-sv-workload"] }))).toBe("dbm-sv-workload");
  });

  it("is null for a fingerprint several services share — the split is unknowable", () => {
    expect(rowService(row({ services: ["cart", "checkout"] }))).toBeNull();
  });

  it("is null when nothing named a caller", () => {
    expect(rowService(row())).toBeNull();
  });
});

describe("buildDatabaseBreakdown — empty input", () => {
  const result = buildDatabaseBreakdown([]);

  it("produces no levels and no attributed time", () => {
    expect(result.levels).toEqual([]);
    expect(result.attributedNs).toBe(0);
  });

  it("collapses, because no row named a schema", () => {
    expect(result.collapsed).toBe(true);
  });

  it("reports no shortfall without a total to measure against", () => {
    expect(result.shortfall).toBeNull();
    expect(result.databaseTotalNs).toBeNull();
  });

  it("reports a total shortfall when the database did have time", () => {
    expect(buildDatabaseBreakdown([], 500).shortfall).toBe(1);
  });
});

describe("buildDatabaseBreakdown — single service, no namespace (the live lab shape)", () => {
  const rows = [
    row({ fingerprint: "a", services: ["dbm-sv-workload"], total_time_ns: 300, calls: 3 }),
    row({ fingerprint: "b", services: ["dbm-sv-workload"], total_time_ns: 700, calls: 7 }),
  ];
  const result = buildDatabaseBreakdown(rows, 1000);

  it("collapses the empty schema tier and lists services directly", () => {
    expect(result.collapsed).toBe(true);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].name).toBe("dbm-sv-workload");
    expect(result.levels[0].children).toEqual([]);
  });

  it("sums time and calls and owns the whole share", () => {
    expect(result.levels[0].totalTimeNs).toBe(1000);
    expect(result.levels[0].calls).toBe(10);
    expect(result.levels[0].share).toBe(1);
    expect(result.levels[0].queryCount).toBe(2);
  });

  it("reports no shortfall when the grains agree", () => {
    expect(result.shortfall).toBeNull();
  });
});

describe("buildDatabaseBreakdown — several services under one schema", () => {
  const rows = [
    row({ fingerprint: "a", namespaces: ["shop"], services: ["cart"], total_time_ns: 200 }),
    row({ fingerprint: "b", namespaces: ["shop"], services: ["checkout"], total_time_ns: 800 }),
  ];
  const result = buildDatabaseBreakdown(rows, 1000);

  it("keeps the schema tier once a schema is named", () => {
    expect(result.collapsed).toBe(false);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].name).toBe("shop");
  });

  it("ranks the children heaviest first", () => {
    expect(result.levels[0].children.map((c) => c.name)).toEqual(["checkout", "cart"]);
  });

  it("gives each child its share of ITS PARENT, not of the database", () => {
    expect(result.levels[0].children[0].share).toBeCloseTo(0.8, 10);
    expect(result.levels[0].children[1].share).toBeCloseTo(0.2, 10);
  });
});

describe("buildDatabaseBreakdown — several schemas", () => {
  const rows = [
    row({ fingerprint: "a", namespaces: ["reporting"], services: ["etl"], total_time_ns: 100 }),
    row({ fingerprint: "b", namespaces: ["shop"], services: ["cart"], total_time_ns: 300 }),
    row({ fingerprint: "c", namespaces: ["shop"], services: ["cart"], total_time_ns: 600 }),
  ];
  const result = buildDatabaseBreakdown(rows, 1000);

  it("ranks schemas heaviest first and shares them against the attributed total", () => {
    expect(result.levels.map((l) => l.name)).toEqual(["shop", "reporting"]);
    expect(result.levels[0].share).toBeCloseTo(0.9, 10);
    expect(result.levels[1].share).toBeCloseTo(0.1, 10);
  });

  it("merges same-service rows within a schema into one child", () => {
    expect(result.levels[0].children).toHaveLength(1);
    expect(result.levels[0].children[0].totalTimeNs).toBe(900);
    expect(result.levels[0].children[0].queryCount).toBe(2);
  });

  it("keeps node keys unique across schemas that share a service name", () => {
    const keys = result.levels.flatMap((l) => [l.key, ...l.children.map((c) => c.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildDatabaseBreakdown — rows the grain cannot attribute", () => {
  it("keeps an unnamed schema alongside named ones rather than dropping its time", () => {
    const rows = [
      row({ fingerprint: "a", namespaces: ["shop"], services: ["cart"], total_time_ns: 600 }),
      row({ fingerprint: "b", services: ["cart"], total_time_ns: 400 }),
    ];
    const result = buildDatabaseBreakdown(rows, 1000);
    expect(result.collapsed).toBe(false);
    expect(result.levels.map((l) => l.name)).toEqual(["shop", null]);
    expect(result.attributedNs).toBe(1000);
  });

  it("puts a multi-service fingerprint in an unnamed service node, not on services[0]", () => {
    const rows = [
      row({ fingerprint: "a", services: ["cart", "checkout"], total_time_ns: 500 }),
      row({ fingerprint: "b", services: ["cart"], total_time_ns: 500 }),
    ];
    const result = buildDatabaseBreakdown(rows, 1000);
    const cart = result.levels.find((l) => l.name === "cart");
    expect(cart?.totalTimeNs).toBe(500);
    expect(result.levels.find((l) => l.name === null)?.totalTimeNs).toBe(500);
  });
});

describe("buildDatabaseBreakdown — p95 across children", () => {
  it("reports the worst p95, never a pooled percentile", () => {
    const rows = [
      row({ fingerprint: "a", services: ["cart"], p95_ns: 10, total_time_ns: 1 }),
      row({ fingerprint: "b", services: ["cart"], p95_ns: 90, total_time_ns: 1 }),
    ];
    expect(buildDatabaseBreakdown(rows).levels[0].p95Ns).toBe(90);
  });

  it("stays null when no row carried a p95", () => {
    const rows = [row({ services: ["cart"], p95_ns: undefined })];
    expect(buildDatabaseBreakdown(rows).levels[0].p95Ns).toBeNull();
  });

  /**
   * Regression: p50 and p99 were hardcoded null on the belief that the query
   * grain does not report them. It does — every `query_stats` row carries all
   * three — so those two columns rendered empty next to a populated p95 for no
   * reason. All three follow the same worst-of rule.
   */
  it("carries p50 and p99 by the same worst-of rule, not just p95", () => {
    const rows = [
      row({ fingerprint: "a", services: ["cart"], p50_ns: 5, p95_ns: 10, p99_ns: 20 }),
      row({ fingerprint: "b", services: ["cart"], p50_ns: 7, p95_ns: 90, p99_ns: 12 }),
    ];
    const node = buildDatabaseBreakdown(rows).levels[0];
    expect(node.p50Ns).toBe(7);
    expect(node.p95Ns).toBe(90);
    expect(node.p99Ns).toBe(20);
  });

  it("skips rows that omit a percentile rather than treating it as zero", () => {
    const rows = [
      row({ fingerprint: "a", services: ["cart"], p50_ns: undefined, p99_ns: 40 }),
      row({ fingerprint: "b", services: ["cart"], p50_ns: 6, p99_ns: undefined }),
    ];
    const node = buildDatabaseBreakdown(rows).levels[0];
    expect(node.p50Ns).toBe(6);
    expect(node.p99Ns).toBe(40);
  });
});

describe("buildDatabaseBreakdown — shortfall against the exact database total", () => {
  const rows = [row({ services: ["cart"], total_time_ns: 700 })];

  it("reports the unattributed share when the query grain is truncated", () => {
    const result = buildDatabaseBreakdown(rows, 1000);
    expect(result.shortfall).toBeCloseTo(0.3, 10);
    expect(result.attributedNs).toBe(700);
    expect(result.databaseTotalNs).toBe(1000);
  });

  it("accepts the DbTotalsRow itself, not just a number", () => {
    expect(buildDatabaseBreakdown(rows, { total_time_ns: 1000 }).shortfall).toBeCloseTo(0.3, 10);
  });

  it("stays silent about a rounding-sized gap", () => {
    const result = buildDatabaseBreakdown([row({ services: ["cart"], total_time_ns: 995 })], 1000);
    expect(result.shortfall).toBeNull();
  });

  it("fires exactly at the floor", () => {
    const attributed = 1000 * (1 - SHORTFALL_FLOOR);
    const result = buildDatabaseBreakdown(
      [row({ services: ["cart"], total_time_ns: attributed })],
      1000,
    );
    expect(result.shortfall).toBeCloseTo(SHORTFALL_FLOOR, 10);
  });

  it("never reports a negative shortfall when the query grain runs ahead", () => {
    expect(
      buildDatabaseBreakdown([row({ services: ["cart"], total_time_ns: 1200 })], 1000).shortfall,
    ).toBeNull();
  });

  /**
   * The figure is measured against THIS database's own total, so four databases
   * yield four different percentages. That is why the caveat carrying it is a
   * per-row disclosure rather than one sentence hoisted above the table — and
   * it is the evidence for keeping it attached to its row rather than lifting
   * it, when the caveat was found repeating verbatim under all four.
   */
  it("measures each database against its own total, so the figures discriminate", () => {
    const shortfalls = [700, 550, 910, 300].map(
      (attributed) =>
        buildDatabaseBreakdown([row({ services: ["cart"], total_time_ns: attributed })], 1000)
          .shortfall,
    );
    expect(shortfalls).toEqual([0.3, 0.45, 0.09, 0.7].map((v) => expect.closeTo(v, 10)));
    expect(new Set(shortfalls).size).toBe(4);
  });
});

describe("buildDatabaseBreakdown — missing metrics", () => {
  it("treats absent time and calls as zero rather than NaN", () => {
    const rows = [
      row({ services: ["cart"], total_time_ns: undefined, calls: undefined, errors: undefined }),
    ];
    const result = buildDatabaseBreakdown(rows, 100);
    expect(result.levels[0].totalTimeNs).toBe(0);
    expect(result.levels[0].calls).toBe(0);
    expect(result.levels[0].errors).toBe(0);
    expect(result.levels[0].share).toBe(0);
  });
});
