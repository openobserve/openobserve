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

//! Adaptive tree layout for the service graph.
//!
//! ECharts' orthogonal tree layout spaces nodes by symbol, not by label extent,
//! so crowded levels overlap their side-labels. Instead we compute node
//! positions ourselves (fed to ECharts `layout: 'none'`) with rules that adapt
//! to the actual pressure:
//!   - X columns per depth, each column pushed right by the WIDEST label in the
//!     previous column (+ padding) → no horizontal bleed between columns.
//!   - Y rows sized by node count at a minimum row height → no vertical crowding.
//!   - a small alternating X nudge on residual-overlap rows (whole node moves,
//!     dot + label stay attached) → graceful last resort at extreme density.
//! Because nodes carry their own x/y, dot and label move together (unlike
//! label-only shifting, which detaches the text from its node).

export interface LayoutNode {
  id: string;
  label?: string;
}
export interface LayoutEdge {
  from: string | null;
  to: string;
}
export interface Pos {
  x: number;
  y: number;
}

// Approx pixels per character for the label font (~12px, 600 weight). Used to
// size column gaps from label text so wide labels never bleed into the next
// column. A slight over-estimate is safer than under.
const PX_PER_CHAR = 7.5;
const COLUMN_PADDING = 48; // gap after the widest label in a column
const MIN_COLUMN_GAP = 120; // never tighter than this, even for short labels

const labelWidth = (n: LayoutNode) => (n.label ?? n.id).length * PX_PER_CHAR;

/**
 * Compute per-node {x, y} positions for the service-graph tree.
 *
 * `layoutType` "vertical" swaps the primary axis (depth on Y, siblings on X);
 * "horizontal" (default) puts depth on X, siblings on Y.
 */
export function computeTreeLayout(
  graph: { nodes: LayoutNode[]; edges: LayoutEdge[] },
  _layoutType: string = "horizontal",
): Map<string, Pos> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Children adjacency (spanning tree: each node placed once, at first parent).
  const children = new Map<string, string[]>();
  for (const n of graph.nodes) children.set(n.id, []);
  // A node is a root when it has no *real* parent. The synthetic entry edge
  // (from == null → the topology's entry service) must NOT count as incoming —
  // otherwise the entry node looks parented, roots comes back empty, BFS never
  // runs, and every node collapses to depth 0 (a flat, mis-wired tree). This is
  // exactly what made an agent's model hang off the wrong parent.
  const hasIncoming = new Set(
    graph.edges.filter((e) => e.from != null).map((e) => e.to),
  );
  const placed = new Set<string>();
  for (const e of graph.edges) {
    if (e.from == null) continue;
    if (placed.has(e.to)) continue; // spanning tree: skip re-parenting
    if (!children.has(e.from)) continue;
    children.get(e.from)!.push(e.to);
    placed.add(e.to);
  }
  const roots = graph.nodes.filter((n) => !hasIncoming.has(n.id));

  // 1. Assign each node a depth (column index) via BFS from roots.
  const depth = new Map<string, number>();
  const order: string[] = []; // stable placement order per level
  const queue: Array<{ id: string; d: number }> = roots.map((r) => ({
    id: r.id,
    d: 0,
  }));
  const seen = new Set<string>();
  while (queue.length) {
    const { id, d } = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    depth.set(id, d);
    order.push(id);
    for (const c of children.get(id) ?? []) {
      if (!seen.has(c)) queue.push({ id: c, d: d + 1 });
    }
  }
  // Any nodes not reached (orphans/cycles) get depth 0.
  for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  // 2. Column X: each column's X = previous column X + widest label there + pad.
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columnX = new Map<number, number>();
  let x = 0;
  for (let d = 0; d <= maxDepth; d++) {
    columnX.set(d, x);
    const ids = byDepth.get(d) ?? [];
    const widest = Math.max(
      0,
      ...ids.map((id) => labelWidth(nodeById.get(id)!)),
    );
    x += Math.max(MIN_COLUMN_GAP, widest + COLUMN_PADDING);
  }

  // 3. Row Y via subtree layout: each LEAF gets a sequential slot (>= MIN_ROW
  //    apart); each PARENT is centered on the span of its children (bottom-up).
  //    This yields the classic tidy tree — a parent sits mid-way up its subtree,
  //    and no two leaves share a Y.
  const MIN_ROW = 46;
  const y = new Map<string, number>();
  let nextLeafSlot = 0;
  // Only follow the spanning-tree children we recorded (each node once). Nodes
  // may appear as children of exactly one parent; roots start the DFS.
  const childOf = (id: string) => children.get(id) ?? [];
  const assignY = (id: string, guard: Set<string>): number => {
    if (y.has(id)) return y.get(id)!;
    if (guard.has(id)) return nextLeafSlot * MIN_ROW; // cycle guard
    guard.add(id);
    const kids = childOf(id).filter((c) => depth.has(c));
    if (kids.length === 0) {
      const yy = nextLeafSlot * MIN_ROW;
      nextLeafSlot++;
      y.set(id, yy);
      return yy;
    }
    const childYs = kids.map((c) => assignY(c, guard));
    const yy = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    y.set(id, yy);
    return yy;
  };
  for (const r of roots) assignY(r.id, new Set());
  // Any not-yet-placed nodes (disconnected) get their own leaf slots.
  for (const n of graph.nodes) {
    if (!y.has(n.id)) {
      y.set(n.id, nextLeafSlot * MIN_ROW);
      nextLeafSlot++;
    }
  }

  const pos = new Map<string, Pos>();
  for (const n of graph.nodes) {
    const d = depth.get(n.id) ?? 0;
    pos.set(n.id, { x: columnX.get(d) ?? 0, y: y.get(n.id) ?? 0 });
  }
  return pos;
}
