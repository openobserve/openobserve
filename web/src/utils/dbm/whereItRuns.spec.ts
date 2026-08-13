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

import {
  buildWhereItRunsRows,
  isWhereRowActive,
  whereRowClickScope,
  type QueryBreakdownRow,
  type WhereItRunsRow,
} from "./whereItRuns";

const rows: QueryBreakdownRow[] = [
  { db_instance: "pg-primary", db_namespace: "orders", calls: 100, errors: 5, total_time_ns: 600 },
  { db_instance: "pg-primary", db_namespace: "users", calls: 50, errors: 0, total_time_ns: 200 },
  { db_instance: "pg-replica", db_namespace: "orders", calls: 40, errors: 0, total_time_ns: 200 },
];

describe("buildWhereItRunsRows", () => {
  it("ranks instances by tracked time and nests namespaces under each", () => {
    const out = buildWhereItRunsRows(rows);
    expect(out.map((row) => row.rowKey)).toEqual([
      "i:pg-primary",
      "n:pg-primary:orders",
      "n:pg-primary:users",
      "i:pg-replica",
      "n:pg-replica:orders",
    ]);
    const primary = out[0];
    expect(primary.calls).toBe(150);
    expect(primary.errors).toBe(5);
    expect(primary.totalTimeNs).toBe(800);
    // Shares are of the WHOLE query's tracked time, parents and children alike,
    // so every bar is drawn against the same total.
    expect(primary.share).toBeCloseTo(0.8);
    expect(out[1].share).toBeCloseTo(0.6);
  });

  it("derives error rate and average per call, and refuses both on zero calls", () => {
    const out = buildWhereItRunsRows(rows);
    expect(out[0].errorRate).toBeCloseTo(5 / 150);
    expect(out[0].avgNs).toBeCloseTo(800 / 150);
    const zero = buildWhereItRunsRows([{ db_instance: "idle", total_time_ns: 0 }]);
    // No calls counted: rate and average are refusals, never a fabricated 0.
    expect(zero[0].errorRate).toBeNull();
    expect(zero[0].avgNs).toBeNull();
  });

  it("skips the child for a lone unreported namespace but keeps it beside named ones", () => {
    // redis-style: the instance's only slice reported no database — a child
    // would restate the parent under a "not reported" label.
    const lone = buildWhereItRunsRows([
      { db_instance: "redis-1", db_namespace: "", calls: 10, total_time_ns: 100 },
    ]);
    expect(lone.map((row) => row.rowKey)).toEqual(["i:redis-1"]);

    // Mixed: the unnamed slice sits beside a named one, so its share must stay
    // visible — it renders, but cannot become a filter (NULL/"" ambiguity).
    const mixed = buildWhereItRunsRows([
      { db_instance: "pg-1", db_namespace: "orders", calls: 10, total_time_ns: 100 },
      { db_instance: "pg-1", db_namespace: "", calls: 5, total_time_ns: 50 },
    ]);
    const unnamed = mixed.find((row) => row.rowKey === "n:pg-1:");
    expect(unnamed).toBeDefined();
    expect(unnamed?.clickable).toBe(false);
    const named = mixed.find((row) => row.rowKey === "n:pg-1:orders");
    expect(named?.clickable).toBe(true);
  });

  it("keeps an unreported instance visible but unclickable", () => {
    const out = buildWhereItRunsRows([{ db_instance: "", calls: 3, total_time_ns: 30 }]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("");
    expect(out[0].clickable).toBe(false);
  });

  it("returns no rows for an empty breakdown", () => {
    expect(buildWhereItRunsRows([])).toEqual([]);
  });
});

describe("active row and click transitions", () => {
  const out = buildWhereItRunsRows(rows);
  const parent = out[0];
  const child = out[1] as WhereItRunsRow;

  it("marks exactly one row active per scope", () => {
    expect(isWhereRowActive(parent, { instance: "pg-primary" })).toBe(true);
    // A namespace narrows further, so the parent is no longer THE filter.
    expect(isWhereRowActive(parent, { instance: "pg-primary", namespace: "orders" })).toBe(false);
    expect(isWhereRowActive(child, { instance: "pg-primary", namespace: "orders" })).toBe(true);
    expect(isWhereRowActive(child, { instance: "pg-primary" })).toBe(false);
  });

  it("clicking focuses; clicking the active row backs out one level", () => {
    expect(whereRowClickScope(parent, {})).toEqual({
      instance: "pg-primary",
      namespace: undefined,
    });
    expect(whereRowClickScope(child, {})).toEqual({
      instance: "pg-primary",
      namespace: "orders",
    });
    // Active namespace → back to its instance.
    expect(whereRowClickScope(child, { instance: "pg-primary", namespace: "orders" })).toEqual({
      instance: "pg-primary",
      namespace: undefined,
    });
    // Active instance → back to everything.
    expect(whereRowClickScope(parent, { instance: "pg-primary" })).toEqual({
      instance: undefined,
      namespace: undefined,
    });
    // Clicking a parent while its child is focused widens to the parent.
    expect(whereRowClickScope(parent, { instance: "pg-primary", namespace: "orders" })).toEqual({
      instance: "pg-primary",
      namespace: undefined,
    });
  });

  it("refuses the click on unnamed rows", () => {
    const unnamed = buildWhereItRunsRows([{ db_instance: "", calls: 1, total_time_ns: 1 }])[0];
    expect(whereRowClickScope(unnamed, {})).toBeNull();
  });
});
