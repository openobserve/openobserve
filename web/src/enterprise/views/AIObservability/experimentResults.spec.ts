// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import type { ExperimentResultSlot } from "@/services/llm-experiments.service";
import {
  experimentScoreSummaryValue,
  experimentScoreValue,
  experimentTraceLocation,
  filterExperimentResultSlots,
  openExperimentTrace,
} from "./experimentResults";

describe("experiment score formatting", () => {
  it("renders every typed score value, including false", () => {
    expect(experimentScoreValue({ value_numeric: 0.718418 })).toBe("0.718");
    expect(experimentScoreValue({ value_boolean: true })).toBe("true");
    expect(experimentScoreValue({ value_boolean: false })).toBe("false");
    expect(experimentScoreValue({ value_categorical: "safe" })).toBe("safe");
    expect(experimentScoreValue(null)).toBe("—");
  });

  it("renders aggregates without exposing their JSON envelope", () => {
    expect(experimentScoreSummaryValue({ kind: "numeric", mean: 0.718418 })).toBe("0.718");
    expect(experimentScoreSummaryValue({ kind: "boolean", trueCount: 3, falseCount: 2 })).toBe(
      "true × 3 · false × 2",
    );
    expect(experimentScoreSummaryValue({ kind: "categorical", counts: { good: 2, poor: 1 } })).toBe(
      "good × 2 · poor × 1",
    );
  });
});

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
  it("builds an internal trace target without mutating the Experiment route", () => {
    const execution = {
      traceId: "trace-1",
      timestamp: 4_000_000_000,
    } as NonNullable<ExperimentResultSlot["execution"]>;
    const location = experimentTraceLocation("acme", execution);
    expect(location).toEqual({
      name: "traceDetails",
      query: {
        org_identifier: "acme",
        stream: "_evaluator",
        from: 400_000_000,
        to: 7_600_000_000,
        trace_id: "trace-1",
      },
    });
    const resolve = vi.fn(() => ({ href: "/web/traces?trace_id=trace-1" }));
    const open = vi.fn();

    expect(openExperimentTrace("acme", execution, resolve, open)).toBe(true);
    expect(resolve).toHaveBeenCalledWith(location);
    expect(open).toHaveBeenCalledWith(
      "/web/traces?trace_id=trace-1",
      "_blank",
      "noopener,noreferrer",
    );
  });
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
