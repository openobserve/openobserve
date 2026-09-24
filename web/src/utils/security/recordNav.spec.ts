// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";

import { displayOrder, positionOf, stepRow, type NavTable } from "./recordNav";

function fakeTable(sorted: string[], pageIndex = 0, pageSize = 2): NavTable<string> {
  const state = { pagination: { pageIndex, pageSize } };
  return {
    getSortedRowModel: () => ({ rows: sorted.map((original) => ({ original })) }),
    getState: () => state,
    setPageIndex: vi.fn((i: number) => {
      state.pagination.pageIndex = i;
    }),
  };
}

describe("recordNav", () => {
  it("follows the table's sorted order, not the source array", () => {
    const table = fakeTable(["c", "a", "b"]);
    expect(displayOrder(table, ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(stepRow(table, ["a", "b", "c"], (r) => r === "c", 1)?.row).toBe("a");
  });

  it("falls back to the given rows before the table mounts", () => {
    expect(displayOrder(null, ["x", "y"])).toEqual(["x", "y"]);
    expect(stepRow(null, ["x", "y"], (r) => r === "x", 1)).toEqual({ row: "y", index: 1 });
  });

  it("moves the table's page when a step crosses a page boundary", () => {
    const table = fakeTable(["a", "b", "c", "d"], 0, 2);
    stepRow(table, [], (r) => r === "b", 1);
    expect(table.setPageIndex).toHaveBeenCalledWith(1);
    stepRow(table, [], (r) => r === "c", -1);
    expect(table.setPageIndex).toHaveBeenLastCalledWith(0);
  });

  it("stops at either end and when the current row is gone", () => {
    const table = fakeTable(["a", "b"]);
    expect(stepRow(table, [], (r) => r === "b", 1)).toBeNull();
    expect(stepRow(table, [], (r) => r === "a", -1)).toBeNull();
    expect(stepRow(table, [], (r) => r === "zz", 1)).toBeNull();
    expect(positionOf(["a"], (r) => r === "zz")).toBeNull();
  });
});
