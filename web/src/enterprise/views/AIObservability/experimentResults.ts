// Copyright 2026 OpenObserve Inc.

import type { ExperimentResultSlot } from "@/services/llm-experiments.service";

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
