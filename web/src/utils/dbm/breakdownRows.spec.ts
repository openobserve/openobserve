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
import { buildDatabaseBreakdown } from "@/utils/dbm/breakdown";
import { isBreakdownRow, toBreakdownRows, type DbmBreakdownState } from "@/utils/dbm/breakdownRows";

/**
 * The live lab has one service and one namespace, so multi-schema and
 * multi-service nesting can never be demonstrated on screen there. Those shapes
 * are asserted here instead — otherwise the tier collapse, the per-parent
 * shares and the em-dash columns would ship with nothing exercising them.
 */
const row = (over: Partial<QueryStatsRow> = {}): QueryStatsRow => ({
  fingerprint: "fp",
  db_system: "postgresql",
  db_instance: "postgres",
  ...over,
});

/** A settled fetch, which is the state most of these assertions are about. */
const loaded = (rows: QueryStatsRow[], total?: number): DbmBreakdownState => ({
  breakdown: buildDatabaseBreakdown(rows, total),
  loading: false,
  failed: false,
});

describe("toBreakdownRows", () => {
  it("nests services under their schema, both in the parent's column fields", () => {
    const rows = toBreakdownRows(
      loaded(
        [
          row({ namespaces: ["shop"], services: ["cart"], total_time_ns: 300, calls: 3 }),
          row({ namespaces: ["shop"], services: ["checkout"], total_time_ns: 600, calls: 6 }),
          row({ namespaces: ["reporting"], services: ["etl"], total_time_ns: 100, calls: 1 }),
        ],
        1000,
      ),
      "pg",
    );

    expect(rows.map((r) => r.name)).toEqual(["shop", "reporting"]);
    expect(rows[0].kind).toBe("schema");
    expect(rows[0].calls).toBe(9);
    expect(rows[0].total_time_ns).toBe(900);
    // A schema's share is of the database; a service's is of its schema.
    expect(rows[0].share).toBeCloseTo(0.9);
    expect(rows[0].children.map((c) => c.name)).toEqual(["checkout", "cart"]);
    expect(rows[0].children[0].share).toBeCloseTo(2 / 3);
    expect(rows[0].children[0].kind).toBe("service");
  });

  it("drops the schema tier when no row named a schema", () => {
    const rows = toBreakdownRows(
      loaded([row({ services: ["cart"], total_time_ns: 100 })], 100),
      "pg",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("service");
    expect(rows[0].children).toEqual([]);
    // Nothing to scope a namespace filter with, so it stays null rather than
    // inventing one from the database row.
    expect(rows[0].namespace).toBeNull();
    expect(rows[0].service).toBe("cart");
  });

  it("carries the schema down to its services so a leaf click scopes both", () => {
    const rows = toBreakdownRows(
      loaded([row({ namespaces: ["shop"], services: ["cart"] })], 1),
      "pg",
    );
    expect(rows[0].children[0]).toMatchObject({ namespace: "shop", service: "cart" });
  });

  it("leaves p50 and p99 absent rather than zero — the grain has neither", () => {
    const rows = toBreakdownRows(
      loaded([row({ services: ["cart"], total_time_ns: 100, p95_ns: 7 })], 100),
      "pg",
    );
    expect(rows[0].p50_ns).toBeNull();
    expect(rows[0].p99_ns).toBeNull();
    expect(rows[0].p95_ns).toBe(7);
  });

  it("reports no p95 when the rows carried none", () => {
    const rows = toBreakdownRows(
      loaded([row({ services: ["cart"], total_time_ns: 100 })], 100),
      "pg",
    );
    expect(rows[0].p95_ns).toBeNull();
  });

  it("leaves the error rate undefined over zero traffic instead of calling it 0%", () => {
    const rows = toBreakdownRows(
      loaded([row({ services: ["cart"], total_time_ns: 100, calls: 0 })], 100),
      "pg",
    );
    expect(rows[0].errorRate).toBeNull();
  });

  it("computes the error rate a schema's own calls imply", () => {
    const rows = toBreakdownRows(
      loaded([row({ namespaces: ["shop"], services: ["cart"], calls: 200, errors: 50 })], 1),
      "pg",
    );
    expect(rows[0].errorRate).toBeCloseTo(0.25);
  });

  it("prefixes every key with the database's, so two databases cannot collide", () => {
    const state = loaded([row({ namespaces: ["shop"], services: ["cart"] })], 1);
    const a = toBreakdownRows(state, "pg");
    const b = toBreakdownRows(state, "mysql");
    expect(a[0].rowKey).not.toBe(b[0].rowKey);
    expect(a[0].rowKey.startsWith("pg/")).toBe(true);
    expect(a[0].children[0].rowKey.startsWith(a[0].rowKey)).toBe(true);
  });

  // The chevron only exists on a row that already has children, so a database
  // still waiting on its split must carry a placeholder or it can never be
  // opened at all.
  it("stands a loading placeholder in before the split has arrived", () => {
    for (const state of [undefined, { ...loaded([]), loading: true }]) {
      const rows = toBreakdownRows(state, "pg");
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("status");
      expect(rows[0].status).toBe("loading");
    }
  });

  it("says the fetch failed rather than showing an empty split", () => {
    const rows = toBreakdownRows({ ...loaded([]), failed: true }, "pg");
    expect(rows[0].status).toBe("error");
  });

  it("says nothing was attributable when the fetch succeeded but returned no rows", () => {
    const rows = toBreakdownRows(loaded([]), "pg");
    expect(rows[0].status).toBe("empty");
  });

  it("gives a placeholder no figures at all, so it cannot read as a result", () => {
    const [placeholder] = toBreakdownRows(loaded([]), "pg");
    expect(placeholder).toMatchObject({
      calls: 0,
      total_time_ns: 0,
      share: 0,
      errorRate: null,
      p50_ns: null,
      p95_ns: null,
      p99_ns: null,
      children: [],
    });
  });
});

describe("isBreakdownRow", () => {
  it("separates every child kind from a database row", () => {
    const rows = toBreakdownRows(
      loaded([row({ namespaces: ["shop"], services: ["cart"] })], 1),
      "pg",
    );
    expect(isBreakdownRow(rows[0])).toBe(true);
    expect(isBreakdownRow(rows[0].children[0])).toBe(true);
    expect(isBreakdownRow(toBreakdownRows(undefined, "pg")[0])).toBe(true);
    expect(isBreakdownRow({ rowKey: "pg" })).toBe(false);
  });
});
