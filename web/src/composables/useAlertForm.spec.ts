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
  applyIntentPrefill,
  applyPromqlPrefill,
  defaultAlertValue,
  formForecastOf,
  pruneIncompleteConditions,
} from "@/composables/useAlertForm";
import { generateSqlQuery } from "@/utils/alerts/alertQueryBuilder";
import { getAlertPayload } from "@/utils/alerts/alertPayload";
import {
  buildForecastAlertPromql,
  forecastModeFields,
  type ForecastAlert,
} from "@/utils/alerts/forecastAlert";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const FORECAST: ForecastAlert = {
  U: "1 - node_filesystem_avail_bytes / node_filesystem_size_bytes",
  T: 0.9,
  direction: "rises",
  W: "2d",
  H: 7,
};

const form = () => ({ ...defaultAlertValue(), _ui: { checkEvery: 10, pendingPeriod: 0 } });

const promqlPrefill = (overrides: Partial<AlertPrefill> = {}): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "panel",
  sourceLabel: "Disk",
  streamType: "metrics",
  streamName: "node_filesystem_avail_bytes",
  queryType: "promql",
  promql: "avg(up)",
  warnings: [],
  ...overrides,
});

describe("applyPromqlPrefill", () => {
  it("opens Forecast mode, with multi mode and the >= 1 gate, for a generated forecast query", () => {
    const data = applyPromqlPrefill(
      form(),
      promqlPrefill({
        promql: buildForecastAlertPromql(FORECAST),
        promqlCondition: { column: "value", operator: "<=", value: 7 },
      }),
    );

    expect(data._ui.forecast).toEqual(FORECAST);
    expect(data.query_condition.type).toBe("promql");
    expect(data.query_condition.promql_multi_alert).toBe(true);
    expect(data.trigger_condition.threshold).toBe(1);
    expect(data.trigger_condition.operator).toBe(">=");
  });

  it("copies the multi flag of an ordinary PromQL prefill and stays in Threshold mode", () => {
    const data = applyPromqlPrefill(
      form(),
      promqlPrefill({
        promqlCondition: { column: "value", operator: ">=", value: 3 },
        promqlMultiAlert: true,
      }),
    );

    expect(data._ui.forecast).toBeNull();
    expect(data.query_condition.promql).toBe("avg(up)");
    expect(data.query_condition.promql_multi_alert).toBe(true);
    expect(data.query_condition.promql_condition).toEqual({
      column: "value",
      operator: ">=",
      value: 3,
    });
  });

  it("leaves a hand-edited forecast query in Threshold mode, text unchanged", () => {
    const edited = buildForecastAlertPromql(FORECAST).replace("36500", "1000");
    const data = applyPromqlPrefill(
      form(),
      promqlPrefill({
        promql: edited,
        promqlCondition: { column: "value", operator: "<=", value: 7 },
      }),
    );

    expect(data._ui.forecast).toBeNull();
    expect(data.query_condition.promql).toBe(edited);
  });
});

describe("formForecastOf", () => {
  it("recognises a saved forecast alert, so it reopens in Forecast mode", () => {
    const saved = form();
    saved.query_condition.type = "promql";
    saved.query_condition.promql = buildForecastAlertPromql(FORECAST);
    saved.query_condition.promql_condition = { column: "value", operator: "<=", value: 7 };
    expect(formForecastOf(saved)).toEqual(FORECAST);

    saved.query_condition.promql_condition.operator = "<";
    expect(formForecastOf(saved)).toBeNull();

    saved.query_condition.promql_condition.operator = "<=";
    saved.query_condition.type = "sql";
    expect(formForecastOf(saved)).toBeNull();
  });
});

describe("forecastModeFields", () => {
  it("sets multi mode and the >= 1 gate along with the generated query", () => {
    expect(forecastModeFields(FORECAST)).toEqual({
      "query_condition.promql": buildForecastAlertPromql(FORECAST),
      "query_condition.promql_condition": { column: "value", operator: "<=", value: 7 },
      "query_condition.promql_multi_alert": true,
      "trigger_condition.threshold": 1,
      "trigger_condition.operator": ">=",
    });
  });

  it("generates no query until the expression and threshold are set", () => {
    expect(forecastModeFields({ ...FORECAST, U: "  " })["query_condition.promql"]).toBe("");
    expect(forecastModeFields({ ...FORECAST, T: Number.NaN })["query_condition.promql"]).toBe("");
  });
});

describe("saving in Forecast mode", () => {
  const context = {
    store: { state: { selectedOrganization: { identifier: "org" }, userInfo: { email: "a@b.c" } } },
    isAggregationEnabled: { value: false },
    getSelectedTab: { value: "promql" },
    beingUpdated: false,
  };
  const withWarning = (forecast: ForecastAlert | null) => {
    const data: any = form();
    data.query_condition.type = "promql";
    data.query_condition.promql = buildForecastAlertPromql(FORECAST);
    data.query_condition.promql_condition = { column: "value", operator: "<=", value: 7 };
    data.query_condition.promql_warning_value = 14;
    data._ui.forecast = forecast;
    return data;
  };

  it("clears the warning value", () => {
    const payload = getAlertPayload(withWarning(FORECAST), context);
    expect(payload.query_condition.promql_warning_value).toBeUndefined();
    expect(payload._ui).toBeUndefined();
  });

  it("keeps it in Threshold mode", () => {
    const payload = getAlertPayload(withWarning(null), context);
    expect(payload.query_condition.promql_warning_value).toBe(14);
  });
});

describe("pruneIncompleteConditions", () => {
  const leaf = (id: string, column: string, operator: string, value: string) => ({
    filterType: "condition",
    column,
    operator,
    value,
    values: [],
    logicalOperator: "AND",
    id,
  });
  const group = (groupId: string, conditions: any[]) => ({
    filterType: "group",
    logicalOperator: "AND",
    groupId,
    conditions,
  });

  it("keeps the complete rows and drops the unfinished ones beside them", () => {
    const tree = group("root", [
      leaf("a", "level", "=", "error"),
      leaf("b", "", "=", ""),
      leaf("c", "service", "=", ""),
      leaf("d", "body", "is_null", ""),
      group("g1", [leaf("e", "", "=", "")]),
      group("g2", [leaf("f", "host", "=", "node-1"), leaf("g", "", "=", "x")]),
    ]);

    expect(pruneIncompleteConditions(tree)).toEqual(
      group("root", [
        leaf("a", "level", "=", "error"),
        leaf("d", "body", "is_null", ""),
        group("g2", [leaf("f", "host", "=", "node-1")]),
      ]),
    );
  });

  it("drops a row whose value is null, as the form treats it as missing", () => {
    const tree = group("root", [
      leaf("a", "level", "=", "error"),
      { ...leaf("b", "service", "=", ""), value: null },
    ]);

    expect(pruneIncompleteConditions(tree)).toEqual(
      group("root", [leaf("a", "level", "=", "error")]),
    );
  });

  it("does not touch the tree it was given", () => {
    const tree = group("root", [leaf("a", "level", "=", "error"), leaf("b", "", "=", "")]);
    pruneIncompleteConditions(tree);
    expect(tree.conditions).toHaveLength(2);
  });

  it("leaves no WHERE clause when every row is unfinished", () => {
    const tree = group("root", [leaf("a", "", "=", ""), leaf("b", "level", "=", "")]);
    const pruned = pruneIncompleteConditions(tree);
    const data: any = form();
    data.stream_name = "app";
    data.query_condition.conditions = pruned;

    expect(pruned).toBeNull();
    expect(generateSqlQuery(data, {}, false)).not.toContain("WHERE");
  });
});

describe("applyIntentPrefill", () => {
  const intentPrefill = (overrides: Partial<AlertPrefill> = {}): AlertPrefill => ({
    version: ALERT_PREFILL_VERSION,
    source: "intent",
    sourceLabel: "default",
    streamType: "traces",
    streamName: "default",
    queryType: "custom",
    silenceMinutes: 60,
    pendingPeriodMinutes: 10,
    contextAttributes: { intent_id: "requests_get_slow" },
    intentDefaults: true,
    warnings: [],
    ...overrides,
  });

  it.each(["intent", "suggestion"])(
    "applies the hold, the context attributes and the note for the %s source",
    (source) => {
      const data: any = form();
      data.trigger_condition.silence = 60;
      data.notify_on_recovery = true;
      const note = applyIntentPrefill(data, intentPrefill({ source }));

      expect(data.pending_period_sec).toBe(10);
      expect(data._ui.pendingPeriod).toBe(10);
      expect(data.notify_on_recovery).toBe(false);
      expect(data.context_attributes).toEqual([
        expect.objectContaining({ key: "intent_id", value: "requests_get_slow" }),
      ]);
      expect(note).toEqual({ silenceMinutes: 60, pendingPeriodMinutes: 10 });
    },
  );

  it("replaces an existing attribute of the same key and keeps the others", () => {
    const data: any = form();
    data.context_attributes = [
      { key: "env", value: "prod", id: "1" },
      { key: "intent_id", value: "old", id: "2" },
    ];
    applyIntentPrefill(data, intentPrefill());

    expect(data.context_attributes.map((a: any) => [a.key, a.value])).toEqual([
      ["env", "prod"],
      ["intent_id", "requests_get_slow"],
    ]);
  });

  it("ignores the intent fields for any other source", () => {
    const data: any = form();
    const before = JSON.parse(JSON.stringify(data));
    const note = applyIntentPrefill(data, intentPrefill({ source: "logs" }));

    expect(note).toBeNull();
    expect(data).toEqual(before);
  });

  it("applies the fields but shows no note when the prefill does not ask for one", () => {
    const data: any = form();
    const note = applyIntentPrefill(data, intentPrefill({ intentDefaults: undefined }));

    expect(note).toBeNull();
    expect(data.pending_period_sec).toBe(10);
  });

  it("leaves the hold at zero for a count rule", () => {
    const data: any = form();
    data.trigger_condition.silence = 60;
    const note = applyIntentPrefill(data, intentPrefill({ pendingPeriodMinutes: undefined }));

    expect(data.pending_period_sec).toBe(0);
    expect(note).toEqual({ silenceMinutes: 60, pendingPeriodMinutes: 0 });
  });

  it("opens anomaly mode for an anomaly intent when anomaly detection is available", () => {
    const data: any = form();
    data.name = "payment_something_unusual";
    const note = applyIntentPrefill(data, intentPrefill({ alertType: "anomaly" }), true);

    expect(data.is_real_time).toBe("anomaly");
    expect(note).toBeNull();
  });

  it("keeps a scheduled alert for an anomaly intent when anomaly detection is off", () => {
    const data: any = form();
    applyIntentPrefill(data, intentPrefill({ alertType: "anomaly" }));
    expect(data.is_real_time).toBe("false");
  });

  it("never switches the alert type for a source off the intent path", () => {
    const data: any = form();
    applyIntentPrefill(data, intentPrefill({ source: "logs", alertType: "anomaly" }), true);
    expect(data.is_real_time).toBe("false");
  });
});
