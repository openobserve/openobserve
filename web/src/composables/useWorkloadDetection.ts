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

// L0 workload detection over stream NAMES only (design 4.6) — client-side,
// store-cached stream lists, zero extra queries on a warm session. Detection
// only picks which face of a page renders; it is never an access gate.

import { computed, ref, type ComputedRef } from "vue";
import useStreams from "@/composables/useStreams";
import { gt } from "@/types/i18n";

export type WorkloadId = "hosts" | "kubernetes" | "aws";
export type WorkloadState = "unknown" | "undetected" | "detected";

// Exact characteristic streams — ≥2 present means a host agent is reporting.
const HOST_SIGNATURE_STREAMS = [
  "system_cpu_time",
  "system_memory_usage",
  "system_filesystem_usage",
  "system_network_io",
];

const isAwsName = (name: string) => name.startsWith("aws_") || name.includes("cloudwatch");

/**
 * The L0 signature applied to already-loaded stream NAMES. Exported so a caller
 * that has just read the lists itself (the curated engine) derives the same
 * state without paying for a second read. `null` means "not loaded" ⇒ unknown.
 */
export function workloadStateFromNames(
  workload: WorkloadId,
  names: { metrics: string[] | null; logs: string[] | null },
): WorkloadState {
  const { metrics, logs } = names;
  const fromMetrics = (matched: boolean): WorkloadState =>
    metrics == null ? "unknown" : matched ? "detected" : "undetected";
  if (workload === "hosts") {
    return fromMetrics(
      metrics != null && HOST_SIGNATURE_STREAMS.filter((n) => metrics.includes(n)).length >= 2,
    );
  }
  if (workload === "kubernetes") {
    return fromMetrics(metrics != null && metrics.filter((n) => n.startsWith("k8s_")).length >= 2);
  }
  const awsDetected =
    (metrics != null && metrics.some(isAwsName)) || (logs != null && logs.some(isAwsName));
  return awsDetected ? "detected" : metrics != null && logs != null ? "undetected" : "unknown";
}

export function useWorkloadDetection(): {
  states: ComputedRef<Record<WorkloadId, WorkloadState>>;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
} {
  const { getStreams } = useStreams(gt);
  // Per-instance refs, never module state — org switches reset the stream cache upstream.
  const metricsNames = ref<string[] | null>(null);
  const logsNames = ref<string[] | null>(null);

  const names = (res: unknown): string[] =>
    (((res as any)?.list ?? []) as Array<{ name: string }>).map((s) => s.name);

  // getStreams caches even an empty list forever — detect-driven refreshes must force past it.
  const refresh = async ({ force = false }: { force?: boolean } = {}) => {
    const [metrics, logs] = await Promise.all([
      getStreams("metrics", false, false, force).catch(() => null),
      getStreams("logs", false, false, force).catch(() => null),
    ]);
    // A failed fetch stays null ⇒ "unknown", never a false "set up" state (design 4.6).
    metricsNames.value = metrics == null ? null : names(metrics);
    logsNames.value = logs == null ? null : names(logs);
  };

  const states = computed<Record<WorkloadId, WorkloadState>>(() => {
    const names = { metrics: metricsNames.value, logs: logsNames.value };
    return {
      hosts: workloadStateFromNames("hosts", names),
      kubernetes: workloadStateFromNames("kubernetes", names),
      aws: workloadStateFromNames("aws", names),
    };
  });

  return { states, refresh };
}
