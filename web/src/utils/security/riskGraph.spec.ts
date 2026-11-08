// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { buildRiskGraph, tierOf, type RiskRowInput } from "./riskGraph";

function row(value: string, failures: number, failureEvents = 100): RiskRowInput {
  return { value, events: 1000, failures, failureEvents, peers: 10, streams: ["auth"] };
}

describe("buildRiskGraph", () => {
  const rows = [row("alice", 5), row("bob", 90), row("carol", 40), row("dave", 0), row("eve", 60)];

  it("only contains nodes for the input entities", () => {
    const g = buildRiskGraph(rows, "user");
    const ids = new Set(rows.map((r) => `user:${r.value}`));
    expect(g.nodes).toHaveLength(rows.length);
    for (const n of g.nodes) {
      expect(ids.has(n.id)).toBe(true);
      expect(n.kind).toBe("user");
    }
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("orders nodes by base risk and chains the four riskiest in rank order", () => {
    const g = buildRiskGraph(rows, "user");
    expect(g.nodes.map((n) => n.label)).toEqual(["bob", "eve", "carol", "alice", "dave"]);
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([
      ["user:bob", "user:eve"],
      ["user:eve", "user:carol"],
      ["user:carol", "user:alice"],
    ]);
  });

  it("keeps scores in range with a consistent tier and respects the limit", () => {
    const g = buildRiskGraph(rows, "ip", 2);
    expect(g.nodes.map((n) => n.id)).toEqual(["ip:bob", "ip:eve"]);
    for (const n of g.nodes) {
      expect(n.score).toBeGreaterThanOrEqual(0);
      expect(n.score).toBeLessThanOrEqual(100);
      expect(n.tier).toBe(tierOf(n.score));
    }
  });

  it("returns an empty graph for no rows", () => {
    expect(buildRiskGraph([], "host")).toEqual({ nodes: [], edges: [] });
  });
});
