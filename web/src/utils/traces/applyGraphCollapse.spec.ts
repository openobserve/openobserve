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

describe("applyGraphCollapse — collapse", () => {
  const many = (kind: string, n: number) =>
    Array.from({ length: n }, (_, i) => N(`${kind}${i}`, kind));

  it("auto-collapses a dep kind over threshold into one boundary node", () => {
    const exts = many("external", 6);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc",
        to: e.id,
        total_requests: 2,
        failed_requests: 1,
      })),
    };
    // 7 nodes > threshold 5 → collapse
    const out = applyGraphCollapse(g, st({ threshold: 5 }));
    const group = out.nodes.find((n) => n.id === "__group_external")!;
    expect(group).toBeTruthy();
    expect(group.is_group).toBe(true);
    expect(group.member_count).toBe(6);
    expect(group.label).toContain("(6)");
    // members gone
    expect(out.nodes.some((n) => n.id === "external0")).toBe(false);
    // one aggregated edge svc → group, requests summed (6*2)
    const ge = out.edges.filter((e) => e.to === "__group_external");
    expect(ge).toHaveLength(1);
    expect(ge[0].total_requests).toBe(12);
    expect(ge[0].failed_requests).toBe(6);
    // service stays
    expect(out.nodes.some((n) => n.id === "svc")).toBe(true);
  });

  it("expanded kind shows members AND keeps the boundary node as a hub (fold-back handle)", () => {
    const exts = many("external", 6);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc",
        to: e.id,
        total_requests: 1,
        failed_requests: 0,
      })),
    };
    const out = applyGraphCollapse(
      g,
      st({ threshold: 5, expandedKinds: new Set(["external"]) }),
    );
    // Members visible…
    expect(out.nodes.some((n) => n.id === "external0")).toBe(true);
    // …AND the boundary node stays so the user can click to re-collapse.
    const boundary = out.nodes.find((n) => n.id === "__group_external");
    expect(boundary).toBeTruthy();
    expect(boundary!.is_group).toBe(true);
    // The boundary sits between caller and members: svc → boundary → member.
    expect(
      out.edges.some((e) => e.from === "svc" && e.to === "__group_external"),
    ).toBe(true);
    expect(
      out.edges.some(
        (e) => e.from === "__group_external" && e.to === "external0",
      ),
    ).toBe(true);
  });

  it("mode=expanded never collapses; mode=collapsed always collapses", () => {
    const exts = many("external", 3);
    const g = {
      nodes: [N("svc"), ...exts],
      edges: exts.map((e) => ({
        from: "svc",
        to: e.id,
        total_requests: 1,
        failed_requests: 0,
      })),
    };
    // 4 nodes < high threshold, but mode=collapsed forces it
    const forced = applyGraphCollapse(
      g,
      st({ mode: "collapsed", threshold: 999 }),
    );
    expect(forced.nodes.some((n) => n.id === "__group_external")).toBe(true);
    // mode=expanded ignores a low threshold
    const shown = applyGraphCollapse(g, st({ mode: "expanded", threshold: 1 }));
    expect(shown.nodes.some((n) => n.id === "external0")).toBe(true);
  });

  it("never collapses service nodes", () => {
    const svcs = Array.from({ length: 10 }, (_, i) => N(`s${i}`));
    const out = applyGraphCollapse(
      { nodes: svcs, edges: [] },
      st({ mode: "collapsed", threshold: 1 }),
    );
    expect(out.nodes.some((n) => n.id.startsWith("__group_"))).toBe(false);
    expect(out.nodes).toHaveLength(10);
  });
});
