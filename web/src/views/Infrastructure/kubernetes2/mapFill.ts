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

import type { I18nKey } from "@/types/i18n";
import {
  podStatusKnown,
  severityOf,
  type NodeRow,
  type Owner,
  type PodRow,
} from "./kubernetesModel";
import type { MapGroup } from "./kubernetesQueries";
import { withView, type K8sUrlState, type MapFill } from "./kubernetesUrlState";

export type MapRow = PodRow | NodeRow;

export type BucketClass = "b1" | "b2" | "b3" | "b4" | "b5";

export type StatusClass = "ok" | "warning" | "error";

export type FillClass = BucketClass | StatusClass | "noData";

export type NumericFill = Exclude<MapFill, "status">;

export interface RowGroup {
  id: string;
  // Node, namespace or "<Kind> <name>"; empty for the special and ungrouped blocks.
  name: string;
  special: "unscheduled" | "noOwner" | null;
  owner: Owner | null;
  // The workload's namespace; empty for other groupings.
  namespace: string;
  rows: MapRow[];
}

const REQUEST_EDGES = [25, 50, 75, 100];

// The 70/90 edges match usageBarVariant.
const LIMIT_EDGES = [50, 70, 90, 100];

export const FILL_EDGES: Record<NumericFill, readonly number[]> = {
  cpuReq: REQUEST_EDGES,
  memReq: REQUEST_EDGES,
  cpuLim: LIMIT_EDGES,
  memLim: LIMIT_EDGES,
  cpu: LIMIT_EDGES,
  memory: LIMIT_EDGES,
  restarts: [1, 2, 6, 21],
};

const BUCKETS: readonly BucketClass[] = ["b1", "b2", "b3", "b4", "b5"];

export const FILL_LABEL: Record<MapFill, I18nKey> = {
  cpuReq: "infra.k8s2.mapFillCpuReq",
  cpuLim: "infra.k8s2.mapFillCpuLim",
  memReq: "infra.k8s2.mapFillMemReq",
  memLim: "infra.k8s2.mapFillMemLim",
  restarts: "infra.k8s2.mapFillRestarts",
  cpu: "infra.k8s2.mapFillCpu",
  memory: "infra.k8s2.mapFillMemory",
  status: "infra.k8s2.mapFillStatus",
};

const LIST_SORT: Record<MapFill, string> = {
  cpuReq: "cpuReq",
  cpuLim: "cpuLim",
  memReq: "memReq",
  memLim: "memLim",
  restarts: "restarts",
  cpu: "cpu",
  memory: "memory",
  status: "warnings",
};

export function bucketOf(value: number | null, edges: readonly number[]): BucketClass | "noData" {
  if (value == null || !Number.isFinite(value) || value < 0) return "noData";
  let index = 0;
  while (index < edges.length && value >= edges[index]) index++;
  return BUCKETS[index];
}

export function fillValue(row: MapRow, fill: NumericFill): number | null {
  if (row.kind === "node") {
    if (fill === "cpu") return row.cpuPct;
    return fill === "memory" ? row.memoryPct : null;
  }
  switch (fill) {
    case "cpuReq":
      return row.cpuPctOfRequest;
    case "cpuLim":
      return row.cpuPctOfLimit;
    case "memReq":
      return row.memoryPctOfRequest;
    case "memLim":
      return row.memoryPctOfLimit;
    case "restarts":
      return row.restarts;
    default:
      return null;
  }
}

// The ⚠ column's severity first; "ok" needs a fully known status, never a guess.
export function statusClass(row: MapRow): StatusClass | "noData" {
  const severity = severityOf(row.warnings);
  if (severity) return severity;
  const known = row.kind === "pod" ? row.status != null && podStatusKnown(row) : row.ready != null;
  return known ? "ok" : "noData";
}

export function fillClass(row: MapRow, fill: MapFill): FillClass {
  return fill === "status" ? statusClass(row) : bucketOf(fillValue(row, fill), FILL_EDGES[fill]);
}

export function legendClasses(fill: MapFill): FillClass[] {
  return fill === "status" ? ["ok", "warning", "error", "noData"] : [...BUCKETS, "noData"];
}

export function bucketRanges(fill: NumericFill): string[] {
  const [a, b, c, d] = FILL_EDGES[fill];
  if (fill === "restarts") return ["0", "1", `${b}–${c - 1}`, `${c}–${d - 1}`, `> ${d - 1}`];
  return [`< ${a}%`, `${a}–${b}%`, `${b}–${c}%`, `${c}–${d}%`, `≥ ${d}%`];
}

export function groupRows(rows: MapRow[], group: MapGroup): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const spec = groupOf(row, group);
    let entry = groups.get(spec.id);
    if (!entry) groups.set(spec.id, (entry = { ...spec, rows: [] }));
    entry.rows.push(row);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.rows.length - a.rows.length ||
      Number(a.special != null) - Number(b.special != null) ||
      a.name.localeCompare(b.name) ||
      a.namespace.localeCompare(b.namespace),
  );
}

export function listTarget(state: K8sUrlState): K8sUrlState {
  return {
    ...withView(state, state.entity === "nodes" ? "nodes" : "pods"),
    search: state.search,
    sort: LIST_SORT[state.fill],
    desc: true,
  };
}

function groupOf(row: MapRow, group: MapGroup): Omit<RowGroup, "rows"> {
  const blank = { name: "", special: null, owner: null, namespace: "" };
  if (row.kind === "node" || group === "none") return { id: "all", ...blank };
  if (group === "namespace") return { ...blank, id: `ns|${row.namespace}`, name: row.namespace };
  if (group === "node") {
    return row.node
      ? { ...blank, id: `node|${row.node}`, name: row.node }
      : { ...blank, id: "unscheduled", special: "unscheduled" };
  }
  const owner = row.workload;
  if (!owner) return { ...blank, id: "noOwner", special: "noOwner" };
  return {
    id: `wl|${row.namespace}|${owner.kind}|${owner.name}`,
    name: `${owner.kind} ${owner.name}`,
    special: null,
    owner,
    namespace: row.namespace,
  };
}
