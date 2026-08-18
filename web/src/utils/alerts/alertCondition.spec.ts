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
  alertConditionText,
  alertPeriodMinutes,
  alertWarningConditionText,
} from "@/utils/alerts/alertCondition";

describe("alertConditionText", () => {
  it("reads an aggregation as the sentence the alert screen prints", () => {
    expect(
      alertConditionText({
        query_condition: {
          aggregation: { function: "avg", having: { column: "latency", operator: ">", value: 500 } },
        },
      }),
    ).toBe("avg(latency) > 500");
  });

  /// The single-alert GET calls it `query_condition`; the list calls the same
  /// object `condition`. A screen fed from either must read the same.
  it("accepts both spellings of the same object", () => {
    const aggregation = {
      aggregation: { function: "max", having: { column: "cpu", operator: ">=", value: 90 } },
    };
    expect(alertConditionText({ condition: aggregation })).toBe(
      alertConditionText({ query_condition: aggregation }),
    );
  });

  /// PromQL keeps its threshold on `promql_condition` — the expression itself
  /// is the query, so without this arm it falls through to "—".
  it("renders a PromQL comparison rather than nothing", () => {
    expect(
      alertConditionText({
        query_condition: { type: "promql", promql_condition: { operator: ">", value: 0.9 } },
      }),
    ).toBe("> 0.9");
  });

  it("falls back to the SQL when the rule is not an aggregation", () => {
    expect(alertConditionText({ query_condition: { sql: "SELECT 1" } })).toBe("SELECT 1");
  });

  /// A page outlives the rule it came from, so "no alert" is a real input.
  it("says nothing rather than throwing on a missing alert", () => {
    expect(alertConditionText(null)).toBe("—");
    expect(alertConditionText({})).toBe("—");
  });
});

describe("alertWarningConditionText", () => {
  it("renders the warning threshold when the alert has one", () => {
    expect(
      alertWarningConditionText({
        query_condition: {
          aggregation: {
            function: "avg",
            having: { column: "latency", operator: ">" },
            warning_value: 200,
          },
        },
      }),
    ).toBe("avg(latency) > 200");
  });

  it("is absent for an alert with only a critical threshold", () => {
    expect(alertWarningConditionText({ query_condition: { aggregation: {} } })).toBe("—");
  });
});

describe("alertPeriodMinutes", () => {
  it("returns the evaluation window", () => {
    expect(alertPeriodMinutes({ trigger_condition: { period: 5 } })).toBe(5);
  });

  /// Zero is not a window, and rendering "over 0m" would be worse than
  /// rendering the condition alone.
  it("treats an unset or zero period as no window", () => {
    expect(alertPeriodMinutes({ trigger_condition: { period: 0 } })).toBe(null);
    expect(alertPeriodMinutes({})).toBe(null);
  });
});
