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
import { buildTopologyFromTraces } from "./serviceGraphTopology";

describe("buildTopologyFromTraces — service edges", () => {
  it("builds service nodes and edges with no service_type", () => {
    const { nodes, edges } = buildTopologyFromTraces(
      [{ client: "frontend", server: "cart", total_requests: 10, errors: 1 }],
      [],
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(["cart", "frontend"]);
    expect(nodes.every((n) => n.service_type === undefined)).toBe(true);
    const e = edges.find((x) => x.from === "frontend" && x.to === "cart")!;
    expect(e.total_requests).toBe(10);
    expect(e.failed_requests).toBe(1);
  });

  it("treats a null client as an entry-point edge", () => {
    const { edges } = buildTopologyFromTraces(
      [{ client: null, server: "frontend", total_requests: 5, errors: 0 }],
      [],
    );
    expect(edges[0].from).toBeNull();
    expect(edges[0].to).toBe("frontend");
  });
});
