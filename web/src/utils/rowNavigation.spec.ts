// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { ancestorChain, nextRowTarget, nextVisibleSpan, type RowNavInput } from "./rowNavigation";

const input = (over: Partial<RowNavInput>): RowNavInput => ({
  anchor: null,
  count: 50,
  direction: 1,
  page: 1,
  pageCount: 3,
  canChangePage: true,
  isRepeat: false,
  ...over,
});

describe("nextRowTarget", () => {
  it("does nothing on an empty page", () => {
    expect(nextRowTarget(input({ count: 0 }))).toEqual({ kind: "none" });
    expect(nextRowTarget(input({ count: 0, anchor: 3, direction: -1 }))).toEqual({ kind: "none" });
  });

  it("selects the first row on J with no anchor, and does nothing on K", () => {
    expect(nextRowTarget(input({ anchor: null, direction: 1 }))).toEqual({
      kind: "select",
      index: 0,
    });
    expect(nextRowTarget(input({ anchor: null, direction: -1 }))).toEqual({ kind: "none" });
  });

  it("treats a stale anchor past the end as no anchor", () => {
    expect(nextRowTarget(input({ anchor: 50, count: 50 }))).toEqual({ kind: "select", index: 0 });
    expect(nextRowTarget(input({ anchor: 80, count: 50, direction: -1 }))).toEqual({
      kind: "none",
    });
  });

  it("steps inside the page in both directions", () => {
    expect(nextRowTarget(input({ anchor: 10 }))).toEqual({ kind: "select", index: 11 });
    expect(nextRowTarget(input({ anchor: 10, direction: -1 }))).toEqual({
      kind: "select",
      index: 9,
    });
  });

  it("crosses to the next page from the last row", () => {
    expect(nextRowTarget(input({ anchor: 49, page: 1, pageCount: 3 }))).toEqual({
      kind: "page",
      page: 2,
      position: "first",
    });
  });

  it("stops at the last row of the last page", () => {
    expect(nextRowTarget(input({ anchor: 49, page: 3, pageCount: 3 }))).toEqual({
      kind: "edge",
      edge: "last",
    });
  });

  it("stops at the last row when pages cannot change", () => {
    expect(nextRowTarget(input({ anchor: 49, canChangePage: false }))).toEqual({
      kind: "edge",
      edge: "last",
    });
  });

  it("needs a fresh keypress to cross a page", () => {
    expect(nextRowTarget(input({ anchor: 49, isRepeat: true }))).toEqual({
      kind: "edge",
      edge: "last",
    });
    expect(nextRowTarget(input({ anchor: 0, page: 2, direction: -1, isRepeat: true }))).toEqual({
      kind: "edge",
      edge: "first",
    });
  });

  it("a held key still walks rows inside the page", () => {
    expect(nextRowTarget(input({ anchor: 5, isRepeat: true }))).toEqual({
      kind: "select",
      index: 6,
    });
  });

  it("crosses to the previous page from the first row on page > 1", () => {
    expect(nextRowTarget(input({ anchor: 0, page: 2, direction: -1 }))).toEqual({
      kind: "page",
      page: 1,
      position: "last",
    });
  });

  it("stops at the first row of page 1", () => {
    expect(nextRowTarget(input({ anchor: 0, page: 1, direction: -1 }))).toEqual({
      kind: "edge",
      edge: "first",
    });
  });

  it("stops at the first row on page > 1 when pages cannot change", () => {
    expect(
      nextRowTarget(input({ anchor: 0, page: 2, direction: -1, canChangePage: false })),
    ).toEqual({ kind: "edge", edge: "first" });
  });

  it("crosses on every step with a page size of 1", () => {
    const one = { count: 1, pageCount: 5 };
    expect(nextRowTarget(input({ ...one, anchor: 0, page: 2 }))).toEqual({
      kind: "page",
      page: 3,
      position: "first",
    });
    expect(nextRowTarget(input({ ...one, anchor: 0, page: 2, direction: -1 }))).toEqual({
      kind: "page",
      page: 1,
      position: "last",
    });
    expect(nextRowTarget(input({ ...one, anchor: null }))).toEqual({ kind: "select", index: 0 });
  });
});

describe("nextVisibleSpan", () => {
  const parents: Record<string, string | undefined> = { A: "R", A1: "A", A2: "A", B: "R" };
  const ancestorsOf = (id: string) => ancestorChain(id, (s) => parents[s], 10);
  const all = ["R", "A", "A1", "A2", "B"];
  const aCollapsed = ["R", "A", "B"];

  it("returns null for an empty list", () => {
    expect(nextVisibleSpan([], null, ancestorsOf, 1)).toBeNull();
    expect(nextVisibleSpan([], "A", ancestorsOf, -1)).toBeNull();
  });

  it("starts at the first span on J with no selection, and does nothing on K", () => {
    expect(nextVisibleSpan(all, null, ancestorsOf, 1)).toBe("R");
    expect(nextVisibleSpan(all, null, ancestorsOf, -1)).toBeNull();
  });

  it("steps the visible order in both directions", () => {
    expect(nextVisibleSpan(all, "A", ancestorsOf, 1)).toBe("A1");
    expect(nextVisibleSpan(all, "A1", ancestorsOf, -1)).toBe("A");
  });

  it("walks R, A, A1, A2, B when everything is expanded", () => {
    const visited: string[] = [];
    let current: string | null = null;
    for (let i = 0; i < 5; i++) {
      current = nextVisibleSpan(all, current, ancestorsOf, 1);
      visited.push(current as string);
    }
    expect(visited).toEqual(all);
  });

  it("returns null past either end", () => {
    expect(nextVisibleSpan(all, "B", ancestorsOf, 1)).toBeNull();
    expect(nextVisibleSpan(all, "R", ancestorsOf, -1)).toBeNull();
  });

  it("skips a collapsed subtree", () => {
    expect(nextVisibleSpan(aCollapsed, "A", ancestorsOf, 1)).toBe("B");
    expect(nextVisibleSpan(aCollapsed, "B", ancestorsOf, -1)).toBe("A");
  });

  it("steps from the nearest visible ancestor when the selection is hidden", () => {
    expect(nextVisibleSpan(aCollapsed, "A1", ancestorsOf, 1)).toBe("B");
    expect(nextVisibleSpan(aCollapsed, "A1", ancestorsOf, -1)).toBe("A");
  });

  it("uses the nearest visible ancestor, not the root", () => {
    const deep: Record<string, string | undefined> = { A: "R", A1: "A", A1x: "A1", B: "R" };
    const chain = (id: string) => ancestorChain(id, (s) => deep[s], 10);
    expect(nextVisibleSpan(["R", "A", "A1", "B"], "A1x", chain, -1)).toBe("A1");
    expect(nextVisibleSpan(["R", "A", "A1", "B"], "A1x", chain, 1)).toBe("B");
  });

  it("treats a hidden selection with no visible ancestor as no selection", () => {
    expect(nextVisibleSpan(["X", "Y"], "A1", ancestorsOf, 1)).toBe("X");
    expect(nextVisibleSpan(["X", "Y"], "A1", ancestorsOf, -1)).toBeNull();
  });

  it("gives nothing after a visible ancestor that is last", () => {
    expect(nextVisibleSpan(["R", "A"], "A2", ancestorsOf, 1)).toBeNull();
  });
});

describe("ancestorChain", () => {
  it("lists ancestors nearest first and stops at a missing parent", () => {
    const parents: Record<string, string> = { c: "b", b: "a", a: "ghost" };
    expect(ancestorChain("c", (s) => parents[s], 10)).toEqual(["b", "a", "ghost"]);
  });

  it("stops on a cycle instead of looping", () => {
    const parents: Record<string, string> = { a: "b", b: "c", c: "a" };
    expect(ancestorChain("a", (s) => parents[s], 100)).toEqual(["b", "c"]);
  });

  it("stops after maxHops", () => {
    const parentOf = (s: string) => `${s}^`;
    expect(ancestorChain("x", parentOf, 3)).toEqual(["x^", "x^^", "x^^^"]);
  });

  it("treats an empty parent id as the root", () => {
    expect(ancestorChain("root", () => "", 5)).toEqual([]);
  });

  it("keeps nextVisibleSpan finite on a cyclic trace", () => {
    const parents: Record<string, string> = { a: "b", b: "a" };
    const chain = (id: string) => ancestorChain(id, (s) => parents[s], 2);
    expect(nextVisibleSpan(["z"], "a", chain, -1)).toBeNull();
    expect(nextVisibleSpan(["z"], "a", chain, 1)).toBe("z");
  });
});
