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

import type { ExperimentResultSlot } from "@/services/llm-experiments.service";
import type { ExperimentExecution } from "@/services/llm-experiments.service";

const EMPTY_SCORE = "—";

/** Render one successful typed Score without leaking its storage envelope. */
export function experimentScoreValue(score: Record<string, unknown> | null | undefined): string {
  if (!score) return EMPTY_SCORE;
  const numeric = score.value_numeric ?? score.valueNumeric;
  if (typeof numeric === "number" && Number.isFinite(numeric)) return numeric.toFixed(3);
  const categorical = score.value_categorical ?? score.valueCategorical;
  if (typeof categorical === "string" && categorical.length) return categorical;
  const boolean = score.value_boolean ?? score.valueBoolean;
  if (typeof boolean === "boolean") return String(boolean);
  return EMPTY_SCORE;
}

/** Render a type-aware Score aggregate as a compact value rather than JSON. */
export function experimentScoreSummaryValue(value: unknown, trialCount?: number): string {
  if (value === null || value === undefined) return EMPTY_SCORE;
  if (typeof value !== "object" || Array.isArray(value)) return String(value);
  const aggregate = value as Record<string, unknown>;
  if (aggregate.kind === "numeric" && typeof aggregate.mean === "number") {
    return aggregate.mean.toFixed(3);
  }
  if (aggregate.kind === "boolean") {
    const trueCount = Number(aggregate.trueCount ?? aggregate.true_count ?? 0);
    const falseCount = Number(aggregate.falseCount ?? aggregate.false_count ?? 0);
    if (trialCount === 1) {
      if (trueCount + falseCount === 0) return EMPTY_SCORE;
      if (trueCount + falseCount === 1) return String(trueCount === 1);
    }
    return `true × ${trueCount} · false × ${falseCount}`;
  }
  if (aggregate.kind === "categorical") {
    const counts = aggregate.counts;
    if (counts && typeof counts === "object" && !Array.isArray(counts)) {
      const entries = Object.entries(counts as Record<string, unknown>);
      if (trialCount === 1) {
        return entries.find(([, count]) => Number(count) > 0)?.[0] ?? EMPTY_SCORE;
      }
      return entries.sort((left, right) => Number(right[1]) - Number(left[1]))
        .map(([category, count]) => `${category} × ${Number(count)}`)
        .join(" · ");
    }
  }
  return EMPTY_SCORE;
}

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
