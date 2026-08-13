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
            {
              scorer_id: "scorer-1",
              scorer_version: 4,
              sample_count: 1,
              no_reference_count: 1,
              no_trace_count: 1,
              skipped_count: 2,
            },
          ],
          slots: [
            {
              row_id: "row-1",
              logical_id: "case-1",
              trial_index: 0,
              input: { question: "When?" },
              task_status: "ok",
              execution: {
                experiment_id: "experiment-1",
                item_logical_id: "case-1",
                row_id: "row-1",
                trial_index: 0,
                status: "ok",
                _timestamp: 100,
              },
              scores: [{ scorer_id: "scorer-1", scorer_version: 4, status: "in_progress" }],
            },
          ],
          pagination: { page: 1, page_size: 50, total_slots: 1, has_more: false },
          aggregate_summary: {
            p50_latency_ms: 12,
            total_cost: 0.002,
            incomplete: true,
            incomplete_task_slots: 0,
            incomplete_score_dimensions: 1,
          },
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
      scoreSummaries: [
        {
          scorerId: "scorer-1",
          sampleCount: 1,
          noReferenceCount: 1,
          noTraceCount: 1,
          skippedCount: 2,
        },
      ],
      pagination: { page: 1, pageSize: 50, totalSlots: 1, hasMore: false },
      aggregateSummary: {
        p50LatencyMs: 12,
        totalCost: 0.002,
        incomplete: true,
        incompleteTaskSlots: 0,
        incompleteScoreDimensions: 1,
      },
    });
    expect(detail.results.slots?.[0]).toMatchObject({
      rowId: "row-1",
      taskStatus: "ok",
      scores: [{ scorerId: "scorer-1", status: "in_progress" }],
    });
  });

  it("loads a reusable pinned row detail with all trial evidence", async () => {
    get.mockResolvedValue({
      data: {
        experiment_id: "experiment-1",
        snapshot: { dataset_id: "dataset-1", dataset_version: 7 },
        navigation: {
          row_index: 1,
          total_rows: 3,
          previous_row_id: "row-0",
          next_row_id: "row-2",
        },
        row_id: "row/1",
        logical_id: "case-1",
        input: { question: "When?" },
        expected_output: "Tomorrow",
        trials: [
          {
            row_id: "row/1",
            logical_id: "case-1",
            trial_index: 0,
            task_status: "error",
            execution: {
              experiment_id: "experiment-1",
              item_logical_id: "case-1",
              row_id: "row/1",
              trial_index: 0,
              status: "error",
              error_message: "provider timeout",
              task_fingerprint: "attempt-1",
              _timestamp: 100,
            },
            scores: [
              {
                scorer_id: "quality",
                scorer_version: 3,
                status: "success",
                score: {
                  name: "quality",
                  value_numeric: 0.5,
                  reasoning: "Partially correct",
                  source_type: "experiment",
                  origin_source_type: "remote",
                },
              },
            ],
          },
        ],
        score_summaries: [
          {
            scorer_id: "quality",
            scorer_version: 3,
            sample_count: 1,
            value: { kind: "numeric", mean: 0.5 },
          },
        ],
      },
    });

    const row = await llmExperimentsService.getRow("acme", "experiment-1", "row/1");

    expect(get).toHaveBeenCalledWith("/api/acme/experiments/experiment-1/rows/row%2F1");
    expect(row).toMatchObject({
      snapshot: { datasetId: "dataset-1", datasetVersion: 7 },
      navigation: { rowIndex: 1, totalRows: 3, nextRowId: "row-2" },
      rowId: "row/1",
      trials: [
        {
          taskStatus: "error",
          execution: { errorMessage: "provider timeout", taskFingerprint: "attempt-1" },
          scores: [
            {
              score: {
                reasoning: "Partially correct",
                source_type: "experiment",
                origin_source_type: "remote",
              },
            },
          ],
        },
      ],
      scoreSummaries: [{ scorerId: "quality", sampleCount: 1 }],
    });
  });

  it("retries exactly one slot with the caller idempotency key", async () => {
    post.mockResolvedValueOnce({
      data: {
        experiment_id: "experiment-1",
        item_logical_id: "case-1",
        row_id: "row/1",
        trial_index: 2,
        status: "ok",
        _timestamp: 101,
      },
    });

    const execution = await llmExperimentsService.retrySlot(
      "acme",
      "experiment-1",
      "row/1",
      2,
      "request-1",
    );

    expect(post).toHaveBeenCalledWith(
      "/api/acme/experiments/experiment-1/rows/row%2F1/trials/2/retry",
      { idempotencyKey: "request-1" },
    );
    expect(execution).toMatchObject({ rowId: "row/1", trialIndex: 2, status: "ok" });
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
      })
      .mockResolvedValueOnce({
        data: {
          id: "experiment-clone",
          org_id: "acme",
          ...payload,
          name: "Copy",
          scorers: [{ id: "scorer-1", version: 4 }],
          status: "pending",
          status_reason: null,
          deadline_at: 1_800_259_200_000,
          completed_at: null,
          lifecycle_version: 0,
          retry_count: 0,
          created_by: "owner@example.com",
          created_at: 1_800_172_800_000,
        },
      });

    const cancelled = await llmExperimentsService.cancel("acme", "experiment-1");
    const retried = await llmExperimentsService.retry("acme", "experiment-2");
    const cloned = await llmExperimentsService.clone("acme", "experiment-1", "Copy");

    expect(post).toHaveBeenNthCalledWith(1, "/api/acme/experiments/experiment-1/cancel");
    expect(post).toHaveBeenNthCalledWith(2, "/api/acme/experiments/experiment-2/retry");
    expect(post).toHaveBeenNthCalledWith(3, "/api/acme/experiments/experiment-1/clone", {
      name: "Copy",
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      statusReason: "user_cancelled",
      lifecycleVersion: 1,
    });
    expect(retried).toMatchObject({ status: "running", retryCount: 1, completedAt: null });
    expect(cloned).toMatchObject({ id: "experiment-clone", status: "pending", name: "Copy" });
  });
});
