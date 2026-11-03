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
import { childShortfall, schemaShortfall, toSchemaRows } from "@/utils/dbm/breakdownRows";
import {
  drowningInstanceKeys,
  foldByInstance,
  hasWorstOfPercentiles,
  instanceKey,
  isCriticalServer,
  serverRowKey,
} from "@/utils/dbm/instanceRows";

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

  it("takes the worst schema's percentile, never a mean of them", () => {
    const [server] = foldByInstance(o2dev);
    expect(server.p95_ns).toBe(30);
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

  it("lists the named schemas, so one named schema beside unnamed traffic is still named", () => {
    const [server] = foldByInstance(o2dev);
    expect(server.namedSchemas).toEqual(["o2dev", "o2alpha", "postgres"]);
    const [mixed] = foldByInstance([
      totals({ db_namespace: "orders", calls: 10, total_time_ns: 100 }),
      totals({ db_namespace: "", calls: 4, total_time_ns: 40 }),
    ]);
    expect(mixed.db_namespace).toBeUndefined();
    expect(mixed.namedSchemas).toEqual(["orders"]);
  });

  it("keys a server row on its identity alone, whatever schemas fold into it", () => {
    const [all] = foldByInstance(o2dev);
    const [one] = foldByInstance(o2dev, "postgres");
    expect(serverRowKey(all)).toBe(serverRowKey(one));
    expect(serverRowKey(all)).not.toBe(serverRowKey(foldByInstance(o2dev)[1]));
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

  it("keeps the schemas and says the split failed when it did", () => {
    const [server] = foldByInstance(o2dev);
    const children = toSchemaRows({ ...state([]), failed: true }, server.schemas, "p");
    expect(children.map((child) => [child.kind, child.status])).toEqual([
      ["schema", null],
      ["schema", null],
      ["schema", null],
      ["status", "error"],
    ]);
    expect(children[3].rowKey).toBe("p/status");
  });

  it("adds one trailing child for traffic no single schema owns, so the children add up", () => {
    const schemas = [
      totals({ db_namespace: "orders", calls: 600, total_time_ns: 6_000, p95_ns: 40 }),
      totals({ db_namespace: "", calls: 200, errors: 2, total_time_ns: 3_000, p95_ns: 90 }),
      totals({ db_namespace: "billing", calls: 100, total_time_ns: 1_000, p95_ns: 20 }),
    ];
    const [server] = foldByInstance(schemas);
    const splitRows: QueryStatsRow[] = [
      {
        fingerprint: "f1",
        db_system: "postgresql",
        db_instance: "o2dev",
        db_namespace: "orders",
        service_name: "checkout",
        calls: 500,
        total_time_ns: 5_000,
      },
      {
        fingerprint: "f2",
        db_system: "postgresql",
        db_instance: "o2dev",
        namespaces: ["orders", "billing"],
        service_name: "healthcheck",
        calls: 50,
        total_time_ns: 500,
      },
      {
        fingerprint: "f3",
        db_system: "postgresql",
        db_instance: "o2dev",
        service_name: "migrator",
        calls: 150,
        total_time_ns: 2_500,
      },
    ];
    const children = toSchemaRows(state(splitRows), server.schemas, "p");
    expect(children.map((child) => [child.name, child.calls])).toEqual([
      ["orders", 600],
      ["billing", 100],
      [null, 200],
    ]);
    const unattributed = children[2];
    expect(unattributed.kind).toBe("schema");
    expect(unattributed.errors).toBe(2);
    expect(unattributed.p95_ns).toBe(90);
    expect(unattributed.children.map((child) => child.name)).toEqual(["migrator"]);
    const time = children.reduce((acc, child) => acc + child.total_time_ns, 0);
    expect(time).toBe(server.total_time_ns);
    expect(children.reduce((acc, child) => acc + child.share, 0)).toBeCloseTo(1);
    expect(childShortfall(children, server.total_time_ns)).toBeNull();
  });

  it("counts a multi-schema statement once: no unattributed child without unnamed totals", () => {
    const [server] = foldByInstance([
      totals({ db_namespace: "orders", calls: 600, total_time_ns: 6_000, p95_ns: 40 }),
      totals({ db_namespace: "billing", calls: 100, total_time_ns: 1_000, p95_ns: 20 }),
    ]);
    const children = toSchemaRows(
      state([
        {
          fingerprint: "f1",
          db_system: "postgresql",
          db_instance: "o2dev",
          db_namespace: "orders",
          service_name: "checkout",
          calls: 500,
          total_time_ns: 5_000,
        },
        {
          fingerprint: "f2",
          db_system: "postgresql",
          db_instance: "o2dev",
          namespaces: ["orders", "billing"],
          service_name: "healthcheck",
          calls: 50,
          total_time_ns: 500,
        },
      ]),
      server.schemas,
      "p",
    );
    expect(children.map((child) => child.name)).toEqual(["orders", "billing"]);
    expect(children.reduce((acc, child) => acc + child.total_time_ns, 0)).toBe(
      server.total_time_ns,
    );
    expect(children.reduce((acc, child) => acc + child.calls, 0)).toBe(server.calls);
  });

  it("takes the unattributed figures from unnamed totals, never a multi-schema statement's", () => {
    const [server] = foldByInstance([
      totals({ db_namespace: "orders", calls: 600, total_time_ns: 6_000 }),
      totals({ db_namespace: "", calls: 40, errors: 1, total_time_ns: 400, p99_ns: 70 }),
    ]);
    const children = toSchemaRows(
      state([
        {
          fingerprint: "f9",
          db_system: "postgresql",
          db_instance: "o2dev",
          namespaces: ["orders", "reports"],
          service_name: "healthcheck",
          calls: 900,
          total_time_ns: 9_000,
          p99_ns: 999,
        },
      ]),
      server.schemas,
      "p",
    );
    const unattributed = children[1];
    expect([unattributed.name, unattributed.calls, unattributed.errors]).toEqual([null, 40, 1]);
    expect(unattributed.total_time_ns).toBe(400);
    expect(unattributed.p99_ns).toBe(70);
    expect(unattributed.children).toEqual([]);
    expect(children.reduce((acc, child) => acc + child.total_time_ns, 0)).toBe(
      server.total_time_ns,
    );
  });

  it("states the shortfall when the children do not cover the parent", () => {
    const children = toSchemaRows(
      state(split),
      [totals({ db_namespace: "o2dev", calls: 300, total_time_ns: 9_000 })],
      "p",
    );
    expect(childShortfall(children, 9_000)).toBeNull();
    expect(childShortfall(children, 12_000)).toBeCloseTo(0.25);
  });

  describe("a server with one named schema beside unnamed traffic", () => {
    const [server] = foldByInstance([
      totals({ db_namespace: "app", calls: 100, total_time_ns: 100, p95_ns: 5 }),
      totals({ db_namespace: "", calls: 10, total_time_ns: 10, p95_ns: 50 }),
    ]);
    const split: QueryStatsRow[] = [
      {
        fingerprint: "a",
        db_system: "postgresql",
        db_instance: "o2dev",
        namespaces: ["app", "billing"],
        service_name: "multi",
        calls: 60,
        total_time_ns: 60,
      },
      {
        fingerprint: "b",
        db_system: "postgresql",
        db_instance: "o2dev",
        service_name: "noschema",
        calls: 10,
        total_time_ns: 10,
      },
      {
        fingerprint: "c",
        db_system: "postgresql",
        db_instance: "o2dev",
        db_namespace: "app",
        service_name: "appsvc",
        calls: 30,
        total_time_ns: 30,
      },
    ];
    const children = toSchemaRows(
      {
        breakdown: buildDatabaseBreakdown(split, server.total_time_ns),
        loading: false,
        failed: false,
      },
      server.schemas,
      "k",
    );

    it("lists only schema-less statements under the unnamed child", () => {
      const unnamed = children[1];
      expect([unnamed.name, unnamed.total_time_ns]).toEqual([null, 10]);
      expect(unnamed.children.map((child) => [child.name, child.total_time_ns])).toEqual([
        ["noschema", 10],
      ]);
    });

    it("states a schema's own shortfall when its services cover less than its total", () => {
      const [app, unnamed] = children;
      expect(app.children.map((child) => child.name)).toEqual(["appsvc"]);
      expect(schemaShortfall(app)).toBeCloseTo(0.7);
      expect(schemaShortfall(unnamed)).toBeNull();
      expect(schemaShortfall(app.children[0])).toBeNull();
    });

    it("states no shortfall for a schema nothing was attributed to", () => {
      const [, empty] = toSchemaRows(
        { breakdown: buildDatabaseBreakdown(split), loading: false, failed: false },
        [...server.schemas, totals({ db_namespace: "reports", calls: 4, total_time_ns: 40 })],
        "k",
      );
      expect([empty.name, empty.children]).toEqual(["reports", []]);
      expect(schemaShortfall(empty)).toBeNull();
    });

    it("states no shortfall while the split is still loading", () => {
      const loading = toSchemaRows(
        { breakdown: buildDatabaseBreakdown(split), loading: true, failed: false },
        server.schemas,
        "k",
      );
      expect(childShortfall(loading, server.total_time_ns)).toBeNull();
      expect(childShortfall(toSchemaRows(undefined, server.schemas, "k"), 110)).toBeNull();
    });

    it("counts the server's speeds as a worst-of over its rows", () => {
      expect(hasWorstOfPercentiles([server])).toBe(true);
      expect(
        hasWorstOfPercentiles(foldByInstance([totals({ db_namespace: "app", calls: 1 })])),
      ).toBe(false);
    });
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

describe("drowningInstanceKeys", () => {
  const slow = 400_000_000;
  const normal = 100_000_000;
  const now = [
    totals({ db_namespace: "orders", calls: 5_000, total_time_ns: 9e12, p95_ns: 500_000_000 }),
    totals({ db_namespace: "reports", calls: 200, total_time_ns: 1e11, p95_ns: slow }),
    totals({ db_instance: "pg-billing", db_namespace: "billing", calls: 900, p95_ns: normal }),
  ];
  const before = [
    totals({ db_namespace: "orders", calls: 5_000, total_time_ns: 9e12, p95_ns: 500_000_000 }),
    totals({ db_namespace: "reports", calls: 200, total_time_ns: 1e10, p95_ns: normal }),
    totals({ db_instance: "pg-billing", db_namespace: "billing", calls: 900, p95_ns: normal }),
  ];

  it("flags the server when one schema slows down, though its worst p95 did not move", () => {
    expect([...drowningInstanceKeys(now, before)]).toEqual([instanceKey(now[0])]);
  });

  it("compares schema to schema even when the server's schema count changed", () => {
    expect([...drowningInstanceKeys(now, before.slice(1))]).toEqual([instanceKey(now[0])]);
  });

  it("honours the Schema filter", () => {
    expect(drowningInstanceKeys(now, before, "orders").size).toBe(0);
    expect(drowningInstanceKeys(now, before, "reports").size).toBe(1);
  });
});

describe("isCriticalServer", () => {
  it("is critical when one schema fails critically, even if the server's rate is diluted", () => {
    const [server] = foldByInstance([
      totals({ db_namespace: "orders", calls: 1_000, errors: 5 }),
      totals({ db_namespace: "reports", calls: 30, errors: 3 }),
    ]);
    expect(isCriticalServer(server)).toBe(true);
  });

  it("keeps the server rule", () => {
    const [server] = foldByInstance([
      totals({ db_namespace: "orders", calls: 15, errors: 1 }),
      totals({ db_namespace: "reports", calls: 15, errors: 1 }),
    ]);
    expect(isCriticalServer(server)).toBe(true);
    const [calm] = foldByInstance([totals({ db_namespace: "orders", calls: 1_000, errors: 1 })]);
    expect(isCriticalServer(calm)).toBe(false);
  });
});
