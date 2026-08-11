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
          createdAt: 1,
        },
        preview: { datasetId: "dataset-1", datasetVersion: 7, sampleSlots: [] },
      },
    });

    const result = await llmExperimentsService.create("acme", payload);

    expect(result.created).toBe(false);
    expect(result.experiment.id).toBe("experiment-1");
  });
});
