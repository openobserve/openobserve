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

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import llmExperimentsService, {
  normalizeExperimentComparison,
  normalizeExperimentRowDetail,
} from "./llm-experiments.service";

vi.mock("./http", () => {
  const mockClient = { get: vi.fn(), post: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});

const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.get.mockResolvedValue({ data: {} });
});

describe("llm-experiments compare()", () => {
  // The server owns the neutral threshold (0.05). Sending a client-side default
  // silently overrides it, and a 0 makes every movement a regression.
  it("omits the threshold entirely when the caller does not pick one", async () => {
    await llmExperimentsService.compare("acme", "base", "cand");

    const [, config] = mockClient.get.mock.calls[0];
    expect(config.params).toEqual({ baselineId: "base", candidateId: "cand" });
    expect("threshold" in config.params).toBe(false);
  });

  it("sends the threshold the caller picked, including zero", async () => {
    await llmExperimentsService.compare("acme", "base", "cand", 0.15);
    expect(mockClient.get.mock.calls[0][1].params.threshold).toBe(0.15);

    await llmExperimentsService.compare("acme", "base", "cand", 0);
    expect(mockClient.get.mock.calls[1][1].params.threshold).toBe(0);
  });
});

describe("normalizeExperimentComparison()", () => {
  it("normalizes score-config metadata and aggregate oriented deltas", () => {
    const dimension = {
      name: "internal-producer-id · v1",
      kind: "score",
      score_config_id: "config-1",
      score_config_name: "answer_quality",
      score_config_version: "3",
      baseline: 0.8,
      candidate: 0.6,
      delta: -0.2,
      oriented_delta: -0.2,
      gating: true,
      normalized: true,
      baseline_sample_count: 1,
      candidate_sample_count: 1,
      assignment: "regressed",
    };
    const normalized = normalizeExperimentComparison({
      baseline_id: "base",
      candidate_id: "candidate",
      dataset_id: "dataset",
      threshold: 0.05,
      assignment_rule: "Any regression wins",
      counts: {},
      dimensions: [
        {
          ...dimension,
          comparable_row_count: 1,
          baseline_only_row_count: 0,
          candidate_only_row_count: 0,
        },
      ],
      rows: [
        {
          logical_id: "row-1",
          input: { question: "What changed?", tags: ["release", "api"] },
          bucket: "regressed",
          dimensions: [dimension],
        },
      ],
    });

    expect(normalized.dimensions[0]).toMatchObject({
      scoreConfigId: "config-1",
      scoreConfigName: "answer_quality",
      scoreConfigVersion: "3",
      orientedDelta: -0.2,
      assignment: "regressed",
    });
    expect(normalized.rows[0].dimensions[0]).toMatchObject({
      scoreConfigName: "answer_quality",
      orientedDelta: -0.2,
    });
    expect(normalized.rows[0].input).toEqual({
      question: "What changed?",
      tags: ["release", "api"],
    });
  });
});

describe("normalizeExperimentRowDetail()", () => {
  it("keeps score-dimension metadata for pending rows", () => {
    const normalized = normalizeExperimentRowDetail({
      score_summaries: [
        {
          scorer_id: "scorer-1",
          scorer_version: 2,
          name: "answer_relevance",
          score_config_id: "config-1",
          score_config_name: "answer_relevance",
          score_config_version: 3,
          pending_count: 1,
        },
      ],
    });

    expect(normalized.scoreSummaries[0]).toMatchObject({
      scorerId: "scorer-1",
      scorerVersion: 2,
      name: "answer_relevance",
      scoreConfigId: "config-1",
      scoreConfigName: "answer_relevance",
      scoreConfigVersion: 3,
      pendingCount: 1,
    });
  });
});
