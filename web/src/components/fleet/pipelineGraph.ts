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
import type { Telemetry } from "./flowTypes";

export type MapColumn = "fleet" | "receiver" | "exporter" | "destination" | "sink";

export interface MapNode {
  id: string;
  column: MapColumn;
  fleet: string;
  /** Component name, fleet id or destination id. */
  name: string;
  rate: number | null;
  failed: number;
  dropped: number;
  refused: number;
  queue: number | null;
  pipelines: string[];
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  signal: Telemetry;
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

const COLUMNS: MapColumn[] = ["fleet", "receiver", "exporter", "destination"];
const MIN_COLUMN_GAP = 168;
const PAD = 16;
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

function receiverShare(p: FleetPipeline, rate: number | null): number {
  const total = p.receivers.reduce((sum, r) => sum + (r.rate ?? 0), 0);
  return total > 0 && rate !== null ? rate / total : 1 / Math.max(p.receivers.length, 1);
}

class MapBuilder {
  nodes = new Map<string, MapNode>();
  edges = new Map<string, MapEdge>();
  receiverRates = new Map<string, Map<Telemetry, number | null>>();

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
      refused: 0,
      queue: null,
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
    if (!e.pipelines.includes(p.id)) e.pipelines.push(p.id);
    return e;
  }

  touch(n: MapNode, p: FleetPipeline) {
    if (!n.pipelines.includes(p.id)) n.pipelines.push(p.id);
  }

  addExporters(p: FleetPipeline) {
    for (const ex of p.exporters) {
      const en = this.node(`e:${p.fleet}|${ex.name}`, "exporter", p.fleet, ex.name);
      this.touch(en, p);
      en.rate = addRate(en.rate, ex.rate);
      en.failed += ex.failed;
      en.dropped += ex.dropped;
      en.queue = maxRate(en.queue, ex.queue);
      const dn = this.node(`d:${ex.destination}`, "destination", p.fleet, ex.destination);
      this.touch(dn, p);
      dn.rate = addRate(dn.rate, ex.rate);
      const ed = this.edge(
        `ed:${p.fleet}|${ex.name}|${ex.destination}|${p.signal}`,
        en.id,
        dn.id,
        p,
      );
      ed.rate = addRate(ed.rate, ex.rate);
    }
  }

  // A receiver feeding several pipelines of one signal copies its full rate to each, so those count once.
  addReceivers(p: FleetPipeline, fleetNode: MapNode) {
    for (const r of p.receivers) {
      const rn = this.node(`r:${p.fleet}|${r.name}`, "receiver", p.fleet, r.name);
      this.touch(rn, p);
      const bySignal = this.receiverRates.get(rn.id) ?? new Map<Telemetry, number | null>();
      bySignal.set(p.signal, maxRate(bySignal.get(p.signal) ?? null, r.rate));
      this.receiverRates.set(rn.id, bySignal);
      rn.rate = [...bySignal.values()].reduce<number | null>((sum, v) => addRate(sum, v), null);
      rn.refused = Math.max(rn.refused, r.refused);
      const fr = this.edge(`fr:${p.fleet}|${r.name}|${p.signal}`, fleetNode.id, rn.id, p);
      fr.rate = maxRate(fr.rate, r.rate);
      const share = receiverShare(p, r.rate);
      for (const ex of p.exporters) {
        const id = `re:${p.fleet}|${r.name}|${ex.name}|${p.signal}`;
        const re = this.edge(id, rn.id, `e:${p.fleet}|${ex.name}`, p);
        re.rate = addRate(re.rate, ex.rate === null ? null : ex.rate * share);
      }
    }
  }

  addBranches() {
    for (const en of [...this.nodes.values()].filter((n) => n.column === "exporter")) {
      if (en.failed <= 0 && en.dropped <= 0) continue;
      const failed = en.failed > 0;
      const sink = this.node(`x:${en.id}`, "sink", en.fleet, en.name);
      sink.pipelines = [...en.pipelines];
      sink.rate = failed ? en.failed : en.dropped;
      const signal = [...this.edges.values()].find((e) => e.target === en.id)?.signal ?? "logs";
      this.edges.set(`br:${en.id}`, {
        id: `br:${en.id}`,
        source: en.id,
        target: sink.id,
        signal,
        rate: sink.rate,
        pipelines: [...en.pipelines],
        branch: {
          kind: failed ? "failed" : "dropped",
          ratio: ratio(failed ? en.failed : en.dropped, en.rate),
        },
      });
    }
  }
}

function place(nodes: MapNode[], layout: MapLayout) {
  const gap = Math.max(
    (layout.width - 2 * PAD - layout.nodeWidth) / (COLUMNS.length - 1),
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
    sink.x = from.x + layout.nodeWidth / 2 + gap / 2;
    sink.y = from.y + layout.row * 0.7;
  }
}

/** Fleet → receiver → exporter → destination; nodes keep the order of the pipelines they first appear in. */
export function buildPipelineMap(pipelines: FleetPipeline[], layout: MapLayout): PipelineMap {
  const b = new MapBuilder();
  for (const p of pipelines) {
    const fleetNode = b.node(`f:${p.fleet}`, "fleet", p.fleet, p.fleet);
    b.touch(fleetNode, p);
    fleetNode.rate = addRate(fleetNode.rate, p.out_rate);
    b.addExporters(p);
  }
  for (const p of pipelines) b.addReceivers(p, b.node(`f:${p.fleet}`, "fleet", p.fleet, p.fleet));
  b.addBranches();
  const nodes = [...b.nodes.values()];
  const order = (n: MapNode) => COLUMNS.indexOf(n.column);
  const sorted = [...nodes].sort((x, y) => order(x) - order(y));
  place(sorted, layout);
  return { nodes: sorted, edges: [...b.edges.values()] };
}
