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

import type { DbTotalsRow, QueryStatsRow } from "@/services/db_monitoring";
import { buildDatabaseBreakdown } from "@/utils/dbm/breakdown";
import { toSchemaRows } from "@/utils/dbm/breakdownRows";
import { foldByInstance } from "@/utils/dbm/instanceRows";

const totals = (over: Partial<DbTotalsRow> = {}): DbTotalsRow => ({
  db_system: "postgresql",
  db_instance: "o2dev",
  ...over,
});

/** The shape the live O2-introspection org returned: one host, many databases. */
const o2dev = [
  totals({
    db_namespace: "o2dev",
    calls: 300,
    errors: 3,
    total_time_ns: 9_000,
    p95_ns: 30,
    max_ns: 50,
    qps: 0.3,
    calling_services: ["o2-dbm-agent"],
  }),
  totals({
    db_namespace: "postgres",
    calls: 100,
    total_time_ns: 1_000,
    p95_ns: 10,
    max_ns: 90,
    qps: 0.1,
    calling_services: ["o2-dbm-agent", "pgbouncer"],
  }),
  totals({ db_instance: "valkey-cart", db_system: "redis", db_namespace: "", calls: 5 }),
  totals({ db_namespace: "o2alpha", calls: 0, total_time_ns: 5_000 }),
];

describe("foldByInstance", () => {
  it("returns one row per (system, instance), whatever the schema count", () => {
    const folded = foldByInstance(o2dev);
    expect(folded.map((row) => row.db_instance)).toEqual(["o2dev", "valkey-cart"]);
  });

  it("sums the additive figures exactly and keeps the worst max", () => {
    const [server] = foldByInstance(o2dev);
    expect(server.calls).toBe(400);
    expect(server.errors).toBe(3);
    expect(server.total_time_ns).toBe(15_000);
    expect(server.qps).toBeCloseTo(0.4);
    expect(server.max_ns).toBe(90);
  });

  it("call-weights the percentiles across schemas", () => {
    const [server] = foldByInstance(o2dev);
    // (30*300 + 10*100) / 400
    expect(server.p95_ns).toBe(25);
    expect(server.p50_ns).toBeUndefined();
  });

  it("unions the calling services", () => {
    const [server] = foldByInstance(o2dev);
    expect(server.calling_services).toEqual(["o2-dbm-agent", "pgbouncer"]);
  });

  it("names no namespace for a multi-schema server, and keeps the only one otherwise", () => {
    const [server, redis] = foldByInstance(o2dev);
    expect(server.db_namespace).toBeUndefined();
    expect(redis.db_namespace).toBe("");
  });

  it("keeps the schemas heaviest first", () => {
    const [server] = foldByInstance(o2dev);
    expect(server.schemas.map((row) => row.db_namespace)).toEqual(["o2dev", "o2alpha", "postgres"]);
  });

  it("narrows to one schema under the Schema filter and drops servers without it", () => {
    const folded = foldByInstance(o2dev, "postgres");
    expect(folded).toHaveLength(1);
    expect(folded[0].db_namespace).toBe("postgres");
    expect(folded[0].calls).toBe(100);
    expect(folded[0].p95_ns).toBe(10);
  });
});

describe("toSchemaRows", () => {
  const split: QueryStatsRow[] = [
    {
      fingerprint: "a",
      db_system: "postgresql",
      db_instance: "o2dev",
      db_namespace: "o2dev",
      service_name: "o2-dbm-agent",
      calls: 10,
      total_time_ns: 4_000,
    },
  ];
  const state = (rows: QueryStatsRow[]) => ({
    breakdown: buildDatabaseBreakdown(rows),
    loading: false,
    failed: false,
  });

  it("builds one schema child per schema from the exact totals", () => {
    const [server] = foldByInstance(o2dev);
    const children = toSchemaRows(state(split), server.schemas, "p");
    expect(children.map((child) => [child.kind, child.name, child.calls])).toEqual([
      ["schema", "o2dev", 300],
      ["schema", "o2alpha", 0],
      ["schema", "postgres", 100],
    ]);
    expect(children[0].share).toBeCloseTo(9_000 / 15_000);
  });

  it("hangs the split's services under their own schema only", () => {
    const [server] = foldByInstance(o2dev);
    const [o2devRow, o2alpha] = toSchemaRows(state(split), server.schemas, "p");
    expect(o2devRow.children.map((child) => child.name)).toEqual(["o2-dbm-agent"]);
    expect(o2devRow.queryCount).toBe(1);
    expect(o2alpha.children).toEqual([]);
  });

  it("still lists the schemas when the split failed", () => {
    const [server] = foldByInstance(o2dev);
    const children = toSchemaRows({ ...state([]), failed: true }, server.schemas, "p");
    expect(children).toHaveLength(3);
  });

  it("shows a loading placeholder until the split is filed", () => {
    const [server] = foldByInstance(o2dev);
    expect(toSchemaRows(undefined, server.schemas, "p")[0].kind).toBe("status");
  });

  it("drops straight to services when no schema was named", () => {
    const redis = foldByInstance(o2dev)[1];
    const children = toSchemaRows(
      state([
        {
          fingerprint: "r",
          db_system: "redis",
          db_instance: "valkey-cart",
          service_name: "cart",
          calls: 5,
          total_time_ns: 10,
        },
      ]),
      redis.schemas,
      "r",
    );
    expect(children.map((child) => [child.kind, child.name])).toEqual([["service", "cart"]]);
  });
});
