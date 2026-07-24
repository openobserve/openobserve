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
import detectCycleDefault, { detectCycle } from "@/composables/flow/detectCycle";

// Plain edge shape (pipelines / raw edges persisted on the pipeline object)
const plain = (source: string, target: string) => ({ source, target });

// VueFlow runtime-enriched edge shape (graph edges from useVueFlow)
const vf = (source: string, target: string) => ({
  sourceNode: { id: source },
  targetNode: { id: target },
});

describe("detectCycle", () => {
  describe("module exports", () => {
    it("exports the same function as named and default export", () => {
      expect(detectCycleDefault).toBe(detectCycle);
      expect(typeof detectCycle).toBe("function");
    });
  });

  describe("plain {source,target} edges", () => {
    it("returns false for an empty graph with a fresh connection", () => {
      expect(detectCycle([], { source: "a", target: "b" })).toBe(false);
    });

    it("returns false for a linear chain a->b->c when adding c->d", () => {
      const edges = [plain("a", "b"), plain("b", "c")];
      expect(detectCycle(edges, { source: "c", target: "d" })).toBe(false);
    });

    it("returns true when the connection closes a 2-node cycle (a->b, b->a)", () => {
      const edges = [plain("a", "b")];
      expect(detectCycle(edges, { source: "b", target: "a" })).toBe(true);
    });

    it("returns true when the connection closes a long cycle (a->b->c->d, d->a)", () => {
      const edges = [plain("a", "b"), plain("b", "c"), plain("c", "d")];
      expect(detectCycle(edges, { source: "d", target: "a" })).toBe(true);
    });

    it("returns true for a self-loop connection (a->a)", () => {
      expect(detectCycle([], { source: "a", target: "a" })).toBe(true);
    });

    it("returns true for a self-loop connection even with unrelated edges present", () => {
      const edges = [plain("x", "y")];
      expect(detectCycle(edges, { source: "n", target: "n" })).toBe(true);
    });

    it("returns false when the new connection points into a separate branch (diamond, no cycle)", () => {
      // a->b, a->c, b->d ; adding c->d keeps it a DAG
      const edges = [plain("a", "b"), plain("a", "c"), plain("b", "d")];
      expect(detectCycle(edges, { source: "c", target: "d" })).toBe(false);
    });

    it("returns false when a cycle exists in a disconnected component not reachable from the connection", () => {
      // x->y->x already cyclical, but we start the DFS at `a`
      const edges = [plain("x", "y"), plain("y", "x")];
      expect(detectCycle(edges, { source: "a", target: "b" })).toBe(false);
    });

    it("returns true when a pre-existing cycle is reachable from the new connection's target", () => {
      const edges = [plain("x", "y"), plain("y", "x")];
      expect(detectCycle(edges, { source: "a", target: "x" })).toBe(true);
    });

    it("tolerates duplicate edges without reporting a false cycle", () => {
      const edges = [plain("a", "b"), plain("a", "b")];
      expect(detectCycle(edges, { source: "b", target: "c" })).toBe(false);
    });

    it("returns true when a node fans out and one branch loops back", () => {
      // a->b, a->c, c->a would be a cycle
      const edges = [plain("a", "b"), plain("a", "c")];
      expect(detectCycle(edges, { source: "c", target: "a" })).toBe(true);
    });

    it("handles a re-convergent DAG where a node is visited twice without a cycle", () => {
      // a->b, a->c, b->d, c->d, d->e ; adding e->f is safe
      const edges = [
        plain("a", "b"),
        plain("a", "c"),
        plain("b", "d"),
        plain("c", "d"),
        plain("d", "e"),
      ];
      expect(detectCycle(edges, { source: "e", target: "f" })).toBe(false);
    });
  });

  describe("VueFlow {sourceNode,targetNode} edges", () => {
    it("normalizes sourceNode.id / targetNode.id and detects a cycle", () => {
      const edges = [vf("a", "b"), vf("b", "c")];
      expect(detectCycle(edges, { source: "c", target: "a" })).toBe(true);
    });

    it("normalizes sourceNode.id / targetNode.id and returns false for a DAG", () => {
      const edges = [vf("a", "b"), vf("b", "c")];
      expect(detectCycle(edges, { source: "c", target: "d" })).toBe(false);
    });

    it("handles a mix of plain and VueFlow edge shapes in the same list", () => {
      const edges = [plain("a", "b"), vf("b", "c"), plain("c", "d")];
      expect(detectCycle(edges, { source: "d", target: "a" })).toBe(true);
      expect(detectCycle(edges, { source: "d", target: "e" })).toBe(false);
    });

    it("prefers the plain `source`/`target` fields when both shapes are present", () => {
      // VueFlow edges carry BOTH; the plain fields win (?? short-circuits)
      const edges = [
        { source: "a", target: "b", sourceNode: { id: "z" }, targetNode: { id: "z" } },
      ];
      // a->b + b->a is a cycle only if the plain fields were used
      expect(detectCycle(edges, { source: "b", target: "a" })).toBe(true);
      // and the sourceNode ids ("z") must not have created a z->z self-loop
      expect(detectCycle(edges, { source: "z", target: "q" })).toBe(false);
    });
  });

  describe("null / undefined / malformed input", () => {
    it("returns false when edges is null", () => {
      expect(detectCycle(null as any, { source: "a", target: "b" })).toBe(false);
    });

    it("returns false when edges is undefined", () => {
      expect(detectCycle(undefined as any, { source: "a", target: "b" })).toBe(false);
    });

    it("still detects a self-loop when edges is null", () => {
      expect(detectCycle(null as any, { source: "a", target: "a" })).toBe(true);
    });

    it("returns false when the connection is null", () => {
      expect(detectCycle([plain("a", "b")], null)).toBe(false);
    });

    it("returns false when the connection is undefined", () => {
      expect(detectCycle([plain("a", "b")], undefined)).toBe(false);
    });

    it("returns false when the connection has no source", () => {
      expect(detectCycle([plain("a", "b")], { target: "a" })).toBe(false);
    });

    it("returns false when the connection has no target", () => {
      expect(detectCycle([plain("a", "b")], { source: "b" })).toBe(false);
    });

    it("returns false when connection.source is null", () => {
      expect(detectCycle([plain("a", "b")], { source: null, target: "a" })).toBe(false);
    });

    it("returns false when connection.target is null", () => {
      expect(detectCycle([plain("a", "b")], { source: "b", target: null })).toBe(false);
    });

    it("skips edges missing a source", () => {
      const edges = [{ target: "a" }, plain("a", "b")];
      expect(detectCycle(edges, { source: "b", target: "a" })).toBe(true);
      expect(detectCycle(edges, { source: "b", target: "c" })).toBe(false);
    });

    it("skips edges missing a target", () => {
      const edges = [{ source: "b" }, plain("a", "b")];
      expect(detectCycle(edges, { source: "b", target: "c" })).toBe(false);
    });

    it("skips null / undefined entries inside the edges array", () => {
      const edges = [null, undefined, plain("a", "b")];
      expect(detectCycle(edges as any, { source: "b", target: "a" })).toBe(true);
    });

    it("skips edges whose sourceNode/targetNode are missing an id", () => {
      const edges = [{ sourceNode: {}, targetNode: {} }, plain("a", "b")];
      expect(detectCycle(edges as any, { source: "b", target: "c" })).toBe(false);
    });

    it("skips completely empty edge objects", () => {
      expect(detectCycle([{}], { source: "a", target: "b" })).toBe(false);
    });
  });

  describe("realistic canvas scenarios", () => {
    it("allows a workflow trigger -> condition -> destination chain", () => {
      const edges = [plain("trigger", "condition")];
      expect(detectCycle(edges, { source: "condition", target: "destination" })).toBe(false);
    });

    it("blocks wiring a destination back into the trigger", () => {
      const edges = [
        plain("trigger", "condition"),
        plain("condition", "function"),
        plain("function", "destination"),
      ];
      expect(detectCycle(edges, { source: "destination", target: "trigger" })).toBe(true);
    });

    it("blocks a mid-chain back edge (function -> condition)", () => {
      const edges = [plain("trigger", "condition"), plain("condition", "function")];
      expect(detectCycle(edges, { source: "function", target: "condition" })).toBe(true);
    });

    it("does not mutate the edges array passed in", () => {
      const edges = [plain("a", "b")];
      const snapshot = JSON.parse(JSON.stringify(edges));
      detectCycle(edges, { source: "b", target: "a" });
      expect(edges).toEqual(snapshot);
      expect(edges).toHaveLength(1);
    });

    it("does not mutate the connection object passed in", () => {
      const connection: any = { source: "b", target: "a" };
      detectCycle([plain("a", "b")], connection);
      expect(connection).toEqual({ source: "b", target: "a" });
    });
  });
});
