import { describe, expect, it } from "vitest";
import { conditionSummary } from "./runOutcome";
import { alertConditionText } from "./alertCondition";

describe("PromQL rule display", () => {
  it.each(["NaN", "+Inf", "-Inf", "0", "0.125"])("preserves %s in history", (value) => {
    expect(conditionSummary({ rule_value: value })).toBe(value);
  });
  it("keeps numeric threshold history compatible", () => {
    expect(conditionSummary({ actual_value: 5, threshold_value: 4, threshold_operator: ">" })).toBe(
      "5 > 4",
    );
  });
  it("shows the complete rule expression", () => {
    expect(
      alertConditionText({
        query_condition: { type: "promql", promql_rule_mode: true, promql: "foo > 4" },
      }),
    ).toBe("foo > 4");
  });
});
