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
import { computeTreeLayout } from "./computeTreeLayout";

// Minimal graph node/edge shapes the layout needs.
const N = (id: string, label = id) => ({ id, label });
const E = (from: string, to: string) => ({ from, to });

describe("computeTreeLayout — entry-edge roots (agent-graph regression)", () => {
  it("treats a node reached only by the entry edge (from=null) as a root, so its subtree gets real depth", () => {
    // The service-graph API emits a synthetic entry edge {from: null → entry}.
    // Shape: (entry) → orchestrator → {Supervisor, Worker}; Worker → gpt-4o.
    // Bug: the entry edge counted `orchestrator` as having an incoming parent,
    // so roots was empty, BFS never ran, and EVERY node collapsed to depth 0 —
    // which drew gpt-4o hanging off the wrong parent instead of under Worker.
    const g = {
      nodes: [N("orchestrator"), N("Supervisor"), N("Worker"), N("gpt-4o"), N("run_query")],
      edges: [
        { from: null, to: "orchestrator" },
        E("orchestrator", "Supervisor"),
        E("orchestrator", "Worker"),
        E("Worker", "gpt-4o"),
        E("Worker", "run_query"),
      ],
    };
    const pos = computeTreeLayout(g as any);
    // Depth increases down the real hierarchy — not all-flat.
    expect(pos.get("Supervisor")!.x).toBeGreaterThan(pos.get("orchestrator")!.x);
    expect(pos.get("Worker")!.x).toBeGreaterThan(pos.get("orchestrator")!.x);
    // The model sits BEYOND its agent (Worker), i.e. it is Worker's child.
    expect(pos.get("gpt-4o")!.x).toBeGreaterThan(pos.get("Worker")!.x);
    expect(pos.get("run_query")!.x).toBeGreaterThan(pos.get("Worker")!.x);
    // gpt-4o and Supervisor are NOT in the same column (the collapse symptom).
    expect(pos.get("gpt-4o")!.x).not.toBe(pos.get("Supervisor")!.x);
  });
});

describe("computeTreeLayout — columns (X by depth)", () => {
  it("places each depth level in its own column (root left, deps right)", () => {
    // root → a → dep
    const g = {
      nodes: [N("root"), N("a"), N("dep")],
      edges: [E("root", "a"), E("a", "dep")],
    };
    const pos = computeTreeLayout(g);
    // deeper nodes are further right.
    expect(pos.get("a")!.x).toBeGreaterThan(pos.get("root")!.x);
    expect(pos.get("dep")!.x).toBeGreaterThan(pos.get("a")!.x);
  });

  it("pushes the next column further right when the previous column has long labels", () => {
    // Two roots with very different label lengths, each with one child. The
    // child column X should clear the widest label in the parent column.
    const gShort = {
      nodes: [N("r", "r"), N("c", "c")],
      edges: [E("r", "c")],
    };
    const gLong = {
      nodes: [N("r", "a-very-long-service-name-that-is-wide"), N("c", "c")],
      edges: [E("r", "c")],
    };
    const short = computeTreeLayout(gShort);
    const long = computeTreeLayout(gLong);
    // The child sits further right when the parent label is longer.
    expect(long.get("c")!.x).toBeGreaterThan(short.get("c")!.x);
  });
});

describe("computeTreeLayout — rows (Y)", () => {
  it("spaces sibling rows by at least the minimum row height", () => {
    const g = {
      nodes: [N("root"), N("a"), N("b"), N("c")],
      edges: [E("root", "a"), E("root", "b"), E("root", "c")],
    };
    const pos = computeTreeLayout(g);
    const ys = ["a", "b", "c"].map((id) => pos.get(id)!.y).sort((p, q) => p - q);
    // adjacent siblings at least MIN_ROW apart (46).
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(46);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(46);
  });

  it("centers a parent vertically among its children", () => {
    const g = {
      nodes: [N("root"), N("a"), N("b"), N("c")],
      edges: [E("root", "a"), E("root", "b"), E("root", "c")],
    };
    const pos = computeTreeLayout(g);
    const rootY = pos.get("root")!.y;
    const childYs = ["a", "b", "c"].map((id) => pos.get(id)!.y);
    const mid = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    // root is centered on the midpoint of its children (within a small epsilon).
    expect(Math.abs(rootY - mid)).toBeLessThan(1);
  });

  it("leaf nodes get distinct, non-overlapping Y positions", () => {
    // Two parents, each with two leaves — 4 leaves must not overlap.
    const g = {
      nodes: [N("p1"), N("p2"), N("l1"), N("l2"), N("l3"), N("l4")],
      edges: [E("p1", "l1"), E("p1", "l2"), E("p2", "l3"), E("p2", "l4")],
    };
    const pos = computeTreeLayout(g);
    const leafYs = ["l1", "l2", "l3", "l4"].map((id) => pos.get(id)!.y);
    expect(new Set(leafYs).size).toBe(4); // all distinct
  });
});
