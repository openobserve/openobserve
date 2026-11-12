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
  alertConditionIsQuery,
  alertConditionText,
  alertPeriodMinutes,
  alertWarningConditionText,
  countCompleteConditions,
  modesWithContent,
} from "@/utils/alerts/alertCondition";

describe("alertConditionText", () => {
  it("reads an aggregation as the sentence the alert screen prints", () => {
    expect(
      alertConditionText({
        query_condition: {
          aggregation: {
            function: "avg",
            having: { column: "latency", operator: ">", value: 500 },
          },
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

  /// R12, L1: every stored shape of a Builder rule reads as its conditions and its row-count threshold.
  it("renders a custom alert's stored conditions and its count threshold", () => {
    const leaf = { column: "body", operator: "contains", value: "ERROR" };
    const group = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ filterType: "condition", ...leaf, logicalOperator: "AND" }],
    };
    const trigger_condition = { operator: ">=", threshold: 1, period: 5, frequency: 1 };
    const cases: [string, unknown][] = [
      [
        "v2 wrapper, as GET /api/v2/{org}/alerts/{id} returns it",
        { version: 2, conditions: group },
      ],
      ["v2 wrapper with a string version", { version: "2", conditions: group }],
      ["bare v2 group", group],
      ["v1 tree", { and: [leaf] }],
      ["v0 flat list", [leaf]],
    ];
    for (const [name, conditions] of cases) {
      expect(
        alertConditionText({
          query_condition: { type: "custom", aggregation: null, conditions },
          trigger_condition,
        }),
        name,
      ).toBe("body contains 'ERROR' · count >= 1");
    }
    expect(alertConditionText({ query_condition: { type: "custom" }, trigger_condition })).toBe(
      "count >= 1",
    );
  });

  /// A page outlives the rule it came from, so "no alert" is a real input.
  it("says nothing rather than throwing on a missing alert", () => {
    expect(alertConditionText(null)).toBe("—");
    expect(alertConditionText({})).toBe("—");
  });

  /// Only the selected mode runs. A Builder alert keeps the SQL typed in the
  /// other tab, but that SQL never runs, so it is not the condition.
  describe("query mode", () => {
    it("does not show the stored SQL of a Builder alert as its condition", () => {
      expect(
        alertConditionText({
          query_condition: { type: "custom", sql: "SELECT 1 WHERE x", aggregation: null },
        }),
      ).toBe("—");
    });

    it("still shows the SQL of a SQL alert, and of an alert with no type", () => {
      const sql = "SELECT 1 WHERE x";
      expect(alertConditionText({ query_condition: { type: "sql", sql } })).toBe(sql);
      expect(alertConditionText({ query_condition: { sql } })).toBe(sql);
    });
  });
});

describe("alertConditionIsQuery", () => {
  it("is true for the raw SQL of a SQL alert and of an alert with no type", () => {
    expect(alertConditionIsQuery({ query_condition: { type: "sql", sql: "SELECT 1" } })).toBe(true);
    expect(alertConditionIsQuery({ condition: { sql: "SELECT 1" } })).toBe(true);
  });

  it("is false for an aggregation threshold, even with SQL stored beside it", () => {
    expect(
      alertConditionIsQuery({
        query_condition: {
          type: "sql",
          sql: "SELECT 1",
          aggregation: { function: "avg", having: { column: "x", operator: ">", value: 1 } },
        },
      }),
    ).toBe(false);
  });

  it("is false for a Builder alert, whose stored SQL never runs", () => {
    expect(alertConditionIsQuery({ query_condition: { type: "custom", sql: "SELECT 1" } })).toBe(
      false,
    );
  });

  it("is true for a PromQL rule and false for a PromQL threshold", () => {
    expect(
      alertConditionIsQuery({
        query_condition: { type: "promql", promql_rule_mode: true, promql: "up == 0" },
      }),
    ).toBe(true);
    expect(
      alertConditionIsQuery({
        query_condition: { type: "promql", promql_condition: { operator: ">", value: 1 } },
      }),
    ).toBe(false);
  });

  it("is true for an anomaly config in custom SQL and in filters mode", () => {
    expect(
      alertConditionIsQuery({ alert_type: "anomaly_detection", query_mode: "custom_sql" }),
    ).toBe(true);
    expect(alertConditionIsQuery({ alert_type: "anomaly_detection", query_mode: "filters" })).toBe(
      true,
    );
  });

  it("is false when there is no query to show", () => {
    expect(alertConditionIsQuery(null)).toBe(false);
    expect(alertConditionIsQuery({ query_condition: { type: "sql", sql: "" } })).toBe(false);
    expect(alertConditionIsQuery({ query_condition: { type: "slo", slo_condition: {} } })).toBe(
      false,
    );
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

const group = (conditions: unknown[]) => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: "g",
  conditions,
});
const row = (column: string, operator: string, value?: unknown) => ({
  filterType: "condition",
  column,
  operator,
  value,
});

describe("countCompleteConditions", () => {
  it("counts nothing in an empty tree", () => {
    expect(countCompleteConditions(group([]))).toBe(0);
  });

  it("does not count a half-filled row", () => {
    expect(countCompleteConditions(group([row("level", "=")]))).toBe(0);
  });

  /// A unary operator takes no value, so the row is complete without one.
  it("counts a unary operator without a value", () => {
    expect(countCompleteConditions(group([row("level", "is_null")]))).toBe(1);
  });

  it("counts a complete condition inside a nested group", () => {
    expect(
      countCompleteConditions(
        group([row("level", "=", "error"), group([row("code", ">", 0), row("host", "=")])]),
      ),
    ).toBe(2);
  });

  it("counts nothing for a missing tree", () => {
    expect(countCompleteConditions(undefined)).toBe(0);
    expect(countCompleteConditions(null)).toBe(0);
  });
});

describe("modesWithContent", () => {
  const builder = group([row("level", "=", "error")]);

  it("is empty when no mode holds content", () => {
    expect(modesWithContent({})).toEqual([]);
  });

  it("does not count whitespace-only SQL", () => {
    expect(modesWithContent({ sql: "  \n " })).toEqual([]);
  });

  /// The form writes the starter query into an empty SQL tab and keeps it
  /// after a stream change, so it is not content for any stream.
  it("does not count the starter query, for any stream", () => {
    expect(modesWithContent({ sql: 'SELECT * FROM "logs"' })).toEqual([]);
    expect(modesWithContent({ sql: 'SELECT * FROM "other"' })).toEqual([]);
  });

  it("counts real SQL", () => {
    expect(modesWithContent({ sql: "SELECT * FROM \"logs\" WHERE level = 'error'" })).toEqual([
      "sql",
    ]);
  });

  it("counts a Builder with one complete condition", () => {
    expect(modesWithContent({ conditions: builder })).toEqual(["custom"]);
  });

  it("never returns PromQL on a logs stream", () => {
    expect(modesWithContent({ promql: "up", streamType: "logs" })).toEqual([]);
  });

  it("returns PromQL on a metrics stream", () => {
    expect(modesWithContent({ promql: "up", streamType: "metrics" })).toEqual(["promql"]);
  });

  it("orders Builder, SQL, PromQL", () => {
    expect(
      modesWithContent({
        promql: "up",
        sql: "SELECT 1",
        conditions: builder,
        streamType: "metrics",
      }),
    ).toEqual(["custom", "sql", "promql"]);
  });
});
