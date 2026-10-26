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

import {
  lensPodStatus,
  membersOf,
  type DeploymentRow,
  type DaemonSetRow,
  type JobRow,
  type PodRow,
  type StatefulSetRow,
  type StatusChip,
} from "./kubernetesModel";
import { controllerStatusOf, jobStatusOf, type ControllerRow } from "./kubernetesStatus";

export type ProblemKind = "deployment" | "daemonset" | "statefulset" | "job";

export interface WorkloadProblem {
  key: string;
  kind: ProblemKind;
  cluster: string;
  namespace: string;
  name: string;
  severity: "failed" | "pending";
  // Null where the kind has no ready count (a Job).
  ready: { ready: number; desired: number } | null;
  reason: StatusChip | null;
  // The member pod worth reading logs for; null when the workload has none.
  pod: PodRow | null;
}

const RANK = { failed: 0, pending: 1 } as const;

const MAX_PROBLEMS = 50;

export function workloadProblems(
  rows: {
    deployments: DeploymentRow[];
    daemonsets: DaemonSetRow[];
    statefulsets: StatefulSetRow[];
    jobs: JobRow[];
  },
  pods: PodRow[],
): { rows: WorkloadProblem[]; total: number } {
  const out: WorkloadProblem[] = [];
  const controllers: ControllerRow[] = [
    ...rows.deployments,
    ...rows.daemonsets,
    ...rows.statefulsets,
  ];
  for (const row of controllers) {
    const { status } = controllerStatusOf(row, pods);
    if (status === "failed" || status === "pending") out.push(problem(row, status, pods));
  }
  for (const row of rows.jobs) {
    // A job with pods still running is progressing, not a problem.
    if (jobStatusOf(row, pods).status === "failed") out.push(problem(row, "failed", pods));
  }
  out.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.name.localeCompare(b.name) ||
      a.namespace.localeCompare(b.namespace),
  );
  return { rows: out.slice(0, MAX_PROBLEMS), total: out.length };
}

function readyOf(row: DeploymentRow | DaemonSetRow | StatefulSetRow | JobRow) {
  switch (row.kind) {
    case "deployment":
      return row.desired == null ? null : { ready: row.available ?? 0, desired: row.desired };
    case "daemonset":
      return row.desired == null ? null : { ready: row.ready ?? 0, desired: row.desired };
    case "statefulset":
      return row.replicas == null ? null : { ready: row.ready ?? 0, desired: row.replicas };
    default:
      return null;
  }
}

export function worstPod(members: PodRow[]): PodRow | null {
  const bad = members.filter((p) => ["failed", "evicted", "pending"].includes(lensPodStatus(p)));
  const failing = bad.find((p) => lensPodStatus(p) !== "pending");
  return failing ?? bad[0] ?? members[0] ?? null;
}

function problem(
  row: ControllerRow | JobRow,
  severity: WorkloadProblem["severity"],
  pods: PodRow[],
): WorkloadProblem {
  const pod = worstPod(membersOf(pods, row));
  return {
    key: row.key,
    kind: row.kind as ProblemKind,
    cluster: row.cluster,
    namespace: row.namespace,
    name: row.name,
    severity,
    ready: row.kind === "replicaset" ? null : readyOf(row),
    reason: pod?.status ?? jobReason(row),
    pod,
  };
}

function jobReason(row: ControllerRow | JobRow): StatusChip | null {
  const text = row.kind === "job" ? row.failedReasons[0] : undefined;
  return text ? { text, variant: "error-soft" } : null;
}
