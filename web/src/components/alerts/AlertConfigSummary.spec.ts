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

//! The alert status page's configuration summary (Feature 5, Phase 3.3).
//!
//! An SLO alert has no stream, no SQL and no aggregation, so the generic
//! summary answered "what is this alert watching?" with five em dashes. The SLO
//! branch has to answer it with the thing that IS configured: the SLO, the kind
//! of condition, its thresholds and its burn windows.

import { describe, expect, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

import AlertConfigSummary from "@/components/alerts/AlertConfigSummary.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

/** The whole field block (label + value). */
const field = (wrapper: any, key: string) =>
  wrapper.find(`[data-test="alerts-alertconfigsummary-${key}"]`);

/** The read-only input that shows a short value. */
const input = (wrapper: any, key: string) =>
  field(wrapper, key).find(`[data-test="alerts-alertconfigsummary-${key}-input-field"]`);

/** Just the VALUE, so neither the label's words nor a raw JSON dump can satisfy an assertion. */
const value = (wrapper: any, key: string): string => {
  const code = field(wrapper, key).find(
    `[data-test="alerts-alertconfigsummary-${key}-code-pre"] code`,
  );
  if (code.exists()) return code.text().trim();
  if (input(wrapper, key).exists()) return (input(wrapper, key).element as HTMLInputElement).value;
  return field(wrapper, key).findComponent(OTag).text().trim();
};

const mountSummary = (alert: any, props: Record<string, any> = {}) =>
  mount(AlertConfigSummary, {
    props: { alert, ...props },
    global: { plugins: [i18n, store, router] },
  });

/**
 * A burn-rate SLO alert, in the single-GET shape (`query_condition`).
 *
 * `operator` is not optional decoration: `SloCondition::operator` has no
 * skip_serializing_if (src/config/src/meta/slo/condition.rs), so it is on every
 * stored condition and the rendered threshold has to include it.
 */
const sloAlert = (sloCondition: Record<string, any> = {}) => ({
  id: "alert-1",
  name: "checkout-burn-14.4x-1h",
  destinations: ["pagerduty"],
  trigger_condition: { period: 1, frequency: 1, silence: 30 },
  query_condition: {
    type: "slo",
    slo_condition: {
      slo_id: "slo-123",
      kind: "burn_rate",
      operator: ">",
      critical: 14.4,
      warning: 6,
      long_window_secs: 3600,
      short_window_secs: 300,
      ...sloCondition,
    },
  },
});

/** A missing i18n key makes t() echo the key back, which turns any
 *  `rendered === t(key)` assertion into a tautology. */
const translated = (key: string, params?: Record<string, any>, plural?: number) => {
  const out =
    plural === undefined
      ? i18n.global.t(key, params ?? {})
      : i18n.global.t(key, params ?? {}, plural);
  expect(out, `i18n key "${key}" is not translated`).not.toBe(key);
  return out;
};

/** An unset value stays empty, so the input's "Not set" placeholder is what reads. */
const expectNotSet = (wrapper: any, key: string) => {
  expect(input(wrapper, key).exists(), `${key} is not a read-only input`).toBe(true);
  expect(value(wrapper, key)).toBe("");
  expect(input(wrapper, key).attributes("placeholder")).toBe(translated("alerts.configNotSet"));
};

afterEach(() => {});

describe("AlertConfigSummary — non-SLO alerts (regression)", () => {
  it("still describes the stream an ordinary alert watches", () => {
    const wrapper = mountSummary({
      stream_name: "default",
      stream_type: "logs",
      query_condition: { type: "sql", sql: "select 1" },
      trigger_condition: { period: 5, frequency: 5, silence: 10 },
    });

    expect(value(wrapper, "stream")).toBe("default");
    expect(value(wrapper, "stream-type")).toBe("logs");
    expect(value(wrapper, "condition")).toBe("select 1");
    // And it must NOT grow an SLO row it has no data for.
    expect(field(wrapper, "slo").exists()).toBe(false);
    expect(field(wrapper, "slo-kind").exists()).toBe(false);
  });
});

describe("AlertConfigSummary — SLO alerts", () => {
  it("replaces the stream fields, which an SLO alert does not have", () => {
    const wrapper = mountSummary(sloAlert(), { sloName: "checkout-availability" });

    // Positive anchor first: without it, a component that rendered NOTHING at
    // all would satisfy every absence assertion below.
    expect(field(wrapper, "slo").exists()).toBe(true);

    expect(field(wrapper, "stream").exists()).toBe(false);
    expect(field(wrapper, "stream-type").exists()).toBe(false);
    expect(field(wrapper, "group-by").exists()).toBe(false);
    expect(field(wrapper, "evaluation-mode").exists()).toBe(false);
  });

  it("names the SLO and links to it", () => {
    const wrapper = mountSummary(sloAlert(), { sloName: "checkout-availability" });

    expect(value(wrapper, "slo")).toBe("checkout-availability");
    const link = field(wrapper, "slo").find('[data-test="alerts-alertconfigsummary-slo-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toMatch(/\/slos\/slo-123(\?|$)/);
    // Icon-only, so its accessible name comes from aria-label.
    expect(link.attributes("aria-label")).toBe(translated("alerts.openSlo"));
  });

  // The name needs a second fetch, which can fail or be skipped when SLOs are
  // disabled. The id is still an answer; a blank is not.
  it("falls back to the raw slo_id when the name was not resolved", () => {
    const wrapper = mountSummary(sloAlert());
    expect(value(wrapper, "slo")).toBe("slo-123");
  });

  it("offers no link when the SLO cannot be determined", () => {
    const wrapper = mountSummary({
      ...sloAlert(),
      query_condition: { type: "slo", slo_condition: null },
    });

    // Still in the SLO branch — the stream fields stay suppressed…
    expect(field(wrapper, "stream").exists()).toBe(false);
    expect(field(wrapper, "slo-kind").exists()).toBe(true);
    // …but nothing is asserted that isn't known. "Burn rate" here would be an
    // invention, and the string "undefined" would be worse.
    expectNotSet(wrapper, "slo-kind");
    expectNotSet(wrapper, "slo");
    expect(wrapper.find('[data-test="alerts-alertconfigsummary-slo-link"]').exists()).toBe(false);
  });

  it("shows the burn-rate kind, both thresholds and both windows", () => {
    const wrapper = mountSummary(sloAlert(), { sloName: "checkout-availability" });

    expect(value(wrapper, "slo-kind")).toBe(translated("slos.alert.kind.burnRate"));
    // The operator is part of the threshold: ">" and ">=" are different alerts.
    expect(value(wrapper, "condition")).toBe(`${translated("slos.alert.burnRate")} > 14.4`);
    expect(value(wrapper, "warning")).toBe(`${translated("slos.alert.burnRate")} > 6`);
    expect(value(wrapper, "long-window")).toBe("1h");
    expect(value(wrapper, "short-window")).toBe("5m");
  });

  // Different numbers AND a different operator, so neither the threshold nor
  // the comparison can be a constant lifted from the happy-path fixture. The
  // warning line shares the operator (SA: one operator per condition) and is
  // asserted here too — it is the line most likely to be left hardcoded.
  it("reads the thresholds and the operator from the condition, not a constant", () => {
    const wrapper = mountSummary(sloAlert({ operator: ">=", critical: 3.5, warning: 1.25 }));

    expect(value(wrapper, "condition")).toBe(`${translated("slos.alert.burnRate")} >= 3.5`);
    expect(value(wrapper, "warning")).toBe(`${translated("slos.alert.burnRate")} >= 1.25`);
  });

  // Two different window pairs, so "1h"/"5m" cannot be literals.
  it("formats whatever windows the condition carries", () => {
    const wrapper = mountSummary(sloAlert({ long_window_secs: 21600, short_window_secs: 1800 }));

    expect(value(wrapper, "long-window")).toBe("6h");
    expect(value(wrapper, "short-window")).toBe("30m");
  });

  // `period` is inert for this family — `evaluate_slo_alert` never reads it,
  // and the SLO form does not offer it. Showing a "look-back window" invents a
  // knob the alert does not have.
  it("drops the look-back period, which this family does not use", () => {
    const wrapper = mountSummary(sloAlert());

    expect(field(wrapper, "slo-kind").exists()).toBe(true);
    expect(field(wrapper, "period").exists()).toBe(false);
  });

  it("omits the windows for an error-budget condition, which has none", () => {
    const wrapper = mountSummary(
      sloAlert({
        kind: "error_budget",
        critical: 50,
        warning: undefined,
        long_window_secs: undefined,
        short_window_secs: undefined,
      }),
    );

    expect(value(wrapper, "slo-kind")).toBe(translated("slos.alert.kind.errorBudget"));
    expect(value(wrapper, "condition")).toBe(`${translated("slos.alert.budgetConsumed")} > 50%`);
    expect(field(wrapper, "long-window").exists()).toBe(false);
    expect(field(wrapper, "short-window").exists()).toBe(false);
  });

  // A budget percentage keeps its "%" on the warning line too, and neither
  // number is the fixture's happy-path 50.
  it("renders an error-budget warning as a percentage", () => {
    const wrapper = mountSummary(
      sloAlert({
        kind: "error_budget",
        operator: ">=",
        critical: 25,
        warning: 10,
        long_window_secs: undefined,
        short_window_secs: undefined,
      }),
    );

    expect(value(wrapper, "condition")).toBe(`${translated("slos.alert.budgetConsumed")} >= 25%`);
    expect(value(wrapper, "warning")).toBe(`${translated("slos.alert.budgetConsumed")} >= 10%`);
  });

  it("leaves an unset warning Not set rather than a dangling operator", () => {
    const wrapper = mountSummary(sloAlert({ warning: undefined }));

    // Anchored in the SLO branch — the generic branch also leaves it unset here.
    expect(field(wrapper, "slo-kind").exists()).toBe(true);
    // Empty, so a dangling "burn rate >" cannot pass.
    expectNotSet(wrapper, "warning");
  });

  // The schedule half is shared and must survive the branch.
  it("keeps the schedule section", () => {
    const wrapper = mountSummary(sloAlert());

    // Anchored, so this cannot pass by virtue of the SLO branch not existing.
    expect(field(wrapper, "slo-kind").exists()).toBe(true);
    expect(value(wrapper, "frequency")).toBe("1 min");
    expect(value(wrapper, "silence")).toBe("30 min");
    expect(value(wrapper, "destinations")).toBe("pagerduty");
  });
});

/** The flat config row the GET falls back to: no `query_condition`, no
 *  `trigger_condition`, no `destinations` — every field the generic branch
 *  reads is absent (src/api/management/src/request/alerts/mod.rs). */
const anomalyConfig = (overrides: Record<string, any> = {}) => ({
  anomaly_id: "3AqVqADDbGyRpAPWYuDJ2vD9eFv",
  alert_type: "anomaly_detection",
  name: "checkout-latency-anomaly",
  stream_name: "default",
  stream_type: "logs",
  enabled: true,
  query_mode: "filters",
  detection_function: "avg(took)",
  filters: [{ field: "service", operator: "=", value: "checkout" }],
  custom_sql: null,
  histogram_interval: "5m",
  schedule_interval: "1h",
  detection_window_seconds: 3600,
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 97,
  is_trained: true,
  training_completed_at: 1788134400000000,
  current_model_version: 3,
  last_error: null,
  status: "ready",
  alert_enabled: true,
  alert_destinations: ["pagerduty"],
  ...overrides,
});

describe("AlertConfigSummary — anomaly detection configs", () => {
  it("describes what the config watches instead of five em dashes", () => {
    const wrapper = mountSummary(anomalyConfig());

    expect(value(wrapper, "stream")).toBe("default");
    expect(value(wrapper, "stream-type")).toBe("logs");
    expect(value(wrapper, "query-mode")).toBe(translated("alerts.anomaly.filters"));
    expect(value(wrapper, "detection-function")).toBe("avg(took)");
    expect(value(wrapper, "filters")).toBe("service = 'checkout'");
    // No band width and no trained k yet: Auto, never the legacy percentile.
    expect(value(wrapper, "sensitivity")).toBe(translated("alerts.anomaly.sensitivityAuto"));
  });

  it("shows the enforced cap for a budget-mode config instead of the derived percentile", () => {
    const wrapper = mountSummary({ ...anomalyConfig(), alert_budget_per_day: 2 });
    expect(value(wrapper, "sensitivity")).toBe(
      translated("alerts.anomaly.summaryBudgetPerDay", { count: 2 }),
    );

    const weekly = mountSummary({ ...anomalyConfig(), alert_budget_per_day: 1 / 7 });
    expect(value(weekly, "sensitivity")).toBe(
      translated("alerts.anomaly.summaryBudgetPerWeek", { count: 1 }),
    );
  });

  it("renders the anomaly schedule, which lives on the config row, not trigger_condition", () => {
    const wrapper = mountSummary(anomalyConfig());

    expect(value(wrapper, "schedule-interval")).toBe("1h");
    expect(value(wrapper, "histogram-interval")).toBe("5m");
    expect(value(wrapper, "detection-window")).toBe("1h");
    expect(value(wrapper, "training-window")).toBe(
      translated("alerts.anomaly.nDays", { days: 14 }, 14),
    );
    expect(value(wrapper, "retrain-interval")).toBe(
      translated("alerts.anomaly.nDays", { days: 7 }, 7),
    );
    expect(value(wrapper, "notifications")).toBe(translated("alerts.anomaly.enabled"));
    // The generic branch reads `destinations`, absent from this payload.
    expect(value(wrapper, "destinations")).toBe("pagerduty");
    // The generic branch's rows must not leak in.
    expect(field(wrapper, "period").exists()).toBe(false);
    expect(field(wrapper, "evaluation-mode").exists()).toBe(false);
  });

  it("reports the model state", () => {
    const wrapper = mountSummary(anomalyConfig());

    // The same badge the alert list renders, so one status cannot read two
    // ways — and so it is localized rather than showing the wire token.
    expect(value(wrapper, "status")).toBe(translated("components.badge.alertStatus.ready"));
    expect(field(wrapper, "status").findComponent(OTag).exists()).toBe(true);
    expect(input(wrapper, "status").exists()).toBe(false);
    expect(value(wrapper, "model-version")).toBe("3");
    expect(value(wrapper, "last-trained")).toBe("2026-08-31 00:00:00");
    // A permanent empty row would imply a slot worth watching.
    expect(field(wrapper, "last-error").exists()).toBe(false);
  });

  it("explains the band: grouping, training span, and Auto with the trained k", () => {
    const wrapper = mountSummary(
      anomalyConfig({
        band_grouping: "weekend_hour",
        band_k: 3.4567,
        training_data_start_us: 1786924800000000,
        training_data_end_us: 1788134400000000,
      }),
    );

    expect(value(wrapper, "band-grouping")).toBe(
      translated("alerts.anomaly.bandGroupingWeekendHour"),
    );
    expect(value(wrapper, "training-span")).toBe(
      translated("alerts.anomaly.trainingSpanValue", {
        start: "2026-08-17 00:00:00",
        end: "2026-08-31 00:00:00",
      }),
    );
    expect(value(wrapper, "sensitivity")).toBe(
      translated("alerts.anomaly.sensitivityAutoTrained", { k: 3.46 }),
    );
    expect(field(wrapper, "band-width").exists()).toBe(false);
  });

  it.each(["failed", "training", "waiting"])(
    "does not present a stale learned level as active when %s",
    (status) => {
      const wrapper = mountSummary(anomalyConfig({ status, band_k: 3.4567 }));
      expect(value(wrapper, "sensitivity")).toBe(translated("alerts.anomaly.sensitivityAuto"));
    },
  );

  it("shows the set band width as the sensitivity, over the trained k", () => {
    const wrapper = mountSummary(anomalyConfig({ band_width: 3.5, band_k: 3.2 }));
    expect(value(wrapper, "sensitivity")).toBe("3.5σ");
  });

  it("shows the alert direction and the window share with the server defaults filled in", () => {
    const defaults = mountSummary(anomalyConfig());
    expect(value(defaults, "alert-direction")).toBe(translated("alerts.anomaly.directionBoth"));
    expect(value(defaults, "window-share")).toBe(
      translated("alerts.anomaly.windowShareCompact", { fire: 100, buckets: 1, recover: 100 }),
    );

    const set = mountSummary(
      anomalyConfig({
        alert_direction: "above",
        alert_window_buckets: 5,
        alert_window_fire_pct: 80,
        alert_window_recover_pct: 60,
      }),
    );
    expect(value(set, "alert-direction")).toBe(translated("alerts.anomaly.directionAbove"));
    expect(value(set, "window-share")).toBe(
      translated("alerts.anomaly.windowShareCompact", { fire: 80, buckets: 5, recover: 60 }),
    );
  });

  it("names every grouping the trainer writes, and the retired ones a row keeps until retrain", () => {
    expect(
      value(mountSummary(anomalyConfig({ band_grouping: "hour_of_week" })), "band-grouping"),
    ).toBe(translated("alerts.anomaly.bandGroupingHourOfWeek"));
    expect(
      value(mountSummary(anomalyConfig({ band_grouping: "hour_of_day" })), "band-grouping"),
    ).toBe(translated("alerts.anomaly.bandGroupingHourOfDay"));
    expect(value(mountSummary(anomalyConfig({ band_grouping: "global" })), "band-grouping")).toBe(
      translated("alerts.anomaly.bandGroupingGlobal"),
    );
  });

  it("leaves the band fields Not set for a config trained before they existed", () => {
    const wrapper = mountSummary(anomalyConfig());
    expectNotSet(wrapper, "band-grouping");
    expectNotSet(wrapper, "training-span");
  });

  it("surfaces the training error when there is one", () => {
    const wrapper = mountSummary(
      anomalyConfig({ status: "failed", last_error: "not enough data points" }),
    );

    expect(value(wrapper, "last-error")).toBe("not enough data points");
    expect(field(wrapper, "last-error").classes()).toContain("col-span-full");
  });

  // "waiting" is the status every anomaly config carries until its first model
  // trains, and it was the one the badge group had no entry for.
  it("localizes the status an untrained config actually reports", () => {
    const wrapper = mountSummary(anomalyConfig({ status: "waiting", is_trained: false }));

    expect(value(wrapper, "status")).toBe(translated("components.badge.alertStatus.waiting"));
  });

  it("shows a never-trained config as never trained rather than as epoch zero", () => {
    const wrapper = mountSummary(
      anomalyConfig({
        is_trained: false,
        training_completed_at: null,
        status: "waiting",
        current_model_version: 0,
      }),
    );

    expectNotSet(wrapper, "last-trained");
    // `current_model_version` is NOT NULL and created as 0 — a version number
    // on a config that has no model.
    expectNotSet(wrapper, "model-version");
  });

  // 0 is the stored value for "train once and keep", not "unset".
  it("distinguishes retrain-never from an unset retrain interval", () => {
    expect(
      value(mountSummary(anomalyConfig({ retrain_interval_days: 0 })), "retrain-interval"),
    ).toBe(translated("alerts.anomaly.retrainNever"));
    expectNotSet(mountSummary(anomalyConfig({ retrain_interval_days: null })), "retrain-interval");
    // "1 days" is the reason this key is pluralized.
    expect(
      value(mountSummary(anomalyConfig({ retrain_interval_days: 1 })), "retrain-interval"),
    ).toBe(translated("alerts.anomaly.nDays", { days: 1 }, 1));
  });

  // The query builder drops a row whose operator needs a value it does not have;
  // the summary must not claim a condition the detection query never applies.
  it("ignores a half-filled filter row, as the query builder does", () => {
    const wrapper = mountSummary(
      anomalyConfig({
        filters: [
          { field: "service", operator: "=", value: "checkout" },
          { field: "code", operator: "=", value: "" },
          { field: "trace_id", operator: "Is Not Null", value: "" },
        ],
      }),
    );

    expect(value(wrapper, "filters")).toBe("service = 'checkout' AND trace_id IS NOT NULL");
  });

  it("shows the SQL rather than the filter rows in custom SQL mode", () => {
    const wrapper = mountSummary(
      anomalyConfig({
        query_mode: "custom_sql",
        custom_sql: "SELECT histogram(_timestamp, '5m'), count(*) FROM default",
      }),
    );

    expect(value(wrapper, "query-mode")).toBe(translated("alerts.customSql"));
    expect(value(wrapper, "custom-sql")).toContain("FROM default");
    // The modes are exclusive: the unused one's dash reads as a missing setting.
    expect(field(wrapper, "detection-function").exists()).toBe(false);
    expect(field(wrapper, "filters").exists()).toBe(false);
  });
});

describe("AlertConfigSummary — layout", () => {
  const SQL = "SELECT count(*) AS n FROM default\nWHERE eventName = 'ConsoleLogin'";
  const CODE = '[data-test$="-code"]';
  const generic = (queryCondition: Record<string, any>, extra: Record<string, any> = {}) => ({
    stream_name: "default",
    stream_type: "logs",
    trigger_condition: { period: 5, frequency: 5, silence: 10 },
    query_condition: queryCondition,
    ...extra,
  });
  const builder = (aggregation: Record<string, any>) =>
    generic({ type: "custom", aggregation: { function: "avg", ...aggregation } });
  const rowsBeside = (wrapper: any, key: string) => {
    const el = field(wrapper, key).element as HTMLElement;
    const rows = [...el.parentElement!.children];
    return { before: rows.slice(0, rows.indexOf(el)), after: rows.slice(rows.indexOf(el) + 1) };
  };
  const position = (wrapper: any, key: string) => {
    const el = field(wrapper, key).element as HTMLElement;
    return [...el.parentElement!.children].indexOf(el);
  };
  const expectQueryRow = (wrapper: any, key: string, lang: string) => {
    const block = field(wrapper, key).findComponent(OCodeBlock);
    expect(block.exists(), `${key} is not a code block`).toBe(true);
    expect(block.props("lang")).toBe(lang);
    expect(input(wrapper, key).exists()).toBe(false);
    expect(field(wrapper, key).classes()).toContain("col-span-full");
    // After the short fields, so it never splits a row of them.
    const { before, after } = rowsBeside(wrapper, key);
    expect(before.some((row) => !row.querySelector(CODE))).toBe(true);
    expect(after.every((row) => row.querySelector(CODE))).toBe(true);
  };
  const expectShortInput = (wrapper: any, key: string) => {
    expect(input(wrapper, key).exists(), `${key} is not a read-only input`).toBe(true);
    expect(field(wrapper, key).findComponent(OCodeBlock).exists()).toBe(false);
    expect(field(wrapper, key).classes()).not.toContain("col-span-full");
    expect(field(wrapper, key).classes()).not.toContain("sm:col-span-2");
  };

  it("shows each short value in a read-only input under its own label", () => {
    const wrapper = mountSummary(generic({ type: "sql", sql: SQL }));

    for (const key of ["stream-type", "stream", "period", "frequency", "silence"]) {
      expect(input(wrapper, key).attributes("readonly"), `${key} is editable`).toBeDefined();
    }
    expect(field(wrapper, "stream").find("label").text()).toBe(translated("alerts.streamName"));
    expect(value(wrapper, "stream")).toBe("default");
  });

  it("leaves an unset value empty so the Not set placeholder reads, not a dash", () => {
    const wrapper = mountSummary(generic({ type: "sql", sql: SQL }, { stream_name: "" }));
    expectNotSet(wrapper, "stream");
    expect(value(wrapper, "stream")).not.toBe("—");
  });

  it("puts the stream type before the stream name", () => {
    const ordinary = mountSummary(generic({ type: "sql", sql: SQL }));
    expect(position(ordinary, "stream-type")).toBeLessThan(position(ordinary, "stream"));

    const anomaly = mountSummary(anomalyConfig());
    expect(position(anomaly, "stream-type")).toBeLessThan(position(anomaly, "stream"));
  });

  it("gives a value too long for one column two columns, and leaves a short one in one", () => {
    const long = mountSummary(
      generic({ type: "sql", sql: SQL }, { stream_name: "k8s_cluster_production_audit_events" }),
    );
    expect(field(long, "stream").classes()).toContain("sm:col-span-2");

    const short = mountSummary(generic({ type: "sql", sql: SQL }));
    expectShortInput(short, "stream");
  });

  it("renders raw SQL as a full-row code block after the short fields, with no empty Warning", () => {
    const wrapper = mountSummary(generic({ type: "sql", sql: SQL }));
    expectQueryRow(wrapper, "condition", "sql");
    expect(value(wrapper, "condition")).toBe(SQL);
    expect(field(wrapper, "warning").exists()).toBe(false);
  });

  it("keeps a builder threshold beside its warning, both short inputs", () => {
    const wrapper = mountSummary(
      builder({ having: { column: "latency", operator: ">", value: 500 }, warning_value: 200 }),
    );
    expect(value(wrapper, "condition")).toBe("avg(latency) > 500");
    expect(value(wrapper, "warning")).toBe("avg(latency) > 200");
    expectShortInput(wrapper, "condition");
    expectShortInput(wrapper, "warning");
  });

  it("keeps a builder threshold's unset Warning, which says no warning level is set", () => {
    const wrapper = mountSummary(
      builder({ having: { column: "latency", operator: ">", value: 1 } }),
    );
    expectNotSet(wrapper, "warning");
  });

  it("renders a PromQL rule as a full-row code block, and keeps a PromQL threshold beside its warning", () => {
    const rule = mountSummary(
      generic({ type: "promql", promql_rule_mode: true, promql: "sum(rate(errors[5m])) > 1" }),
    );
    expectQueryRow(rule, "condition", "promql");
    expect(field(rule, "warning").exists()).toBe(false);

    const threshold = mountSummary(
      generic({
        type: "promql",
        promql_condition: { operator: ">", value: 0.9 },
        promql_warning_value: 0.5,
      }),
    );
    expectShortInput(threshold, "condition");
    expect(value(threshold, "warning")).toBe("> 0.5");
  });

  it("renders an anomaly config's custom SQL and its filters as full-row code blocks", () => {
    const sql = mountSummary(anomalyConfig({ query_mode: "custom_sql", custom_sql: SQL }));
    expectQueryRow(sql, "custom-sql", "sql");
    expect(value(sql, "custom-sql")).toBe(SQL);

    const filters = mountSummary(anomalyConfig());
    expectQueryRow(filters, "filters", "sql");
    expectShortInput(filters, "detection-function");
  });
});
