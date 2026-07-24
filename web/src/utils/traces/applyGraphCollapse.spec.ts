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

  it("collapses a caller's externals into ITS OWN boundary node (per-caller)", () => {
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
    const group = out.nodes.find((n) => n.id === "__group_external__svc")!;
    expect(group).toBeTruthy();
    expect(group.is_group).toBe(true);
    expect(group.member_count).toBe(6);
    expect(group.label).toContain("(6)");
    expect(out.nodes.some((n) => n.id === "external0")).toBe(false);
    // svc → its own boundary, requests summed (6*2)
    const ge = out.edges.filter((e) => e.to === "__group_external__svc");
    expect(ge).toHaveLength(1);
    expect(ge[0].from).toBe("svc");
    expect(ge[0].total_requests).toBe(12);
    expect(ge[0].failed_requests).toBe(6);
    expect(out.nodes.some((n) => n.id === "svc")).toBe(true);
  });

  it("gives EACH caller its own group of only the externals IT calls (the real bug)", () => {
    // payment→{e0,e1}, product→{e2}, and e0 is ALSO shared by product.
    const g = {
      nodes: [
        N("payment"),
        N("product"),
        N("e0", "external"),
        N("e1", "external"),
        N("e2", "external"),
      ],
      edges: [
        { from: "payment", to: "e0", total_requests: 1, failed_requests: 0 },
        { from: "payment", to: "e1", total_requests: 1, failed_requests: 0 },
        { from: "product", to: "e2", total_requests: 1, failed_requests: 0 },
        { from: "product", to: "e0", total_requests: 1, failed_requests: 0 },
      ],
    };
    const out = applyGraphCollapse(g, st({ mode: "collapsed", threshold: 1 }));
    const paymentGrp = out.nodes.find((n) => n.id === "__group_external__payment");
    const productGrp = out.nodes.find((n) => n.id === "__group_external__product");
    // Two SEPARATE per-caller groups — not one global node.
    expect(paymentGrp!.member_count).toBe(2); // e0, e1
    expect(productGrp!.member_count).toBe(2); // e2, e0 (shared)
    // Each caller points only at its own group.
    expect(
      out.edges.some((e) => e.from === "payment" && e.to === "__group_external__payment"),
    ).toBe(true);
    expect(
      out.edges.some((e) => e.from === "product" && e.to === "__group_external__product"),
    ).toBe(true);
    // No cross-wiring: payment must NOT point at product's group.
    expect(
      out.edges.some((e) => e.from === "payment" && e.to === "__group_external__product"),
    ).toBe(false);
  });

  it("expanded kind shows members under EACH caller's boundary (fold-back handle)", () => {
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
    const out = applyGraphCollapse(g, st({ threshold: 5, expandedKinds: new Set(["external"]) }));
    expect(out.nodes.some((n) => n.id === "external0")).toBe(true);
    const boundary = out.nodes.find((n) => n.id === "__group_external__svc");
    expect(boundary).toBeTruthy();
    expect(boundary!.is_group).toBe(true);
    // svc → boundary → member.
    expect(out.edges.some((e) => e.from === "svc" && e.to === "__group_external__svc")).toBe(true);
    expect(out.edges.some((e) => e.from === "__group_external__svc" && e.to === "external0")).toBe(
      true,
    );
  });

  it("expandedGroups expands ONLY the clicked caller's group, not the whole kind", () => {
    // Two callers each with their own externals, both collapsed. Expanding only
    // payment's boundary id must reveal payment's members while product's group
    // stays collapsed (its members hidden). This is the per-group drill-in — the
    // fix for "clicking one External group expands every External group".
    const g = {
      nodes: [
        N("payment"),
        N("product"),
        N("pe0", "external"),
        N("pe1", "external"),
        N("qe0", "external"),
        N("qe1", "external"),
      ],
      edges: [
        { from: "payment", to: "pe0", total_requests: 1, failed_requests: 0 },
        { from: "payment", to: "pe1", total_requests: 1, failed_requests: 0 },
        { from: "product", to: "qe0", total_requests: 1, failed_requests: 0 },
        { from: "product", to: "qe1", total_requests: 1, failed_requests: 0 },
      ],
    };
    const out = applyGraphCollapse(
      g,
      st({
        mode: "collapsed",
        threshold: 1,
        expandedGroups: new Set(["__group_external__payment"]),
      }),
    );
    // payment's group is a hub: its members are visible + boundary→member edges.
    expect(out.nodes.some((n) => n.id === "pe0")).toBe(true);
    expect(out.nodes.some((n) => n.id === "pe1")).toBe(true);
    expect(out.edges.some((e) => e.from === "__group_external__payment" && e.to === "pe0")).toBe(
      true,
    );
    const paymentGrp = out.nodes.find((n) => n.id === "__group_external__payment")!;
    expect(paymentGrp.is_expanded).toBe(true);
    // product's group stays COLLAPSED: its members remain hidden.
    expect(out.nodes.some((n) => n.id === "qe0")).toBe(false);
    expect(out.nodes.some((n) => n.id === "qe1")).toBe(false);
    const productGrp = out.nodes.find((n) => n.id === "__group_external__product")!;
    expect(productGrp.is_expanded).toBe(false);
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
    const forced = applyGraphCollapse(g, st({ mode: "collapsed", threshold: 999 }));
    expect(forced.nodes.some((n) => n.id === "__group_external__svc")).toBe(true);
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
