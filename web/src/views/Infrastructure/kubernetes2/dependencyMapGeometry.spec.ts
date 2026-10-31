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

import { describe, expect, it } from "vitest";
import type { Series } from "./kubernetesModel";
import {
  CARD_H,
  CARD_W,
  buildGraph,
  formatRate,
  layoutGraph,
  pairFlows,
  type Position,
} from "./dependencyGraph";
import { fitTransform, labelBox, placeLabels, routeEdge } from "./dependencyMapGeometry";

type End = [namespace: string, type: string, name: string];

const W = (namespace: string, name: string): End => [namespace, "Deployment", name];
const NODE = (name: string): End => ["", "Node", name];

const flow = (src: End, dst: End, value: number, direction = "request"): Series => ({
  metric: {
    host_id: "h1",
    k8s_cluster: "prod",
    k8s_src_namespace: src[0],
    k8s_src_owner_type: src[1],
    k8s_src_owner_name: src[2],
    k8s_dst_namespace: dst[0],
    k8s_dst_owner_type: dst[1],
    k8s_dst_owner_name: dst[2],
    direction,
  },
  value,
});

// Points along an SVG path made of M, L and C commands, a curve sampled every 1/32 of the way.
function sample(path: string): Position[] {
  const tokens = path.match(/[MLC]|-?[\d.]+(?:e-?\d+)?/g)!;
  const out: Position[] = [];
  let at: Position = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    const take = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
    if (command === "M" || command === "L") {
      const to = take();
      if (command === "L") {
        for (let k = 1; k <= 32; k++) {
          out.push({ x: at.x + ((to.x - at.x) * k) / 32, y: at.y + ((to.y - at.y) * k) / 32 });
        }
      }
      at = to;
    } else {
      const [c1, c2, to] = [take(), take(), take()];
      for (let k = 1; k <= 32; k++) {
        const t = k / 32;
        const u = 1 - t;
        out.push({
          x: u ** 3 * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x,
          y: u ** 3 * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y,
        });
      }
      at = to;
    }
  }
  return out;
}

// Strictly inside, so a route may touch the side of the card it starts or ends at.
const inside = (p: Position, card: Position) =>
  p.x > card.x + 0.5 &&
  p.x < card.x + CARD_W - 0.5 &&
  p.y > card.y + 0.5 &&
  p.y < card.y + CARD_H - 0.5;

describe("routeEdge", () => {
  // Callers in one column call ends two and three columns away, past the cards between, and nodes call back.
  const graph = buildGraph(
    pairFlows([
      flow(W("shop", "loadgen"), W("shop", "web"), 30),
      flow(W("shop", "web"), W("shop", "api"), 30),
      flow(W("shop", "api"), W("data", "db"), 30),
      flow(W("batch", "pinger"), W("data", "db"), 20),
      flow(W("batch", "cron"), W("data", "db"), 20),
      flow(W("batch", "cron"), W("data", "cache"), 20),
      flow(W("shop", "loadgen"), W("data", "cache"), 10),
      flow(NODE("n1"), W("shop", "web"), 10),
      flow(NODE("n1"), NODE("n2"), 10),
      flow(W("shop", "web"), W("shop", "auth"), 5, "unknown"),
    ]),
  );
  const { positions, waypoints } = layoutGraph(graph);

  it("routes every edge of a layered map clear of every card", () => {
    expect(waypoints.size).toBeGreaterThan(0);
    for (const e of graph.edges) {
      const route = routeEdge(
        positions.get(e.source.id)!,
        positions.get(e.target.id)!,
        waypoints.get(e.id) ?? [],
      );
      const hits = sample(route.path).filter((p) =>
        [...positions.values()].some((card) => inside(p, card)),
      );
      expect(hits, `${e.source.name} -> ${e.target.name}`).toEqual([]);
    }
  });

  it("starts and ends at the sides of the cards that face each other", () => {
    const route = routeEdge({ x: 0, y: 0 }, { x: 576, y: 200 }, [{ x: 288, y: 120 }]);
    expect(route.path).toBe(
      `M${CARD_W},${CARD_H / 2} C252,38 252,120 288,120 L${288 + CARD_W},120 C540,120 540,238 576,238`,
    );
    const back = routeEdge({ x: 288, y: 0 }, { x: 0, y: 0 }, []);
    expect(back.path.startsWith(`M288,${CARD_H / 2}`)).toBe(true);
    expect(back.path.endsWith(`${CARD_W},${CARD_H / 2}`)).toBe(true);
  });

  it("bows an edge within a column out into the gap, not into the next column", () => {
    const route = routeEdge({ x: 0, y: 0 }, { x: 0, y: 900 }, []);
    const furthest = Math.max(...sample(route.path).map((p) => p.x));
    expect(furthest).toBeGreaterThan(CARD_W);
    expect(furthest).toBeLessThan(288);
    expect(route.spots[0].x).toBeCloseTo(furthest, 0);
  });
});

describe("placeLabels", () => {
  it("places the busiest first and skips a label that would overlap a placed one or a card", () => {
    const at = { x: 252, y: 38 };
    const placed = placeLabels(
      [
        { id: "busy", text: "10.0KB/s", spots: [at] },
        { id: "same-spot", text: "1.0KB/s", spots: [at] },
        { id: "moved", text: "1.0KB/s", spots: [at, { x: 252, y: 200 }] },
        { id: "on-card", text: "1.0KB/s", spots: [{ x: 100, y: 38 }] },
      ],
      [{ x: 0, y: 0 }],
    );
    expect([...placed.keys()]).toEqual(["busy", "moved"]);
    expect(placed.get("moved")).toEqual({ x: 252, y: 200 });
  });

  it("fits a typical rate label in the gap between two columns", () => {
    const box = labelBox("174.4KB/s", { x: CARD_W + 36, y: 0 });
    expect(box.x).toBeGreaterThan(CARD_W);
    expect(box.x + box.w).toBeLessThan(288);
  });
});

describe("formatRate", () => {
  it("says a rate too small to round is under 0.1 B/s", () => {
    expect(formatRate(0.01)).toBe("<0.1B/s");
    expect(formatRate(2048)).toBe("2.0KB/s");
  });

  it.each([
    [354, "354B/s"],
    [1000, "1.0KB/s"],
    [17_818, "17.4KB/s"],
    [171_930, "168KB/s"],
    [1_048_000, "1.0MB/s"],
  ])("writes %s bytes/s in at most 3 significant digits as %s", (value, text) => {
    expect(formatRate(value)).toBe(text);
  });
});

describe("fitTransform", () => {
  it("never fits below the zoom it is given as a floor", () => {
    expect(
      fitTransform(
        [
          { x: 0, y: 0 },
          { x: 1e6, y: 0 },
        ],
        1000,
        600,
        0.1,
      ).zoom,
    ).toBe(0.1);
  });

  it("centres every point, never zoomed in past natural size", () => {
    expect(
      fitTransform(
        [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
        ],
        1000,
        600,
      ),
    ).toEqual({
      x: 450,
      y: 275,
      zoom: 1,
    });
    const wide = fitTransform(
      [
        { x: 0, y: 0 },
        { x: 4000, y: 100 },
      ],
      1000,
      600,
    );
    expect(wide.zoom).toBeLessThan(0.25);
    expect(wide.x + 4000 * wide.zoom).toBeLessThanOrEqual(1000);
  });
});
