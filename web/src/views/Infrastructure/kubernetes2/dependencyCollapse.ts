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

import type { FlowEdge, FlowEnd } from "./dependencyGraph";

export type { CollapseMode } from "@/utils/traces/applyGraphCollapse";
import type { CollapseMode } from "@/utils/traces/applyGraphCollapse";

export interface CollapseState {
  mode: CollapseMode;
  expanded: ReadonlySet<string>;
  threshold: number;
}

export const COLLAPSE_THRESHOLD = 40;

const BOUNDARY_PREFIX = "__ns__";

export const namespaceId = (cluster: string, namespace: string) => `${cluster}/${namespace}`;

export const isBoundary = (end: FlowEnd) => end.group === true;

export function shouldCollapse(edges: FlowEdge[], state: CollapseState): boolean {
  if (state.mode === "collapsed") return true;
  if (state.mode === "expanded") return false;
  const ends = new Set<string>();
  for (const e of edges) {
    ends.add(e.source.id);
    ends.add(e.target.id);
  }
  return ends.size > state.threshold;
}

interface Merge {
  a: FlowEnd;
  b: FlowEnd;
  ab: number;
  ba: number;
  aClient: number;
  bClient: number;
  request: number;
  response: number;
  unknown: number;
}

export function collapseNamespaces(edges: FlowEdge[], state: CollapseState): FlowEdge[] {
  if (!shouldCollapse(edges, state)) return edges;
  const foldable = (end: FlowEnd) =>
    end.kind === "workload" && !state.expanded.has(namespaceId(end.cluster, end.namespace));
  const groupOf = (end: FlowEnd) =>
    foldable(end) ? namespaceId(end.cluster, end.namespace) : end.id;
  const linked = new Set<string>();
  // A namespace whose traffic never leaves it would have no edge left to draw, so it stays as its workloads.
  for (const e of edges) {
    if (groupOf(e.source) === groupOf(e.target)) continue;
    for (const end of [e.source, e.target]) if (foldable(end)) linked.add(groupOf(end));
  }
  const members = new Map<string, Set<string>>();
  const boundaries = new Map<string, FlowEnd>();
  const fold = (end: FlowEnd): FlowEnd => {
    if (!foldable(end) || !linked.has(groupOf(end))) return end;
    const id = `${BOUNDARY_PREFIX}${namespaceId(end.cluster, end.namespace)}`;
    if (!boundaries.has(id)) {
      boundaries.set(id, {
        id,
        kind: "workload",
        cluster: end.cluster,
        namespace: end.namespace,
        name: end.namespace,
        ownerType: "Namespace",
        group: true,
      });
      members.set(id, new Set());
    }
    members.get(id)!.add(end.id);
    return boundaries.get(id)!;
  };

  const kept: FlowEdge[] = [];
  const merges = new Map<string, Merge>();
  for (const e of edges) {
    const source = fold(e.source);
    const target = fold(e.target);
    if (source === e.source && target === e.target) {
      kept.push(e);
      continue;
    }
    if (source.id === target.id) continue;
    const [a, b] = source.id < target.id ? [source, target] : [target, source];
    const key = `${a.id}\n${b.id}`;
    let m = merges.get(key);
    if (!m) {
      m = { a, b, ab: 0, ba: 0, aClient: 0, bClient: 0, request: 0, response: 0, unknown: 0 };
      merges.set(key, m);
    }
    const fromA = source.id === a.id;
    m.ab += fromA ? e.forward : e.backward;
    m.ba += fromA ? e.backward : e.forward;
    m.request += e.request;
    m.response += e.response;
    m.unknown += e.unknown;
    // A directed edge's bytes are evidence for its source being the client.
    if (e.directed) {
      if (fromA) m.aClient += e.total;
      else m.bClient += e.total;
    }
  }
  for (const [id, set] of members) boundaries.get(id)!.members = set.size;

  const merged = [...merges.entries()].map(([id, m]): FlowEdge => {
    const total = m.ab + m.ba;
    const directed = Math.max(m.aClient, m.bClient) > total / 2;
    const flip = directed && m.bClient > m.aClient;
    return {
      id,
      source: flip ? m.b : m.a,
      target: flip ? m.a : m.b,
      directed,
      forward: flip ? m.ba : m.ab,
      backward: flip ? m.ab : m.ba,
      request: m.request,
      response: m.response,
      unknown: m.unknown,
      total,
    };
  });
  return [...kept, ...merged];
}
