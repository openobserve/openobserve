// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { ExperimentResultSlot } from "@/services/llm-experiments.service";
import { filterExperimentResultSlots } from "./experimentResults";

function slot(overrides: Partial<ExperimentResultSlot>): ExperimentResultSlot {
  return {
    rowId: "row-1",
    logicalId: "case-1",
    trialIndex: 0,
    input: null,
    expectedOutput: null,
    taskStatus: "pending",
    execution: null,
    scores: [],
    ...overrides,
  };
}

describe("experiment result slot filtering", () => {
  it("keeps pinned order and renders a completed task with a pending score once", () => {
    const completedWithPendingScore = slot({
      rowId: "row-b",
      taskStatus: "ok",
      execution: { rowId: "row-b", status: "ok" } as ExperimentResultSlot["execution"],
      scores: [{ scorerId: "quality", scorerVersion: 1, status: "in_progress", score: null }],
    });
    const pending = slot({ rowId: "row-a" });

    expect(filterExperimentResultSlots([completedWithPendingScore, pending], "all")).toEqual([
      completedWithPendingScore,
      pending,
    ]);
  });

  it("filters execution and score skip reasons including placeholders", () => {
    const noReference = slot({
      taskStatus: "skipped",
      execution: { skipReason: "no_reference" } as ExperimentResultSlot["execution"],
    });
    const noTrace = slot({
      rowId: "row-2",
      taskStatus: "ok",
      scores: [
        {
          scorerId: "trace",
          scorerVersion: 1,
          status: "skipped",
          score: { skip_reason: "no_trace" },
        },
      ],
    });
    const error = slot({ rowId: "row-3", taskStatus: "error" });

    expect(filterExperimentResultSlots([noReference, noTrace, error], "no_reference")).toEqual([
      noReference,
    ]);
    expect(filterExperimentResultSlots([noReference, noTrace, error], "no_trace")).toEqual([
      noTrace,
    ]);
    expect(filterExperimentResultSlots([noReference, noTrace, error], "error")).toEqual([error]);
  });

  it("classifies an ok execution with a failed scorer as error", () => {
    const scorerError = slot({
      taskStatus: "ok",
      execution: { rowId: "row-1", status: "ok" } as ExperimentResultSlot["execution"],
      scores: [
        {
          scorerId: "quality",
          scorerVersion: 1,
          status: "error",
          score: { status: "error", error_message: "scorer exhausted retries" },
        },
      ],
    });

    expect(filterExperimentResultSlots([scorerError], "error")).toEqual([scorerError]);
    expect(filterExperimentResultSlots([scorerError], "ok")).toEqual([]);
  });
});
