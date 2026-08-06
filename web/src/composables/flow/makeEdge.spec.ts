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
import { MarkerType } from "@vue-flow/core";
import makeEdgeDefault, { makeEdge } from "@/composables/flow/makeEdge";

const EDGE_COLOR = "var(--color-grey-500)";

describe("makeEdge", () => {
  describe("module exports", () => {
    it("exports the same function as named and default export", () => {
      expect(makeEdgeDefault).toBe(makeEdge);
      expect(typeof makeEdge).toBe("function");
    });
  });

  describe("without a sourceHandle", () => {
    const edge: any = makeEdge("node-a", "node-b");

    it("builds the id as e<source>-<target>", () => {
      expect(edge.id).toBe("enode-a-node-b");
    });

    it("carries the source and target", () => {
      expect(edge.source).toBe("node-a");
      expect(edge.target).toBe("node-b");
    });

    it("omits the sourceHandle key entirely", () => {
      expect(edge.sourceHandle).toBeUndefined();
      expect("sourceHandle" in edge).toBe(false);
    });

    it("uses the custom curved edge type", () => {
      expect(edge.type).toBe("custom");
    });

    it("is animated", () => {
      expect(edge.animated).toBe(true);
    });

    it("uses the shared grey token for the stroke", () => {
      expect(edge.style).toEqual({ strokeWidth: 2, stroke: EDGE_COLOR });
    });

    it("attaches a 20x20 closed arrowhead marker in the same colour", () => {
      expect(edge.markerEnd).toEqual({
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: EDGE_COLOR,
      });
    });

    it("produces exactly the documented shape", () => {
      expect(edge).toEqual({
        id: "enode-a-node-b",
        source: "node-a",
        target: "node-b",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: EDGE_COLOR,
        },
        type: "custom",
        style: { strokeWidth: 2, stroke: EDGE_COLOR },
        animated: true,
      });
    });
  });

  describe("with a sourceHandle", () => {
    const edge: any = makeEdge("a", "b", "output-1");

    it("suffixes the id with the handle", () => {
      expect(edge.id).toBe("ea-b-output-1");
    });

    it("includes the sourceHandle on the edge", () => {
      expect(edge.sourceHandle).toBe("output-1");
    });

    it("keeps every other property identical to the handle-less edge", () => {
      const plain: any = makeEdge("a", "b");
      const { id, sourceHandle, ...rest } = edge;
      const { id: plainId, ...plainRest } = plain;
      expect(rest).toEqual(plainRest);
      expect(sourceHandle).toBe("output-1");
    });
  });

  describe("falsy / edge-case handles", () => {
    it("treats an empty-string sourceHandle as absent", () => {
      const edge: any = makeEdge("a", "b", "");
      expect(edge.id).toBe("ea-b");
      expect("sourceHandle" in edge).toBe(false);
    });

    it("treats an explicit undefined sourceHandle as absent", () => {
      const edge: any = makeEdge("a", "b", undefined);
      expect(edge.id).toBe("ea-b");
      expect("sourceHandle" in edge).toBe(false);
    });

    it("keeps a numeric-string handle like '0' as a real handle", () => {
      const edge: any = makeEdge("a", "b", "0");
      expect(edge.id).toBe("ea-b-0");
      expect(edge.sourceHandle).toBe("0");
    });
  });

  describe("id generation", () => {
    it("produces distinct ids for distinct node pairs", () => {
      expect(makeEdge("a", "b").id).not.toBe(makeEdge("b", "a").id);
    });

    it("produces distinct ids for the same pair on different handles", () => {
      expect(makeEdge("a", "b", "h1").id).not.toBe(makeEdge("a", "b", "h2").id);
    });

    it("is deterministic — same args produce the same edge", () => {
      expect(makeEdge("a", "b", "h")).toEqual(makeEdge("a", "b", "h"));
    });

    it("handles uuid-style node ids", () => {
      const source = "3f2c1a7e-0b1d-4c2f-9a11-000000000001";
      const target = "3f2c1a7e-0b1d-4c2f-9a11-000000000002";
      expect(makeEdge(source, target).id).toBe(`e${source}-${target}`);
    });

    it("handles empty node ids without throwing", () => {
      const edge: any = makeEdge("", "");
      expect(edge.id).toBe("e-");
      expect(edge.source).toBe("");
      expect(edge.target).toBe("");
    });
  });

  describe("object identity", () => {
    it("returns a fresh object on every call (no shared mutable state)", () => {
      const a: any = makeEdge("a", "b");
      const b: any = makeEdge("a", "b");
      expect(a).not.toBe(b);
      expect(a.style).not.toBe(b.style);
      expect(a.markerEnd).not.toBe(b.markerEnd);

      a.style.stroke = "red";
      expect(b.style.stroke).toBe(EDGE_COLOR);
    });
  });
});
