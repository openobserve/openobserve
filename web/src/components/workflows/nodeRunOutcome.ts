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

// The backend never records WHICH handle a record took, so per-path counts are read off the graph: handle H's records are exactly the recorded input of the node H wires to (single-incoming tree).

import { branchEdgeLabel, branchHandles } from "@/plugins/workflows/useWorkflowCanvas";
import type { I18nText, TranslateFn } from "@/types/i18n";

interface RunResultMaps {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  errors?: Record<string, unknown>;
}

export interface BranchPathCount {
  handle: string;
  label: I18nText | "";
  count: number;
}

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

const targetOfHandle = (node: any, edges: any[], handle: string): string | undefined =>
  (edges || []).find((e: any) => e.source === node?.id && e.sourceHandle === handle)?.target;

const branchHandleCount = (
  node: any,
  edges: any[],
  result: RunResultMaps,
  handle: string,
): number => {
  const target = targetOfHandle(node, edges, handle);
  return target ? len(result?.inputs?.[target]) : 0;
};

// Per declared handle (canvas order), how many records the run routed down it.
export const branchPathCounts = (
  node: any,
  edges: any[],
  inputs: Record<string, unknown> | undefined,
  t: TranslateFn,
): BranchPathCount[] =>
  branchHandles(node).map((handle) => ({
    handle,
    label: branchEdgeLabel(node, handle, t),
    count: branchHandleCount(node, edges, { inputs }, handle),
  }));

// Runs predating the outputs map stored none, so absence falls back to downstream recorded inputs — else an old run's forwarding condition would be falsely flagged no-match.
export const forwardedRunCount = (
  node: any,
  result: RunResultMaps | null,
  edges: any[],
): number => {
  const out = result?.outputs?.[node?.id];
  if (Array.isArray(out)) return out.length;
  if (out && typeof out === "object")
    return Object.values(out).reduce((n: number, v) => n + len(v), 0);
  if (node?.data?.node_type === "branch")
    return branchHandles(node).reduce(
      (n, h) => n + branchHandleCount(node, edges, result || {}, h),
      0,
    );
  // Fan-out copies the full batch to every child, so any child's input is the count.
  for (const e of edges || []) {
    if (e.source !== node?.id) continue;
    const v = result?.inputs?.[e.target];
    if (Array.isArray(v)) return v.length;
  }
  return 0;
};

// Only node types whose JOB is filtering can "no-match" — a function/destination emitting nothing is not a match failure.
export const isNoMatchRun = (node: any, result: RunResultMaps | null, edges: any[]): boolean => {
  const type = node?.data?.node_type;
  if (!result || (type !== "condition" && type !== "branch")) return false;
  if (result.errors?.[node.id]) return false;
  if (len(result.inputs?.[node.id]) === 0) return false;
  return forwardedRunCount(node, result, edges) === 0;
};
