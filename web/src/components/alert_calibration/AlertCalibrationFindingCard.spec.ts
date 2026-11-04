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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import type { FindingRecord } from "./digests";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const finding = (overrides: Partial<FindingRecord> = {}): FindingRecord => ({
  _timestamp: 1,
  org: "default",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  finding_count: 1,
  skip_count: 0,
  alerts_in_scope: 3,
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
  rule_id: "scheduler_health",
  severity: "Medium",
  confidence: "High",
  title: "In the last 24 hours the alert scheduler skipped 3 evaluation windows",
  actions: "ScaleAlertScheduler",
  evidence_schedulerhealth_affected_orgs: 2,
  evidence_schedulerhealth_skipped_windows: 3,
  evidence_schedulerhealth_late_ratio: 0.2,
  evidence_schedulerhealth_top_orgs: JSON.stringify([
    { org_id: "globex", skipped_windows: 3, late_evaluations: 0, evaluations: 100 },
    { org_id: "acme", skipped_windows: 0, late_evaluations: 40, evaluations: 100 },
  ]),
  ...overrides,
});

const mountCard = (record: FindingRecord) =>
  mount(AlertCalibrationFindingCard, {
    props: { finding: record },
    global: { plugins: [store] },
  });

describe("AlertCalibrationFindingCard", () => {
  it("lists a cluster finding's worst orgs in place of a single alert", () => {
    const wrapper = mountCard(finding());
    const rows = wrapper.findAll('[data-test="alert-calibration-finding-lag-row"]');
    expect(
      rows.map((row) =>
        row.findAll('[data-test="alert-calibration-finding-lag-cell"]').map((cell) => cell.text()),
      ),
    ).toEqual([
      ["globex", "3", "0", "100"],
      ["acme", "0", "40", "100"],
    ]);
    const list = wrapper.find('[data-test="alert-calibration-finding-org_id-list"]');
    expect(list.text()).toContain("Most affected orgs");
    expect(list.text()).toContain("Skipped windows");
    expect(list.text()).toContain("Late evaluations");
    expect(
      wrapper.find('[data-test="alert-calibration-finding-hour_start_micros-list"]').exists(),
    ).toBe(false);
  });

  it("labels each worst hour by when it started", () => {
    const hourStart = new Date(2026, 9, 15, 13, 0).getTime() * 1000;
    const wrapper = mountCard(
      finding({
        evidence_schedulerhealth_worst_hours: JSON.stringify([
          {
            hour_start_micros: hourStart,
            skipped_windows: 0,
            late_evaluations: 9,
            evaluations: 50,
          },
        ]),
      }),
    );
    const list = wrapper.find('[data-test="alert-calibration-finding-hour_start_micros-list"]');
    expect(list.text()).toContain("Worst hours");
    expect(list.text()).toContain("Oct 15, 13:00");
  });

  it("names the operator's settings in the scheduler action's description verbatim", () => {
    const wrapper = mountCard(finding());
    expect(wrapper.find('[data-test="alert-calibration-finding-actions"]').text()).toContain(
      "Raise ZO_ALERT_SCHEDULE_CONCURRENCY, add alert nodes, or raise ZO_SCHEDULER_PER_MODULE_PULLERS.",
    );
  });

  it("shows the tier and limits a version-2 record carries, and nothing for a version-1 record", () => {
    const v2 = mountCard(
      finding({
        schema_version: 2,
        kind: "finding",
        tier: "A",
        quality: "partial",
        limitations: JSON.stringify(["quiet_source"]),
      }),
    );
    expect(v2.find('[data-test="alert-calibration-finding-tier"]').text()).toBe(
      "Confirmed condition",
    );
    expect(v2.find('[data-test="alert-calibration-finding-quality"]').text()).toBe(
      "Partial evidence",
    );
    expect(v2.find('[data-test="alert-calibration-finding-limitations"]').text()).toContain(
      "A quiet source can be a batch or cron job that is idle by design.",
    );
    const v1 = mountCard(finding());
    expect(v1.find('[data-test="alert-calibration-finding-tier"]').exists()).toBe(false);
    expect(v1.find('[data-test="alert-calibration-finding-quality"]').exists()).toBe(false);
    expect(v1.find('[data-test="alert-calibration-finding-limitations"]').exists()).toBe(false);
  });

  it("lists nothing for a rule that names its alert", () => {
    const wrapper = mountCard(
      finding({ rule_id: "noise", alert_name: "cpu", actions: "RaiseThreshold" }),
    );
    expect(wrapper.find('[data-test="alert-calibration-finding-lag-row"]').exists()).toBe(false);
  });

  it("tracks opening the flagged alert with its rule", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        {
          path: "/alerts/detail/:alert_id",
          name: "alertDetail",
          component: { template: "<div />" },
        },
      ],
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: { finding: finding({ rule_id: "failure", alert_id: "a1" }) },
      global: { plugins: [store, router] },
    });
    await wrapper.find('[data-test="alert-calibration-finding-open-alert"]').trigger("click");
    expect(open).toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_finding_alert_opened", {
      rule: "failure",
      source: "digest",
    });
    open.mockRestore();
  });

  it("renders a v2 record's actions by their design labels and never a raw name", () => {
    const v2 = (insight_actions: unknown[]) =>
      mountCard(
        finding({
          schema_version: 2,
          kind: "finding",
          rule_id: "failure",
          alert_id: "a1",
          actions: undefined,
          insight_actions: JSON.stringify(insight_actions),
        }),
      );
    const wrapper = v2([
      { type: "review_alert", alert_id: "a1", focus: "query" },
      { type: "review_alert", alert_id: "a1" },
      { type: "review_alert", alert_id: "a1", focus: "settings" },
      { type: "review_alert", alert_id: "a1", focus: "threshold" },
      { type: "review_alert", alert_id: "a1", focus: "grouping" },
      { type: "review_platform" },
      { type: "test_send", destination: "pager" },
    ]);
    const panel = wrapper.find('[data-test="alert-calibration-finding-actions"]');
    expect(panel.exists()).toBe(true);
    expect(
      panel
        .findAll('[data-test="alert-calibration-finding-action-review_alert"]')
        .map((row) => row.text()),
    ).toEqual([
      "Review query",
      "Review alert",
      "Review settings",
      "Review threshold",
      "Review grouping",
    ]);
    expect(
      panel.find('[data-test="alert-calibration-finding-action-review_platform"]').text(),
    ).toBe("Inspect platform");
    expect(panel.text()).not.toMatch(/review_|test_send|pager|a1/);

    const v1 = mountCard(finding());
    expect(v1.find('[data-test="alert-calibration-finding-actions"]').text()).toContain(
      "Scale the alert scheduler",
    );

    const unknown = v2([{ type: "dismiss" }, { type: "review_alert", alert_id: "a1", focus: "x" }]);
    expect(unknown.find('[data-test="alert-calibration-finding-actions"]').exists()).toBe(false);
  });

  it("names why the evidence is degraded under the quality badge, and nothing when usable", () => {
    const reasons = JSON.stringify(["scan_truncated"]);
    const partial = mountCard(
      finding({ schema_version: 2, kind: "finding", quality: "partial", quality_reasons: reasons }),
    );
    expect(partial.find('[data-test="alert-calibration-finding-quality-reasons"]').text()).toBe(
      "Reason: wider searches timed out",
    );
    const usable = mountCard(
      finding({ schema_version: 2, kind: "finding", quality: "usable", quality_reasons: reasons }),
    );
    expect(usable.find('[data-test="alert-calibration-finding-quality-reasons"]').exists()).toBe(
      false,
    );
  });

  it("renders_a_not_working_card_with_pattern_evidence_advice_and_codes_and_never_a_raw_code", () => {
    const checkedAt = new Date(2026, 10, 4, 9, 30).getTime() * 1000;
    const notWorking = (overrides: Partial<FindingRecord>) =>
      finding({
        schema_version: 2,
        kind: "finding",
        rule_id: "failure",
        severity: "High",
        confidence: "High",
        alert_id: "a1",
        alert_name: "orders error rate",
        actions: undefined,
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_notworking_checked_at_micros: checkedAt,
        ...overrides,
      });
    const missing = mountCard(
      notWorking({
        pattern: "stream_missing",
        tier: "A",
        title: "orders error rate reads logs/orders_v1, which doesn't exist",
        advice: "check_missing_stream",
        insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a1", focus: "query" }]),
        evidence_notworking_stream: "logs/orders_v1",
        evidence_notworking_evaluation_errors: 86,
        evidence_notworking_evaluations: 90,
      }),
    );
    expect(missing.find('[data-test="alert-calibration-finding-rule"]').text()).toBe(
      "Alert not working",
    );
    const rows = missing.findAll("dt").map((dt) => dt.text());
    expect(rows).toEqual(["Stream", "Errors", "Evaluations", "Checked"]);
    const values = missing.findAll("dd").map((dd) => dd.text());
    expect(values).toEqual(["logs/orders_v1", "86", "90", "Nov 4, 09:30"]);
    const advice = missing.find('[data-test="alert-calibration-finding-advice"]').text();
    expect(advice).toContain("What to check");
    expect(advice).toContain("Check the source the query reads: it does not exist.");
    expect(missing.find('[data-test="alert-calibration-finding-limitations"]').exists()).toBe(
      false,
    );

    const quiet = mountCard(
      notWorking({
        pattern: "source_inactive",
        tier: "B",
        severity: "Medium",
        title: "orders error rate reads logs/batch_logs, which has no recent data",
        advice: "confirm_quiet_source",
        limitations: JSON.stringify(["quiet_source"]),
        insight_actions: JSON.stringify([
          { type: "review_source", stream_type: "logs", stream_name: "batch_logs" },
        ]),
        evidence_notworking_stream: "logs/batch_logs",
        evidence_notworking_last_data_at_micros: checkedAt,
      }),
    );
    expect(quiet.findAll("dt").map((dt) => dt.text())).toEqual(["Stream", "Last data", "Checked"]);
    expect(quiet.find('[data-test="alert-calibration-finding-tier"]').text()).toBe("Investigate");
    expect(quiet.find('[data-test="alert-calibration-finding-action-review_source"]').text()).toBe(
      "Review source",
    );
    expect(quiet.find('[data-test="alert-calibration-finding-limitations"]').text()).toContain(
      "A quiet source can be a batch or cron job that is idle by design.",
    );

    const unknown = mountCard(
      notWorking({
        pattern: "made_up",
        quality: "partial",
        advice: "made_up",
        limitations: JSON.stringify(["made_up"]),
        quality_reasons: JSON.stringify(["made_up"]),
        insight_actions: JSON.stringify([{ type: "made_up" }]),
      }),
    );
    expect(unknown.text()).not.toContain("made_up");
    for (const block of ["advice", "limitations", "quality-reasons", "actions"]) {
      expect(unknown.find(`[data-test="alert-calibration-finding-${block}"]`).exists()).toBe(false);
    }
  });
});
