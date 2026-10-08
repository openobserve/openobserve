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
import { applyPromqlPrefill, defaultAlertValue, formForecastOf } from "@/composables/useAlertForm";
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
