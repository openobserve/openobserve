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
import i18n from "@/locales";
import { branchPathCounts, forwardedRunCount, isNoMatchRun } from "./nodeRunOutcome";

const t = (k: string, v?: any) => i18n.global.t(k, v ?? {}) as any;

const recs = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

const conditionNode = { id: "cond", data: { node_type: "condition" } };
const branchNode = {
  id: "br",
  data: {
    node_type: "branch",
    cases: [{ handle: "case-0", label: "Payments", conditions: { and: [{ column: "x" }] } }],
  },
};
const branchEdges = [
  { id: "e2", source: "br", sourceHandle: "case-0", target: "destA" },
  { id: "e3", source: "br", sourceHandle: "else", target: "destB" },
];

describe("forwardedRunCount", () => {
  it("reads the node's recorded outputs when present", () => {
    const result = { inputs: { cond: recs(3) }, outputs: { cond: recs(2) } };
    expect(forwardedRunCount(conditionNode, result as any, [])).toBe(2);
  });

  it("sums a per-handle outputs map (defensive contract)", () => {
    const result = { inputs: {}, outputs: { br: { "case-0": recs(2), else: recs(1) } } };
    expect(forwardedRunCount(branchNode, result as any, branchEdges)).toBe(3);
  });

  it("falls back to the child's recorded input on a run without an outputs map", () => {
    const result = { inputs: { cond: recs(3), dest: recs(3) }, outputs: {} };
    const edges = [{ id: "e2", source: "cond", target: "dest" }];
    expect(forwardedRunCount(conditionNode, result as any, edges)).toBe(3);
  });

  it("falls back to summing per-path target inputs for a branch", () => {
    const result = { inputs: { br: recs(4), destA: recs(2), destB: recs(1) }, outputs: {} };
    expect(forwardedRunCount(branchNode, result as any, branchEdges)).toBe(3);
  });
});

describe("isNoMatchRun", () => {
  it("is true for a filtering node that received records and forwarded none", () => {
    const result = { inputs: { cond: recs(3) }, outputs: {}, errors: {} };
    expect(isNoMatchRun(conditionNode, result as any, [])).toBe(true);
  });

  it("is false when the node forwarded records", () => {
    const result = { inputs: { cond: recs(3) }, outputs: { cond: recs(1) }, errors: {} };
    expect(isNoMatchRun(conditionNode, result as any, [])).toBe(false);
  });

  it("is false when nothing reached the node (that is skipped, not no-match)", () => {
    const result = { inputs: {}, outputs: {}, errors: {} };
    expect(isNoMatchRun(conditionNode, result as any, [])).toBe(false);
  });

  it("is false when the node errored (error presentation wins)", () => {
    const result = {
      inputs: { cond: recs(3) },
      outputs: {},
      errors: { cond: { error_count: 1, errors: [["boom"]] } },
    };
    expect(isNoMatchRun(conditionNode, result as any, [])).toBe(false);
  });

  it("is false for a non-filtering node type", () => {
    const fn = { id: "fn", data: { node_type: "function" } };
    const result = { inputs: { fn: recs(3) }, outputs: {}, errors: {} };
    expect(isNoMatchRun(fn, result as any, [])).toBe(false);
  });

  it("is false without a run", () => {
    expect(isNoMatchRun(conditionNode, null, [])).toBe(false);
  });
});

describe("branchPathCounts", () => {
  it("labels each declared handle like the canvas edge and counts via the target's input", () => {
    const inputs = { destA: recs(2) };
    const paths = branchPathCounts(branchNode, branchEdges, inputs as any, t);
    expect(paths.map((p) => ({ handle: p.handle, count: p.count }))).toEqual([
      { handle: "case-0", count: 2 },
      { handle: "else", count: 0 },
    ]);
    expect(String(paths[0].label)).toBe("Payments");
    expect(String(paths[1].label)).toBe("Everything Else");
  });

  it("counts 0 for a declared handle with no outgoing edge (dead end)", () => {
    const paths = branchPathCounts(branchNode, [branchEdges[1]], {} as any, t);
    expect(paths[0].count).toBe(0);
  });

  it("returns [] for a non-branch node", () => {
    expect(branchPathCounts(conditionNode, [], {} as any, t)).toEqual([]);
  });
});
