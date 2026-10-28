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

import { describe, expect, it } from "vitest";
import {
  costKind,
  fixTarget,
  healthCounts,
  sortChecks,
  unpricedFields,
  unpricedSummary,
} from "./llmDataTrust.utils";
import type { DataHealthCheck } from "@/services/gen-ai-data-health.service";

const check = (over: Partial<DataHealthCheck>): DataHealthCheck => ({
  id: "zero_duration_spans",
  status: "pass",
  affected: 0,
  total: 10,
  samples: [],
  ...over,
});

describe("costKind", () => {
  it("is exact without unpriced tokens, partial with some, unknown when nothing is priced", () => {
    expect(costKind(0.5, 100, 0)).toBe("exact");
    expect(costKind(0, 0, 0)).toBe("exact");
    // An exactly matched free/muted price has tokens and a real $0 cost, but
    // contributes no unpriced tokens to the cell's aggregate.
    expect(costKind(0, 100, 0)).toBe("exact");
    expect(costKind(0.5, 100, 40)).toBe("partial");
    expect(costKind(0, 100, 40)).toBe("unknown");
    expect(costKind(0.5, 100, 100)).toBe("unknown");
  });
});

describe("unpricedFields", () => {
  it("tolerates rows from servers without the fields", () => {
    expect(unpricedFields({})).toEqual({ unpricedTokens: 0, unpricedModels: [] });
    expect(
      unpricedFields({ gen_ai_unpriced_tokens: "12", gen_ai_unpriced_models: ["a", null] }),
    ).toEqual({ unpricedTokens: 12, unpricedModels: ["a"] });
  });
});

describe("unpricedSummary", () => {
  it("sums model tokens of a failing unpriced check and is null when it passes", () => {
    expect(unpricedSummary(null)).toBeNull();
    const passing = { checked_at: 1, checks: [check({ id: "unpriced_models" })] };
    expect(unpricedSummary(passing)).toBeNull();
    const failing = {
      checked_at: 1,
      checks: [
        check({
          id: "unpriced_models",
          status: "error",
          affected: 3,
          models: [
            { model: "acme", spans: 2, tokens: 900 },
            { model: "other", spans: 1, tokens: 100 },
          ],
        }),
      ],
    };
    expect(unpricedSummary(failing)).toMatchObject({ tokens: 1000, spans: 3 });
  });

  it("takes the uncapped totals, not the length or sum of the capped list", () => {
    const models = Array.from({ length: 20 }, (_, i) => ({ model: `m${i}`, spans: 1, tokens: 10 }));
    const health = {
      checked_at: 1,
      checks: [
        check({
          id: "unpriced_models",
          status: "error",
          affected: 30,
          models,
          model_count: 25,
          unpriced_tokens: 5000,
          models_truncated: true,
        }),
      ],
    };
    expect(unpricedSummary(health)).toMatchObject({
      tokens: 5000,
      modelCount: 25,
      truncated: true,
      spans: 30,
    });
  });
});

describe("health checks", () => {
  it("counts and orders worst first", () => {
    const checks = [
      check({ id: "missing_session_id" }),
      check({ id: "zero_duration_spans", status: "warning", affected: 2 }),
      check({ id: "unpriced_models", status: "error", affected: 1 }),
    ];
    expect(healthCounts(checks)).toEqual({ errors: 1, warnings: 1, passing: 1 });
    expect(sortChecks(checks).map((c) => c.id)).toEqual([
      "unpriced_models",
      "zero_duration_spans",
      "missing_session_id",
    ]);
  });

  it("links each check to its fix", () => {
    expect(fixTarget("unpriced_models", "default", "org1")).toEqual({
      kind: "route",
      to: {
        name: "modelPricing",
        query: { tab: "unpriced", stream: "default", org_identifier: "org1" },
      },
    });
    expect(fixTarget("missing_agent_identity", "default", "org1")).toMatchObject({
      kind: "route",
      to: { name: "genAiAgentMapping" },
    });
    expect(fixTarget("zero_duration_spans", "default", "org1").kind).toBe("url");
  });
});
