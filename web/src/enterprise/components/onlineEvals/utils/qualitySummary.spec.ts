import { describe, expect, it } from "vitest";
import type { ScoreConfig } from "@/services/online-evals.service";
import { qualitySummaryForConfig } from "./qualitySummary";

function config(
  dataType: "numeric" | "boolean" | "categorical",
  healthyThreshold?: Record<string, unknown>,
): ScoreConfig {
  return {
    id: "cfg-1",
    name: "quality",
    version: 1,
    dataType,
    healthyThreshold,
  };
}

const emptyAgg = {
  avgNumeric: null,
  numericValues: 0,
  numericUnhealthy: null,
  trueScores: 0,
  falseScores: 0,
};

describe("qualitySummaryForConfig", () => {
  it("uses the overall average for numeric configs", () => {
    expect(
      qualitySummaryForConfig(
        config("numeric"),
        { ...emptyAgg, avgNumeric: 0.82 },
        [],
      ),
    ).toEqual({
      qualityValue: 0.82,
      qualityFormat: "number",
      qualityLabel: "Average",
    });
  });

  it("adds the configured healthy rate to a numeric average", () => {
    expect(
      qualitySummaryForConfig(
        config("numeric", { direction: "gte", value: 0.7 }),
        {
          ...emptyAgg,
          avgNumeric: 0.82,
          numericValues: 10,
          numericUnhealthy: 2,
        },
        [],
      ),
    ).toEqual({
      qualityValue: 0.82,
      qualityFormat: "number",
      qualityLabel: "Average · 80.0% healthy",
    });
  });

  it("respects false as the configured healthy boolean value", () => {
    expect(
      qualitySummaryForConfig(
        config("boolean", { healthy_value: false }),
        { ...emptyAgg, trueScores: 2, falseScores: 8 },
        [],
      ).qualityValue,
    ).toBe(80);
  });

  it("uses true rate when no healthy boolean value is configured", () => {
    expect(
      qualitySummaryForConfig(
        config("boolean"),
        { ...emptyAgg, trueScores: 3, falseScores: 1 },
        [],
      ),
    ).toEqual({
      qualityValue: 75,
      qualityFormat: "percent",
      qualityLabel: "True rate",
    });
  });

  it("calculates the configured healthy-category rate", () => {
    expect(
      qualitySummaryForConfig(
        config("categorical", { healthy_categories: ["good", "great"] }),
        emptyAgg,
        [
          { category: "good", count: 5 },
          { category: "great", count: 2 },
          { category: "bad", count: 3 },
        ],
      ).qualityValue,
    ).toBe(70);
  });

  it("uses the top category when no healthy set is configured", () => {
    expect(
      qualitySummaryForConfig(config("categorical"), emptyAgg, [
        { category: "neutral", count: 3 },
        { category: "good", count: 6 },
      ]),
    ).toEqual({
      qualityValue: "good",
      qualityFormat: "text",
      qualityLabel: "Top category",
    });
  });
});
