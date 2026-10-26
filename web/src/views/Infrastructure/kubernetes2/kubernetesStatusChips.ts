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
  podBucket,
  membersOf,
  type CronJobRow,
  type HpaRow,
  type NodeRow,
  type PodRow,
  type PvcRow,
} from "./kubernetesModel";
import type { EventRow } from "./kubernetesEvents";
import type { View } from "./kubernetesQueries";
import { statusOf, type ControllerRow, type StatusRow } from "./kubernetesStatus";

export type StatusChipId =
  | "all"
  | "running"
  | "pending"
  | "failing"
  | "completed"
  | "warnings"
  | "normal"
  | "failed"
  | "unknown"
  | "succeeded"
  | "scheduled"
  | "suspended"
  | "ready"
  | "notReady"
  | "bound"
  | "lost"
  | "scalingLimited"
  | "healthy";

export interface StatusChipDef {
  id: StatusChipId;
  label: I18nKey;
  count: number;
}

interface ChipSpec {
  id: StatusChipId;
  label: I18nKey;
  bucket: string;
}

interface ViewChips {
  classify: (row: any, pods: PodRow[]) => string;
  specs: ChipSpec[];
}

const ALL: ChipSpec = { id: "all", label: "infra.k8s2.chipAll", bucket: "" };

const LEGEND: Record<string, I18nKey> = {
  running: "infra.k8s2.workloadsLegendRunning",
  pending: "infra.k8s2.workloadsLegendPending",
  succeeded: "infra.k8s2.workloadsLegendSucceeded",
  failed: "infra.k8s2.workloadsLegendFailed",
  unknown: "infra.k8s2.workloadsLegendUnknown",
  scheduled: "infra.k8s2.workloadsLegendScheduled",
  suspended: "infra.k8s2.workloadsLegendSuspended",
};

const legendChip = (id: keyof typeof LEGEND): ChipSpec => ({
  id: id as StatusChipId,
  label: LEGEND[id],
  bucket: id,
});

const statusClassifier = (row: StatusRow, pods: PodRow[]) => statusOf(row, pods).status;

// Without member pods a controller is judged from its own counts, never as pending for lack of pods.
function replicaStatus(row: ControllerRow): "running" | "pending" | "failed" | "unknown" {
  const wanted = row.kind === "statefulset" ? row.replicas : row.desired;
  const ready = row.kind === "deployment" ? row.available : row.ready;
  if (wanted == null) return "unknown";
  if (wanted === 0 || (ready ?? 0) >= wanted) return "running";
  return (ready ?? 0) === 0 ? "failed" : "pending";
}

const controllerClassifier = (row: ControllerRow, pods: PodRow[]) =>
  membersOf(pods, row).length ? statusOf(row, pods).status : replicaStatus(row);

// Controllers read Healthy / Degraded / Unavailable, as on the Workloads overview.
const controllerChip = (id: "running" | "pending" | "failed", label: I18nKey): ChipSpec => ({
  id,
  label,
  bucket: id,
});

const CONTROLLER_CHIPS: ViewChips = {
  classify: controllerClassifier,
  specs: [
    ALL,
    controllerChip("running", "infra.k8s2.workloadWordHealthy"),
    controllerChip("pending", "infra.k8s2.workloadWordDegraded"),
    controllerChip("failed", "infra.k8s2.workloadWordUnavailable"),
    legendChip("unknown"),
  ],
};

const CHIPS: Partial<Record<View, ViewChips>> = {
  pods: {
    classify: podBucket,
    specs: [
      ALL,
      { id: "running", label: "infra.k8s2.chipRunning", bucket: "ready" },
      { id: "pending", label: "infra.k8s2.chipPending", bucket: "pending" },
      { id: "failing", label: "infra.k8s2.chipFailing", bucket: "failing" },
      { id: "completed", label: "infra.k8s2.chipCompleted", bucket: "completed" },
      { id: "unknown", label: "infra.k8s2.chipUnknown", bucket: "unknown" },
    ],
  },
  events: {
    classify: (e: EventRow) => e.type,
    specs: [
      ALL,
      { id: "warnings", label: "infra.k8s2.chipWarnings", bucket: "Warning" },
      { id: "normal", label: "infra.k8s2.chipNormal", bucket: "Normal" },
    ],
  },
  deployments: CONTROLLER_CHIPS,
  daemonsets: CONTROLLER_CHIPS,
  statefulsets: CONTROLLER_CHIPS,
  replicasets: CONTROLLER_CHIPS,
  jobs: {
    classify: statusClassifier,
    specs: [ALL, legendChip("running"), legendChip("succeeded"), legendChip("failed")],
  },
  cronjobs: {
    classify: (r: CronJobRow) => statusOf(r, []).status,
    specs: [ALL, legendChip("scheduled"), legendChip("suspended")],
  },
  nodes: {
    classify: (r: NodeRow) =>
      r.ready === "true" ? "ready" : r.ready === "false" ? "notReady" : "",
    specs: [
      ALL,
      { id: "ready", label: "infra.k8s2.nodeReady", bucket: "ready" },
      { id: "notReady", label: "infra.k8s2.chipNotReady", bucket: "notReady" },
    ],
  },
  pvcs: {
    classify: (r: PvcRow) => r.phase ?? "",
    specs: [
      ALL,
      { id: "bound", label: "infra.k8s2.chipBound", bucket: "Bound" },
      { id: "pending", label: "infra.k8s2.chipPending", bucket: "Pending" },
      { id: "lost", label: "infra.k8s2.chipLost", bucket: "Lost" },
    ],
  },
  hpas: {
    classify: (r: HpaRow) =>
      r.conditions.some((c) => c.condition === "ScalingLimited") ? "limited" : "healthy",
    specs: [
      ALL,
      { id: "scalingLimited", label: "infra.k8s2.chipScalingLimited", bucket: "limited" },
      { id: "healthy", label: "infra.k8s2.chipHealthy", bucket: "healthy" },
    ],
  },
};

export const hasStatusChip = (view: View, id: StatusChipId): boolean =>
  CHIPS[view]?.specs.some((spec) => spec.id === id) ?? false;

export function statusChipsFor(view: View, rows: any[], pods: PodRow[] = []): StatusChipDef[] {
  const chips = CHIPS[view];
  if (!chips) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = chips.classify(row, pods);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return chips.specs.map(({ id, label, bucket }) => ({
    id,
    label,
    count: id === "all" ? rows.length : (counts.get(bucket) ?? 0),
  }));
}

export function matchesStatusChip(
  view: View,
  row: any,
  id: StatusChipId,
  pods: PodRow[] = [],
): boolean {
  const chips = CHIPS[view];
  const spec = chips?.specs.find((s) => s.id === id);
  if (!chips || !spec || id === "all") return true;
  return chips.classify(row, pods) === spec.bucket;
}
