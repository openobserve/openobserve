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
import i18n from "@/locales";

import { buildForecastAlertPromql } from "./forecastAlert";
import { generateAlertSummary } from "./alertSummaryGenerator";

const t = (key: string, named?: Record<string, unknown>, plural?: number): string =>
  plural === undefined
    ? (i18n.global.t as any)(key, named ?? {})
    : (i18n.global.t as any)(key, named ?? {}, plural);

const forecast = { U: "sum(disk_used)", T: 1500, direction: "rises", W: "2d", H: 7 };

const forecastForm = (overrides: Record<string, unknown> = {}) => ({
  stream_type: "metrics",
  stream_name: "disk_used",
  is_real_time: "false",
  query_condition: {
    type: "promql",
    promql: buildForecastAlertPromql({ U: "sum(disk_used)", T: 1500, direction: "rises", W: "2d" }),
    promql_condition: { column: "value", operator: "<=", value: 7 },
  },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, silence: 10 },
  pending_period_sec: 0,
  destinations: [],
  _ui: { forecast: { ...forecast, ...overrides } },
});

const summary = (form: any) => generateAlertSummary(form, [], t);

describe("generateAlertSummary in Forecast mode", () => {
  it("says what is forecast, not a threshold-mode event count", () => {
    const text = summary(forecastForm());
    expect(text).toContain("Alert when it is forecast to rise to 1500 within 7 days");
    expect(text).not.toContain("events occur");
    expect(text).not.toContain("events detected");
    expect(text).not.toContain("the last 5 minutes");
  });

  it("links the forecast phrases to a field the form can focus", () => {
    const text = summary(forecastForm());
    expect(text).not.toContain('data-focus-target="forecast"');
    expect(text.match(/data-focus-target="query"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("says fall for a falling forecast and a singular day", () => {
    const text = summary(forecastForm({ direction: "falls", T: 10, H: 1 }));
    expect(text).toContain("Alert when it is forecast to fall to 10 within 1 day");
  });

  it("names the forecast expression and history window, not the generated query", () => {
    const text = summary(forecastForm());
    expect(text).toContain("sum(disk_used)");
    expect(text).not.toContain("36500");
    expect(text).toContain(t("alerts.forecast.window2d"));
  });

  it("keeps the cooldown clause", () => {
    expect(summary(forecastForm())).toContain("but no more than once every 10 minutes");
  });

  it("falls back to the generic sentence until a threshold is entered", () => {
    const text = summary(forecastForm({ T: "" }));
    expect(text).toContain(t("alerts.summary.plainEnglish.defaultConditions"));
    expect(text).not.toContain("forecast to rise");
  });
});
