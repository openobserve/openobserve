// Copyright 2026 OpenObserve Inc.

import type { ExperimentResultSlot } from "@/services/llm-experiments.service";
import type { ExperimentExecution } from "@/services/llm-experiments.service";

export type ExperimentResultStatusFilter = "all" | "ok" | "no_reference" | "no_trace" | "error";

export function experimentResultSlotStatus(slot: ExperimentResultSlot): string {
  const scoreSkipReason = slot.scores
    .map((score) => score.score?.skipReason ?? score.score?.skip_reason)
    .find((reason) => reason === "no_reference" || reason === "no_trace");
  const hasError =
    slot.taskStatus === "error" || slot.scores.some((score) => score.status === "error");
  return slot.execution?.skipReason ?? scoreSkipReason ?? (hasError ? "error" : slot.taskStatus);
}

export function filterExperimentResultSlots(
  slots: ExperimentResultSlot[],
  filter: ExperimentResultStatusFilter,
) {
  if (filter === "all") return slots;
  return slots.filter((slot) => experimentResultSlotStatus(slot) === filter);
}

export function experimentTraceLocation(orgId: string, execution: ExperimentExecution) {
  if (!execution.traceId) return null;
  const padding = 3_600_000_000;
  return {
    name: "traceDetails",
    query: {
      org_identifier: orgId,
      stream: "_evaluator",
      from: Math.max(0, execution.timestamp - padding),
      to: execution.timestamp + padding,
      trace_id: execution.traceId,
    },
  };
}

export function openExperimentTrace(
  orgId: string,
  execution: ExperimentExecution,
  resolve: (location: NonNullable<ReturnType<typeof experimentTraceLocation>>) => { href: string },
  open: (url: string, target: string, features: string) => unknown,
) {
  const location = experimentTraceLocation(orgId, execution);
  if (!location) return false;
  open(resolve(location).href, "_blank", "noopener,noreferrer");
  return true;
}
