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
import { applyGraphCollapse } from "./applyGraphCollapse";

const st = (over: any = {}) => ({
  mode: "auto" as const,
  expandedKinds: new Set<string>(),
  hiddenKinds: new Set<string>(),
  threshold: 40,
  ...over,
});
const N = (id: string, service_type?: string) => ({
  id,
  label: id,
  requests: 1,
  errors: 0,
  service_type,
});

describe("applyGraphCollapse — passthrough & hidden kinds", () => {
  it("returns the graph unchanged when under threshold in auto mode", () => {
    const g = {
      nodes: [N("a"), N("db", "database")],
      edges: [{ from: "a", to: "db", total_requests: 1, failed_requests: 0 }],
    };
    const out = applyGraphCollapse(g, st());
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "db"]);
    expect(out.edges).toHaveLength(1);
  });

  it("removes hidden-kind nodes and their edges", () => {
    const g = {
      nodes: [N("a"), N("ext", "external")],
      edges: [{ from: "a", to: "ext", total_requests: 1, failed_requests: 0 }],
    };
    const out = applyGraphCollapse(g, st({ hiddenKinds: new Set(["external"]) }));
    expect(out.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(out.edges).toHaveLength(0);
  });
});
