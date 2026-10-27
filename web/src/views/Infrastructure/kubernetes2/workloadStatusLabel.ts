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
import type { StatusKind, WorkloadStatus } from "./kubernetesStatus";

const CONTROLLER_KINDS: readonly StatusKind[] = [
  "deployment",
  "daemonset",
  "statefulset",
  "replicaset",
];

const CONTROLLER_WORD: Partial<Record<WorkloadStatus, I18nKey>> = {
  running: "infra.k8s2.workloadWordHealthy",
  pending: "infra.k8s2.workloadWordDegraded",
  failed: "infra.k8s2.workloadWordUnavailable",
};

/** Healthy / Degraded / Unavailable for a controller's status; null where the kind or status keeps its own wording. */
export function workloadStatusWord(kind: StatusKind, status: WorkloadStatus): I18nKey | null {
  return CONTROLLER_KINDS.includes(kind) ? (CONTROLLER_WORD[status] ?? null) : null;
}

/** The problems-list chip: a failed Job stays "Failed", a failed controller is "Unavailable". */
export function problemStatusWord(kind: StatusKind, severity: "failed" | "pending"): I18nKey {
  if (severity === "pending") return "infra.k8s2.workloadWordDegraded";
  return kind === "job"
    ? "infra.k8s2.workloadsStatusFailedChip"
    : "infra.k8s2.workloadWordUnavailable";
}
