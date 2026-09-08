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

// @vitest-environment jsdom

const mockExecuteQueryOnce = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: vi.fn(),
    executeQueryOnce: mockExecuteQueryOnce,
    cancelAll: vi.fn(),
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

const mockListCached = vi.fn();
vi.mock("@/services/online-evals.service", () => ({
  default: { scoreConfigs: { listCached: (...args: any[]) => mockListCached(...args) } },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTraceScoreChips } from "./useTraceScoreChips";

beforeEach(() => {
  mockExecuteQueryOnce.mockReset();
  mockListCached.mockReset();
});

describe("useTraceScoreChips", () => {
  it("resolves a chip per score, preferring the score config's display name, description, and reasoning", async () => {
    mockExecuteQueryOnce.mockResolvedValue([
      {
        scorer_id: "scorer-1",
        score_config_id: "cfg-quality",
        value_numeric: 0.8123,
        reasoning: "The answer directly addressed every part of the question.",
        _timestamp: 1_700_000_000_000_000,
      },
      { scorer_id: "scorer-2", score_config_id: "cfg-safety", value_boolean: "true" },
    ]);
    mockListCached.mockResolvedValue([
      {
        id: "v1",
        entityId: "cfg-quality",
        name: "Answer quality",
        version: 1,
        description: "How completely the response answers the user's question.",
      },
    ]);

    const { chips, load } = useTraceScoreChips();
    await load("span", "span-123", 1_000_000);

    expect(chips.value).toEqual([
      {
        key: "cfg-quality",
        label: "Answer quality",
        value: "0.81",
        description: "How completely the response answers the user's question.",
        reasoning: "The answer directly addressed every part of the question.",
        scoredAtMs: 1_700_000_000_000,
      },
      {
        key: "cfg-safety",
        label: "scorer-2",
        value: "true",
        description: null,
        reasoning: null,
        scoredAtMs: null,
      },
    ]);
  });

  // The score chip is a purely additive affordance rendered on every trace —
  // LLM or not. A non-LLM org has no `_llm_scores` stream at all, so the
  // search call rejects; that must never surface as an error, only as "no
  // chips", or every plain trace in the app would show a broken widget.
  it("resolves to no chips, never throws, when the score query fails", async () => {
    mockExecuteQueryOnce.mockRejectedValue(new Error("stream [_llm_scores] not found"));
    mockListCached.mockResolvedValue([]);

    const { chips, load } = useTraceScoreChips();
    await expect(load("trace", "trace-123", 1_000_000)).resolves.toBeUndefined();

    expect(chips.value).toEqual([]);
  });

  it("resolves to no chips, never throws, when the score-config lookup fails", async () => {
    mockExecuteQueryOnce.mockResolvedValue([{ scorer_id: "s1", value_numeric: 1 }]);
    mockListCached.mockRejectedValue(new Error("network error"));

    const { chips, load } = useTraceScoreChips();
    await load("span", "span-123", 1_000_000);

    // The config lookup failing degrades to the raw scorer id as the label —
    // it does not blank the scores that DID come back.
    expect(chips.value).toEqual([
      {
        key: "s1",
        label: "s1",
        value: "1.00",
        description: null,
        reasoning: null,
        scoredAtMs: null,
      },
    ]);
  });

  it("does nothing when there is no target id", async () => {
    const { chips, load } = useTraceScoreChips();
    await load("span", "", 1_000_000);

    expect(mockExecuteQueryOnce).not.toHaveBeenCalled();
    expect(chips.value).toEqual([]);
  });

  // An automated Eval Job score and a manual annotation for the same
  // dimension are separate evaluation attempts by design (distinct
  // `_evaluation_key`s in an append-only ledger), so the backend query
  // legitimately returns both rows for "correctness". The chip must show
  // only the newer one, not both, and must pick correctly regardless of
  // which row happens to arrive first in the result array.
  it("collapses multiple rows for the same scorer to the single most recent value", async () => {
    mockExecuteQueryOnce.mockResolvedValue([
      {
        scorer_id: "correctness-judge",
        score_config_id: "cfg-correctness",
        value_numeric: 0.2,
        reasoning: "Automated judge reasoning.",
        _timestamp: 1_700_000_000_000_000,
      },
      {
        scorer_id: "correctness-judge",
        score_config_id: "cfg-correctness",
        value_numeric: 0.43,
        reasoning: "Manual annotation reasoning.",
        _timestamp: 1_700_003_000_000_000,
      },
    ]);
    mockListCached.mockResolvedValue([
      { id: "v1", entityId: "cfg-correctness", name: "Correctness" },
    ]);

    const { chips, load } = useTraceScoreChips();
    await load("span", "span-123", 1_000_000);

    expect(chips.value).toEqual([
      {
        key: "cfg-correctness",
        label: "Correctness",
        value: "0.43",
        description: null,
        reasoning: "Manual annotation reasoning.",
        scoredAtMs: 1_700_003_000_000,
      },
    ]);
  });
});
