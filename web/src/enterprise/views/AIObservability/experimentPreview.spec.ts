// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type {
  ExperimentCreatePayload,
  ExperimentPreview,
} from "@/services/llm-experiments.service";
import { createPreviewRequestGate, withPreviewScorers } from "./experimentPreview";

const payload: ExperimentCreatePayload = {
  name: "Pinned preview",
  datasetId: "dataset-1",
  datasetVersion: 3,
  task: {
    type: "inline_prompt",
    messages: [{ role: "user", content: "{{ input }}" }],
    providerId: "provider-1",
  },
  scorers: [{ id: "quality" }, { id: "safety" }],
  trialCount: 1,
};

const preview: ExperimentPreview = {
  datasetId: "dataset-1",
  datasetVersion: 3,
  rowCount: 1,
  trialCount: 1,
  slotCount: 1,
  pinnedScorers: [
    { id: "quality", version: 4 },
    { id: "safety", version: 2 },
  ],
  applicability: {
    fullySkippedRowCount: 0,
    partiallySkippedRowCount: 0,
    fullySkippedSlotCount: 0,
    partiallySkippedSlotCount: 0,
    eligibleTaskSlotCount: 1,
    eligibleScoringDimensionCount: 2,
    scorerApplicability: [],
  },
  sampleSlots: [],
};

describe("experiment preview coordination", () => {
  it("pins create requests to the scorer versions returned by preview", () => {
    expect(withPreviewScorers(payload, preview).scorers).toEqual([
      { id: "quality", version: 4 },
      { id: "safety", version: 2 },
    ]);
    expect(payload.scorers).toEqual([{ id: "quality" }, { id: "safety" }]);
  });

  it("rejects preview responses invalidated by a later draft revision", () => {
    const gate = createPreviewRequestGate();
    const staleRequest = gate.start();
    gate.invalidate();

    expect(gate.isCurrent(staleRequest)).toBe(false);
    expect(gate.isCurrent(gate.start())).toBe(true);
  });
});
