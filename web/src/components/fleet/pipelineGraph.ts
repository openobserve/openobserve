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

import type { FleetPipeline } from "@/services/fleet";
import { ratio } from "./flowIssues";
import type { FlowSignal } from "./flowTypes";

export type MapColumn = "fleet" | "destination" | "sink";

export interface MapNode {
  id: string;
  column: MapColumn;
  fleet: string;
  /** Component name, fleet id or destination id. */
  name: string;
  rate: number | null;
  failed: number;
  dropped: number;
  queue: number | null;
  failedRatio: number;
  droppedRatio: number;
  pipelines: string[];
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  /** Names the unit only; a route carrying several signals counts items. */
  signal: FlowSignal;
  rate: number | null;
  pipelines: string[];
  branch?: { kind: "failed" | "dropped"; ratio: number };
}

export interface MapLayout {
  width: number;
  nodeWidth: number;
  row: number;
  top: number;
}

export interface PipelineMap {
  nodes: MapNode[];
  edges: MapEdge[];
}

const COLUMNS: MapColumn[] = ["fleet", "destination"];
const MIN_COLUMN_GAP = 168;
const PAD = 16;
// The last column has no neighbour, so its failure branch and the label after it need their own room.
const BRANCH_ROOM = 168;
const BRANCH_REACH = 40;
export const MIN_WIDTH = 1.5;
export const MAX_WIDTH = 8;

/** Null only when both are null, so a measured zero still reads as zero. */
export const addRate = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

const maxRate = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/** Log-scaled stroke width, so a 10x busier line reads busier without drowning the rest. */
export function strokeWidth(rate: number | null, max: number): number {
  if (rate === null || rate <= 0 || max <= 0) return MIN_WIDTH;
  return MIN_WIDTH + ((MAX_WIDTH - MIN_WIDTH) * Math.log1p(rate)) / Math.log1p(max);
}

class MapBuilder {
  nodes = new Map<string, MapNode>();
  edges = new Map<string, MapEdge>();

  node(id: string, column: MapColumn, fleet: string, name: string): MapNode {
    const known = this.nodes.get(id);
    if (known) return known;
    const n: MapNode = {
      id,
      column,
      fleet,
      name,
      rate: null,
      failed: 0,
      dropped: 0,
      queue: null,
      failedRatio: 0,
      droppedRatio: 0,
      pipelines: [],
      x: 0,
      y: 0,
    };
    this.nodes.set(id, n);
    return n;
  }

  edge(id: string, source: string, target: string, p: FleetPipeline): MapEdge {
    let e = this.edges.get(id);
    if (!e) {
      e = { id, source, target, signal: p.signal, rate: null, pipelines: [] };
      this.edges.set(id, e);
    }
    if (e.signal !== p.signal) e.signal = "all";
    if (!e.pipelines.includes(p.id)) e.pipelines.push(p.id);
    return e;
  }

  touch(n: MapNode, p: FleetPipeline) {
    if (!n.pipelines.includes(p.id)) n.pipelines.push(p.id);
  }

  addDestinations(p: FleetPipeline) {
    for (const ex of p.exporters) {
      const dn = this.node(`d:${ex.destination}`, "destination", p.fleet, ex.destination);
      this.touch(dn, p);
      dn.rate = addRate(dn.rate, ex.rate);
      dn.failed += ex.failed;
      dn.dropped += ex.dropped;
      dn.queue = maxRate(dn.queue, ex.queue);
      // Per exporter, because a destination is shared and a busy healthy fleet must not dilute a failing one.
      dn.failedRatio = Math.max(dn.failedRatio, ratio(ex.failed, ex.rate));
      dn.droppedRatio = Math.max(dn.droppedRatio, ratio(ex.dropped, ex.rate));
    }
  }

  // One line per fleet and destination, whatever signals and pipelines share it.
  addRoutes(p: FleetPipeline) {
    for (const ex of p.exporters) {
      const id = `fd:${p.fleet}|${ex.destination}`;
      const e = this.edge(id, `f:${p.fleet}`, `d:${ex.destination}`, p);
      e.rate = addRate(e.rate, ex.rate);
    }
  }

  addBranches() {
    for (const dn of [...this.nodes.values()].filter((n) => n.column === "destination")) {
      if (dn.failed <= 0 && dn.dropped <= 0) continue;
      const failed = dn.failed > 0;
      const sink = this.node(`x:${dn.id}`, "sink", dn.fleet, dn.name);
      sink.pipelines = [...dn.pipelines];
      sink.rate = failed ? dn.failed : dn.dropped;
      const signals = [...this.edges.values()]
        .filter((e) => e.target === dn.id)
        .map((e) => e.signal);
      const signal = new Set(signals).size === 1 ? signals[0] : "all";
      this.edges.set(`br:${dn.id}`, {
        id: `br:${dn.id}`,
        source: dn.id,
        target: sink.id,
        signal,
        rate: sink.rate,
        pipelines: [...dn.pipelines],
        branch: {
          kind: failed ? "failed" : "dropped",
          ratio: failed ? dn.failedRatio : dn.droppedRatio,
        },
      });
    }
  }
}

function place(nodes: MapNode[], layout: MapLayout) {
  const room = nodes.some((n) => n.column === "sink") ? BRANCH_ROOM : 0;
  const gap = Math.max(
    (layout.width - 2 * PAD - layout.nodeWidth - room) / (COLUMNS.length - 1),
    MIN_COLUMN_GAP,
  );
  const columns = COLUMNS.map((c) => nodes.filter((n) => n.column === c));
  const tallest = Math.max(...columns.map((c) => c.length));
  // Each column spreads over the tallest one's height, so a short column faces the middle of its neighbours.
  columns.forEach((list, col) => {
    const spacing = (tallest * layout.row) / Math.max(list.length, 1);
    list.forEach((n, i) => {
      n.x = PAD + col * gap;
      n.y = layout.top + (spacing - layout.row) / 2 + i * spacing;
    });
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const sink of nodes.filter((n) => n.column === "sink")) {
    const from = byId.get(sink.id.slice(2));
    if (!from) continue;
    sink.x = from.x + layout.nodeWidth + BRANCH_REACH;
    sink.y = from.y + layout.row * 0.7;
  }
}

/** Fleet → destination; nodes keep the order of the pipelines they first appear in. */
export function buildPipelineMap(pipelines: FleetPipeline[], layout: MapLayout): PipelineMap {
  const b = new MapBuilder();
  for (const p of pipelines) {
    const fleetNode = b.node(`f:${p.fleet}`, "fleet", p.fleet, p.fleet);
    b.touch(fleetNode, p);
    fleetNode.rate = addRate(fleetNode.rate, p.out_rate);
    b.addDestinations(p);
    b.addRoutes(p);
  }
  b.addBranches();
  const nodes = [...b.nodes.values()];
  const order = (n: MapNode) => COLUMNS.indexOf(n.column);
  const sorted = [...nodes].sort((x, y) => order(x) - order(y));
  place(sorted, layout);
  return { nodes: sorted, edges: [...b.edges.values()] };
}
