// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/services/http", () => ({
  default: () => ({ get, post }),
}));

import llmExperimentsService, { type ExperimentCreatePayload } from "./llm-experiments.service";

const payload: ExperimentCreatePayload = {
  name: "Prompt comparison",
  datasetId: "dataset-1",
  datasetVersion: 7,
  task: {
    type: "inline_prompt",
    messages: [{ role: "user", content: "{{ input }}" }],
    providerId: "provider-1",
  },
  scorers: [{ id: "scorer-1" }],
  trialCount: 2,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("llmExperimentsService", () => {
  it("previews pinned rows, trials, scorers, and reference-free samples", async () => {
    post.mockResolvedValue({
      data: {
        datasetId: "dataset-1",
        datasetVersion: 7,
        rowCount: 3,
        trialCount: 2,
        slotCount: 6,
        pinnedScorers: [{ id: "scorer-1", version: 4 }],
        applicability: {
          fullySkippedRowCount: 1,
          partiallySkippedRowCount: 1,
          fullySkippedSlotCount: 2,
          partiallySkippedSlotCount: 2,
          eligibleTaskSlotCount: 4,
          eligibleScoringDimensionCount: 4,
          scorerApplicability: [
            {
              scorerId: "scorer-1",
              scorerVersion: 4,
              eligibleRowCount: 2,
              noReferenceRowCount: 1,
              eligibleSlotCount: 4,
              noReferenceSlotCount: 2,
            },
          ],
        },
        sampleSlots: [
          {
            rowId: "row-1",
            logicalId: "item-1",
            trialIndex: 0,
            input: { question: "hello" },
            expectedOutput: null,
          },
        ],
      },
    });

    const preview = await llmExperimentsService.preview("acme", payload, 3);

    expect(post).toHaveBeenCalledWith("/api/acme/experiments/preview", payload, {
      params: { sampleSize: 3 },
    });
    expect(preview).toMatchObject({ rowCount: 3, trialCount: 2, slotCount: 6 });
    expect(preview.pinnedScorers).toEqual([{ id: "scorer-1", version: 4 }]);
    expect(preview.applicability).toMatchObject({
      fullySkippedRowCount: 1,
      partiallySkippedRowCount: 1,
      eligibleTaskSlotCount: 4,
    });
    expect(preview.sampleSlots[0].expectedOutput).toBeNull();
  });

  it("returns the original experiment for an idempotent create", async () => {
    post.mockResolvedValue({
      data: {
        created: false,
        experiment: {
          id: "experiment-1",
          orgId: "acme",
          ...payload,
          scorers: [{ id: "scorer-1", version: 4 }],
          status: "pending",
          createdBy: "owner@example.com",
          createdAt: 1_800_000_000_000,
        },
        preview: { datasetId: "dataset-1", datasetVersion: 7, sampleSlots: [] },
      },
    });

    const result = await llmExperimentsService.create("acme", payload);

    expect(result.created).toBe(false);
    expect(result.experiment.id).toBe("experiment-1");
    expect(result.experiment.createdAt).toBe(1_800_000_000_000);
  });

  it("normalizes completed output, trace, and bound scores from detail", async () => {
    get.mockResolvedValue({
      data: {
        experiment: {
          id: "experiment-1",
          orgId: "acme",
          ...payload,
          scorers: [{ id: "scorer-1", version: 4 }],
          status: "completed",
          createdBy: "owner@example.com",
          createdAt: 1_800_000_000_000,
        },
        preview: { datasetId: "dataset-1", datasetVersion: 7, sampleSlots: [] },
        results: {
          executions: [
            {
              experiment_id: "experiment-1",
              item_logical_id: "case-1",
              row_id: "row-1",
              trial_index: 0,
              status: "ok",
              output: "It ships tomorrow",
              trace_id: "abc123",
              _timestamp: 100,
            },
          ],
          scores: [{ id: "score-1", name: "quality", value_numeric: 0.9 }],
          taskProgress: { completed: 1, total: 1, skipped: 1 },
          scoringProgress: { completed: 1, total: 1, skipped: 2 },
          skipSummary: {
            fullySkippedSlots: 1,
            partiallySkippedSlots: 1,
            skippedDimensions: 2,
            noReferenceDimensions: 1,
            noTraceDimensions: 1,
          },
          scoreSummaries: [
            { scorerId: "scorer-1", scorerVersion: 4, sampleCount: 1, skippedCount: 2 },
          ],
        },
      },
    });

    const detail = await llmExperimentsService.get("acme", "experiment-1");

    expect(get).toHaveBeenCalledWith("/api/acme/experiments/experiment-1", {
      params: { sampleSize: 5 },
    });
    expect(detail.results.executions[0]).toMatchObject({
      itemLogicalId: "case-1",
      rowId: "row-1",
      status: "ok",
      output: "It ships tomorrow",
      traceId: "abc123",
    });
    expect(detail.results.scores).toEqual([{ id: "score-1", name: "quality", value_numeric: 0.9 }]);
    expect(detail.results).toMatchObject({
      taskProgress: { completed: 1, total: 1, skipped: 1 },
      scoringProgress: { completed: 1, total: 1, skipped: 2 },
      skipSummary: { noReferenceDimensions: 1, noTraceDimensions: 1 },
      scoreSummaries: [{ scorerId: "scorer-1", sampleCount: 1, skippedCount: 2 }],
    });
  });

  it("calls the state-gated lifecycle endpoints and normalizes their durable fields", async () => {
    post
      .mockResolvedValueOnce({
        data: {
          id: "experiment-1",
          org_id: "acme",
          ...payload,
          scorers: [{ id: "scorer-1", version: 4 }],
          status: "cancelled",
          status_reason: "user_cancelled",
          deadline_at: 1_800_086_400_000,
          completed_at: 1_800_000_000_100,
          lifecycle_version: 1,
          retry_count: 0,
          created_by: "owner@example.com",
          created_at: 1_800_000_000_000,
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "experiment-2",
          org_id: "acme",
          ...payload,
          scorers: [{ id: "scorer-1", version: 4 }],
          status: "running",
          status_reason: null,
          deadline_at: 1_800_172_800_000,
          completed_at: null,
          lifecycle_version: 2,
          retry_count: 1,
          created_by: "owner@example.com",
          created_at: 1_800_000_000_000,
        },
      });

    const cancelled = await llmExperimentsService.cancel("acme", "experiment-1");
    const retried = await llmExperimentsService.retry("acme", "experiment-2");

    expect(post).toHaveBeenNthCalledWith(1, "/api/acme/experiments/experiment-1/cancel");
    expect(post).toHaveBeenNthCalledWith(2, "/api/acme/experiments/experiment-2/retry");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      statusReason: "user_cancelled",
      lifecycleVersion: 1,
    });
    expect(retried).toMatchObject({ status: "running", retryCount: 1, completedAt: null });
  });
});
