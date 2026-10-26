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

import type { DetailsRef } from "./kubernetesUrlState";
import {
  ERROR_REASONS,
  inScope,
  lensPodStatus,
  podBucket,
  podWarnings,
  type Inventory,
  type NodeRow,
  type PodRow,
  type Severity,
} from "./kubernetesModel";

export const HIGH_RESTARTS = 5;

const SCORE_FAILING = 1000;
const SCORE_NODE_NOT_READY = 900;
const SCORE_PENDING = 500;
const SCORE_RESTARTS = 100;
const MAX_RESTART_BONUS = 99;

export const ATTENTION_LIMIT = 8;

export interface AttentionItem {
  key: string;
  ref: DetailsRef;
  kind: "pod" | "node";
  name: string;
  namespace: string;
  severity: Severity;
  score: number;
  // Raw Kubernetes reasons, in the order they are shown.
  reasons: string[];
  notReady: boolean;
  restarts: number | null;
  // µs; the object's creation time, the only "since" the inventory carries.
  createdAt: number | null;
  // µs; when the object entered its current problem state, from its observed snapshot.
  sinceUs: number | null;
  canLogs: boolean;
}

export interface PodBuckets {
  ready: number;
  pending: number;
  failing: number;
  completed: number;
  unknown: number;
  total: number;
}

// Marker fields are percents of one shared track.
export interface CapacityScale {
  usagePct: number | null;
  requestsPct: number | null;
  limitsPct: number | null;
  allocatablePct: number;
  overPct: number | null;
}

const uniq = (values: (string | null | undefined)[]) => [
  ...new Set(values.filter((v): v is string => !!v)),
];

const podReasons = (pod: PodRow) =>
  uniq([
    ...pod.containers.map((c) =>
      c.waitingReason && ERROR_REASONS.has(c.waitingReason) ? c.waitingReason : null,
    ),
    pod.statusReason,
    pod.phase === "Failed" ? "Failed" : null,
    ...pod.containers.map((c) => (c.lastTerminatedReason === "OOMKilled" ? "OOMKilled" : null)),
    pod.phase === "Pending" ? "Pending" : null,
    pod.containers.map((c) => c.waitingReason).find((r) => r && !ERROR_REASONS.has(r)),
  ]);

const toUs = (time: unknown) => {
  const ms = typeof time === "string" ? Date.parse(time) : NaN;
  return Number.isFinite(ms) ? ms * 1000 : null;
};

const latest = (times: (number | null)[]) => {
  const found = times.filter((t): t is number => t != null);
  return found.length ? Math.max(...found) : null;
};

const transitionOf = (status: Record<string, any> | undefined, types: string[]) =>
  latest(
    (status?.conditions ?? [])
      .filter((c: any) => types.includes(c?.type) && c?.status !== "True")
      .map((c: any) => toUs(c.lastTransitionTime)),
  );

/** µs since the pod's current problem began, or null when its snapshot does not say. */
export function podSinceUs(pod: PodRow): number | null {
  const status = pod.object?.status;
  if (!status) return null;
  const containers: any[] = status.containerStatuses ?? [];
  const finished = (key: "state" | "lastState") =>
    latest(containers.map((c) => toUs(c?.[key]?.terminated?.finishedAt)));
  if (pod.phase === "Pending") {
    return transitionOf(status, ["PodScheduled"]) ?? transitionOf(status, ["Ready"]);
  }
  if (pod.phase === "Failed" || pod.phase === "Succeeded") return finished("state");
  return (
    transitionOf(status, ["Ready", "ContainersReady"]) ??
    finished("lastState") ??
    latest(containers.map((c) => toUs(c?.state?.running?.startedAt)))
  );
}

function scorePod(pod: PodRow): { score: number; severity: Severity } | null {
  const status = lensPodStatus(pod);
  const failing =
    status === "failed" ||
    status === "evicted" ||
    podWarnings(pod).some((w) => w.severity === "error") ||
    pod.containers.some((c) => c.lastTerminatedReason === "OOMKilled" && !c.ready);
  const restartBonus = Math.min(pod.restarts ?? 0, MAX_RESTART_BONUS);
  if (failing) return { score: SCORE_FAILING + restartBonus, severity: "error" };
  if (status === "pending") return { score: SCORE_PENDING + restartBonus, severity: "warning" };
  if ((pod.restarts ?? 0) >= HIGH_RESTARTS) {
    return { score: SCORE_RESTARTS + restartBonus, severity: "warning" };
  }
  return null;
}

function podItem(pod: PodRow, score: number, severity: Severity): AttentionItem {
  const status = lensPodStatus(pod);
  return {
    key: pod.key,
    ref: { kind: "pod", cluster: pod.cluster, namespace: pod.namespace, name: pod.name },
    kind: "pod",
    name: pod.name,
    namespace: pod.namespace,
    severity,
    score,
    reasons: podReasons(pod),
    notReady: pod.phase === "Running" && pod.ready !== "true" && status === "pending",
    restarts: pod.restarts,
    createdAt: pod.createdAt,
    sinceUs: podSinceUs(pod),
    canLogs: pod.phase !== "Pending",
  };
}

function nodeItem(node: NodeRow): AttentionItem | null {
  if (node.ready !== "false") return null;
  return {
    key: node.key,
    ref: { kind: "node", cluster: node.cluster, namespace: "", name: node.name },
    kind: "node",
    name: node.name,
    namespace: "",
    severity: "error",
    score: SCORE_NODE_NOT_READY,
    reasons: [],
    notReady: true,
    restarts: null,
    createdAt: node.createdAt,
    sinceUs: transitionOf(node.object?.status, ["Ready"]),
    canLogs: false,
  };
}

/** Failing and evicted objects first, then Pending and NotReady, then high restart counts. */
export function attentionItems(inventory: Inventory, cluster: string | null): AttentionItem[] {
  const scope = { cluster, namespaces: [] };
  const items: AttentionItem[] = [];
  for (const pod of inventory.pods) {
    if (!inScope(pod, scope)) continue;
    const scored = scorePod(pod);
    if (scored) items.push(podItem(pod, scored.score, scored.severity));
  }
  for (const node of inventory.nodes) {
    if (!inScope(node, scope)) continue;
    const item = nodeItem(node);
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function podBuckets(inventory: Inventory, cluster: string | null): PodBuckets {
  const out: PodBuckets = { ready: 0, pending: 0, failing: 0, completed: 0, unknown: 0, total: 0 };
  for (const pod of inventory.pods) {
    if (!inScope(pod, { cluster, namespaces: [] })) continue;
    out.total += 1;
    out[podBucket(pod)] += 1;
  }
  return out;
}

export const pctOf = (value: number | null, of: number | null) =>
  value != null && of != null && of > 0 ? (value / of) * 100 : null;

/** Positions usage, requests, limits and allocatable on one track that grows past allocatable when limits overcommit. */
export function capacityScale(
  usage: number | null,
  requests: number | null,
  limits: number | null,
  allocatable: number | null,
): CapacityScale | null {
  if (allocatable == null || allocatable <= 0) return null;
  const usagePct = pctOf(usage, allocatable);
  const requestsPct = pctOf(requests, allocatable);
  const limitsPct = pctOf(limits, allocatable);
  const max = Math.max(100, usagePct ?? 0, requestsPct ?? 0, limitsPct ?? 0);
  const at = (pct: number | null) => (pct == null ? null : (pct / max) * 100);
  return {
    usagePct: at(usagePct),
    requestsPct: at(requestsPct),
    limitsPct: at(limitsPct),
    allocatablePct: (100 / max) * 100,
    overPct: limitsPct != null && limitsPct > 100 ? Math.round(limitsPct - 100) : null,
  };
}
