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

import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import {
  lensPodStatus,
  membersOf,
  type CronJobRow,
  type DaemonSetRow,
  type DeploymentRow,
  type JobRow,
  type PodRow,
  type ReplicaSetRow,
  type StatefulSetRow,
} from "./kubernetesModel";

export type WorkloadStatus =
  | "running"
  | "pending"
  | "succeeded"
  | "failed"
  | "evicted"
  | "unknown"
  | "scheduled"
  | "suspended";

export type StatusKind =
  "pod" | "deployment" | "daemonset" | "statefulset" | "replicaset" | "job" | "cronjob";

export type ControllerRow = DeploymentRow | DaemonSetRow | StatefulSetRow | ReplicaSetRow;

export type StatusRow = PodRow | ControllerRow | JobRow | CronJobRow;

// `rule` marks a status decided by an OpenObserve rule rather than Lens's (zero pods, Unknown).
export interface ObjectStatus {
  status: WorkloadStatus;
  rule: boolean;
}

export interface StatusCount extends ObjectStatus {
  count: number;
  variant: ProgressBarVariant;
}

export const STATUS_VARIANT: Record<WorkloadStatus, ProgressBarVariant> = {
  running: "success",
  scheduled: "success",
  succeeded: "success",
  pending: "warning",
  suspended: "warning",
  failed: "danger",
  evicted: "danger",
  unknown: "default",
};

const CONTROLLER_ORDER: WorkloadStatus[] = ["running", "failed", "pending", "unknown"];

export const STATUS_ORDER: Record<StatusKind, WorkloadStatus[]> = {
  pod: ["running", "pending", "succeeded", "failed", "evicted", "unknown"],
  deployment: CONTROLLER_ORDER,
  daemonset: CONTROLLER_ORDER,
  statefulset: CONTROLLER_ORDER,
  replicaset: CONTROLLER_ORDER,
  job: ["succeeded", "running", "failed", "pending", "unknown"],
  cronjob: ["scheduled", "suspended"],
};

const lens = (status: WorkloadStatus): ObjectStatus => ({ status, rule: false });

const byRule = (status: WorkloadStatus): ObjectStatus => ({ status, rule: true });

export function podStatusOf(row: PodRow): ObjectStatus {
  const status = lensPodStatus(row);
  return status === "unknown" ? byRule(status) : lens(status);
}

export function controllerStatusOf(row: ControllerRow, pods: PodRow[]): ObjectStatus {
  const members = membersOf(pods, row).map(lensPodStatus);
  if (members.length === 0) {
    const desired = row.kind === "statefulset" ? row.replicas : row.desired;
    if (desired == null) return byRule("unknown");
    return byRule(desired === 0 ? "running" : "pending");
  }
  if (members.includes("failed")) return lens("failed");
  if (members.includes("pending")) return lens("pending");
  if (members.every((s) => s === "unknown")) return byRule("unknown");
  return lens("running");
}

export function jobStatusOf(row: JobRow, pods: PodRow[]): ObjectStatus {
  const members = membersOf(pods, row).map(lensPodStatus);
  if (members.length === 0) {
    if (row.complete) return byRule("succeeded");
    if ((row.failed ?? 0) > 0) return byRule("failed");
    if ((row.active ?? 0) > 0) return byRule("running");
    return byRule("unknown");
  }
  if (members.includes("failed")) return lens("failed");
  if (members.includes("pending")) return lens("pending");
  if (members.includes("running")) return lens("running");
  if (members.every((s) => s === "unknown")) return byRule("unknown");
  return lens("succeeded");
}

export function cronJobStatusOf(row: CronJobRow): ObjectStatus {
  return lens(row.suspend ? "suspended" : "scheduled");
}

export function statusOf(row: StatusRow, pods: PodRow[]): ObjectStatus {
  switch (row.kind) {
    case "pod":
      return podStatusOf(row);
    case "job":
      return jobStatusOf(row, pods);
    case "cronjob":
      return cronJobStatusOf(row);
    default:
      return controllerStatusOf(row, pods);
  }
}

export function statusCounts(kind: StatusKind, rows: StatusRow[], pods: PodRow[]): StatusCount[] {
  const counts = new Map<WorkloadStatus, { count: number; rule: boolean }>();
  for (const row of rows) {
    const { status, rule } = statusOf(row, pods);
    const entry = counts.get(status) ?? { count: 0, rule: false };
    counts.set(status, { count: entry.count + 1, rule: entry.rule || rule });
  }
  return STATUS_ORDER[kind].flatMap((status) => {
    const entry = counts.get(status);
    return entry ? [{ status, ...entry, variant: STATUS_VARIANT[status] }] : [];
  });
}
