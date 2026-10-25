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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/locales";
import config from "@/aws-exports";

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

describe("generateAlertSummary: Compare-with-Past windows", () => {
  // Returns the key, so a test asserts which sentence the summary chose.
  const keyT = (key: string) => key;

  const scheduledAlert = (type: string) => ({
    stream_name: "default",
    stream_type: "logs",
    is_real_time: "false",
    query_condition: {
      type,
      sql: 'SELECT count(*) FROM "default"',
      multi_time_range: [{ offSet: "1h" }],
    },
    trigger_condition: { period: 10, operator: ">=", threshold: 3, frequency: 10, silence: 10 },
    destinations: [],
  });

  it("lists the windows for a SQL alert", () => {
    expect(generateAlertSummary(scheduledAlert("sql"), [], keyT)).toContain(
      "alerts.summary.timeRangeCount",
    );
  });

  // The payload sends windows only with SQL, so the summary must not promise them.
  it("leaves out windows that a Builder alert does not save", () => {
    expect(generateAlertSummary(scheduledAlert("custom"), [], keyT)).not.toContain(
      "alerts.summary.timeRangeCount",
    );
  });
});

describe("generateAlertSummary: where it sends", () => {
  const noDestination = t("alerts.summary.noDestination");
  // Workflows and on-call teams only count where they run: enterprise and cloud builds.
  const isEnterprise = config.isEnterprise;
  beforeEach(() => {
    config.isEnterprise = "true";
  });
  afterEach(() => {
    config.isEnterprise = isEnterprise;
  });

  // On-call routing can still page a team, so the summary claims no more than "no destination".
  it("says an alert with nowhere to send has no destination", () => {
    const text = summary(forecastForm());
    expect(text).toContain(noDestination);
    expect(text).not.toMatch(/nobody/i);
  });

  it.each([
    ["a destination", { destinations: ["ops-slack"] }],
    ["only a workflow", { workflows: ["wf-1"] }],
    ["only an on-call team", { oncall_team: "sre" }],
  ])("does not say so for %s", (_case, targets) => {
    expect(summary({ ...forecastForm(), ...targets })).not.toContain(noDestination);
  });
});

describe("generateAlertSummary: aggregate rules state their own limit", () => {
  const aggregateForm = (having: Record<string, unknown> = {}, period = 10, fn = "avg") => ({
    stream_type: "metrics",
    stream_name: "node_load1",
    is_real_time: "false",
    query_condition: {
      type: "custom",
      aggregation: {
        function: fn,
        group_by: [],
        having: { column: "value", operator: ">=", value: 250, ...having },
      },
    },
    trigger_condition: { period, operator: ">=", threshold: 1, silence: 0 },
    destinations: [],
  });
  const aggSummary = (form: any, aggregate = true) =>
    generateAlertSummary(form, [], t, undefined, "", "", aggregate);

  it("builds the sentence from the function, column and limit", () => {
    const text = aggSummary(aggregateForm());
    expect(text).toContain("Alert me when the average of value is 250 or more over 10 minutes");
    expect(text).not.toContain("1+ events");
  });

  it("states the limit in Triggers when, not an event count", () => {
    const text = aggSummary(aggregateForm());
    expect(text).toContain("the average of value is 250 (≥) or more");
    expect(text).not.toContain("events detected");
  });

  it("follows the limit's operator and an hour period", () => {
    const text = aggSummary(aggregateForm({ operator: ">" }, 60, "max"));
    expect(text).toContain("Alert me when the maximum of value is more than 250 over 1 hour");
  });

  it("keeps a period that is not a whole number of hours in minutes", () => {
    const text = aggSummary(aggregateForm({}, 90));
    expect(text).toContain("Alert me when the average of value is 250 or more over 90 minutes");
  });

  it("names a percentile function", () => {
    const text = aggSummary(aggregateForm({ column: "took", operator: "<", value: 5 }, 1, "p95"));
    expect(text).toContain("Alert me when the p95 of took is less than 5 over 1 minute");
  });

  it("keeps the event wording when aggregation is off, even with a stale aggregation", () => {
    const text = aggSummary(aggregateForm(), false);
    expect(text).toContain("1+ events");
    expect(text).not.toContain("the average of value");
  });
});
