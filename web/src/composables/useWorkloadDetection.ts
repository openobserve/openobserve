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

export function useWorkloadDetection(): {
  states: ComputedRef<Record<WorkloadId, WorkloadState>>;
  refresh: () => Promise<void>;
} {
  const { getStreams } = useStreams(gt);
  // Per-instance refs, never module state — an org switch resets the stream
  // cache upstream and consumers call refresh(); nothing stale can leak.
  const metricsNames = ref<string[] | null>(null);
  const logsNames = ref<string[] | null>(null);

  const names = (res: unknown): string[] =>
    (((res as any)?.list ?? []) as Array<{ name: string }>).map((s) => s.name);

  const refresh = async () => {
    const [metrics, logs] = await Promise.all([
      getStreams("metrics", false, false).catch(() => null),
      getStreams("logs", false, false).catch(() => null),
    ]);
    metricsNames.value = names(metrics);
    logsNames.value = names(logs);
  };

  const states = computed<Record<WorkloadId, WorkloadState>>(() => {
    const metrics = metricsNames.value;
    const logs = logsNames.value;
    const fromMetrics = (matched: boolean): WorkloadState =>
      metrics == null ? "unknown" : matched ? "detected" : "undetected";
    const awsDetected =
      (metrics != null && metrics.some(isAwsName)) || (logs != null && logs.some(isAwsName));
    return {
      hosts: fromMetrics(
        metrics != null && HOST_SIGNATURE_STREAMS.filter((n) => metrics.includes(n)).length >= 2,
      ),
      kubernetes: fromMetrics(
        metrics != null && metrics.filter((n) => n.startsWith("k8s_")).length >= 2,
      ),
      aws: awsDetected ? "detected" : metrics != null && logs != null ? "undetected" : "unknown",
    };
  });

  return { states, refresh };
}
