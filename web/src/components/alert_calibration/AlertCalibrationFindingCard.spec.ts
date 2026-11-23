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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { listByFolderId: vi.fn() } });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return { ...actual, default: { ...actual.default, reopenDismissal: vi.fn() } };
});

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import alertsService from "@/services/alerts";
import alertCalibration from "@/services/alert_calibration";
import { toast } from "@/lib/feedback/Toast/useToast";
import { ALERT_PREFILL_KEY } from "@/utils/alerts/alertPrefillStorage";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import AlertCalibrationDismissDialog from "./AlertCalibrationDismissDialog.vue";
import type { FindingRecord } from "./digests";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const listByFolderId = vi.mocked(alertsService.listByFolderId);
const OPS_LIST = { data: { list: [{ alert_id: "a1", name: "ops_quiet", folder_id: "ops" }] } };

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
  beforeEach(() => {
    queryClient.clear();
    listByFolderId.mockReset();
    listByFolderId.mockResolvedValue(OPS_LIST as never);
  });

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
    ).toEqual(["Review alert"]);
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

  it("a v2 card shows Apply first, Review buttons, and labels for the rest", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { render: () => h("div") } },
        {
          path: "/alerts/edit/:alert_id",
          name: "editAlert",
          component: { render: () => h("div") },
        },
      ],
    });
    await router.push("/");
    const push = vi.spyOn(router, "push");
    const apply = {
      type: "apply_suggestion",
      alert_id: "a1",
      patch: [{ field: "silence_minutes", from: 10, to: 45 }],
    };
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: {
        finding: finding({
          schema_version: 2,
          kind: "finding",
          rule_id: "noise",
          alert_id: "a1",
          alert_name: "ops_cpu",
          finding_id: "f1",
          actions: undefined,
          insight_actions: JSON.stringify([
            { type: "review_alert", alert_id: "a1", focus: "query" },
            apply,
            { type: "review_platform" },
          ]),
        }),
      },
      attachTo: document.body,
      global: { plugins: [store, router, withQueryClient()] },
    });
    const rows = wrapper
      .findAll('[data-test^="alert-calibration-finding-action-"]')
      .filter((row) => !row.attributes("data-test")?.endsWith("-button"));
    expect(rows.map((row) => row.attributes("data-test"))).toEqual([
      "alert-calibration-finding-action-apply_suggestion",
      "alert-calibration-finding-action-review_alert",
      "alert-calibration-finding-action-review_platform",
    ]);
    expect(rows.map((row) => row.text())).toEqual([
      "Review change",
      "Review alert",
      "Inspect platform",
    ]);
    expect(rows[0].find("button").exists()).toBe(true);
    expect(rows[1].find("button").exists()).toBe(true);
    expect(rows[2].find("button").exists()).toBe(false);

    await rows[1].get("button").trigger("click");
    await flushPromises();
    expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY)!)).toMatchObject({
      source: "calibration",
      target: { alertId: "a1", findingId: "f1" },
      focus: "query",
    });
    expect(push).toHaveBeenCalledWith({
      name: "editAlert",
      params: { alert_id: "a1" },
      query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
    });

    await rows[0].get("button").trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector('[data-test="alert-calibration-apply-dialog"]'),
    ).not.toBeNull();
    wrapper.unmount();
    sessionStorage.clear();

    const v1 = mountCard(finding());
    expect(
      v1.find('[data-test="alert-calibration-finding-action-ScaleAlertScheduler"] button').exists(),
    ).toBe(false);
  });

  describe("Review's folder", () => {
    const mountReview = async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", component: { render: () => h("div") } },
          {
            path: "/alerts/edit/:alert_id",
            name: "editAlert",
            component: { render: () => h("div") },
          },
        ],
      });
      await router.push("/");
      const push = vi.spyOn(router, "push");
      const wrapper = mount(AlertCalibrationFindingCard, {
        props: {
          finding: finding({
            schema_version: 2,
            kind: "finding",
            rule_id: "noise",
            alert_id: "a1",
            alert_name: "ops_quiet",
            finding_id: "f1",
            actions: undefined,
            insight_actions: JSON.stringify([
              { type: "review_alert", alert_id: "a1", focus: "query" },
            ]),
          }),
        },
        attachTo: document.body,
        global: { plugins: [store, router, withQueryClient()] },
      });
      const button = wrapper.get(
        '[data-test="alert-calibration-finding-action-review_alert-button"]',
      );
      return { wrapper, push, button };
    };

    it("Review opens the alert in its own folder", async () => {
      let resolve!: (value: unknown) => void;
      listByFolderId.mockReturnValue(new Promise((r) => (resolve = r)) as never);
      const { wrapper, push, button } = await mountReview();

      await button.trigger("click");
      await nextTick();
      expect(button.attributes("aria-busy")).toBe("true");
      await button.trigger("click");
      expect(push).not.toHaveBeenCalled();

      resolve(OPS_LIST);
      await flushPromises();
      expect(listByFolderId).toHaveBeenCalledTimes(1);
      expect(listByFolderId.mock.calls[0].slice(5, 8)).toEqual(["default", "", "ops_quiet"]);
      expect(push).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith({
        name: "editAlert",
        params: { alert_id: "a1" },
        query: { org_identifier: "default", prefill: "calibration", folder: "ops" },
      });
      expect(button.attributes("aria-busy")).toBeUndefined();
      wrapper.unmount();
    });

    it("an unknown folder leaves the link as it is today", async () => {
      for (const answer of [
        () =>
          listByFolderId.mockRejectedValue(
            Object.assign(new Error("HTTP 403"), { response: { status: 403 } }),
          ),
        () =>
          listByFolderId.mockResolvedValue({
            data: { list: [{ alert_id: "a2", name: "ops_quiet", folder_id: "pay" }] },
          } as never),
      ]) {
        queryClient.clear();
        answer();
        const { wrapper, push, button } = await mountReview();
        await button.trigger("click");
        await flushPromises();
        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][0]).toStrictEqual({
          name: "editAlert",
          params: { alert_id: "a1" },
          query: { org_identifier: "default", prefill: "calibration" },
        });
        wrapper.unmount();
      }
      expect(toast).not.toHaveBeenCalled();
    });
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
      "Open in Logs",
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

  it("renders_error_class_rows_and_codes_and_never_a_raw_code", () => {
    const at = (day: number, hour: number, minute = 0) =>
      new Date(2026, 10, day, hour, minute).getTime() * 1000;
    const failing = (overrides: Partial<FindingRecord>) =>
      finding({
        schema_version: 2,
        kind: "finding",
        rule_id: "failure",
        severity: "High",
        confidence: "High",
        alert_id: "a5",
        alert_name: "checkout latency",
        actions: undefined,
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_schedulerhealth_affected_orgs: undefined,
        evidence_schedulerhealth_skipped_windows: undefined,
        evidence_schedulerhealth_late_ratio: undefined,
        insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a5", focus: "query" }]),
        evidence_notworking_evaluation_errors: 30,
        evidence_notworking_evaluations: 100,
        ...overrides,
      });
    const timeout = mountCard(
      failing({
        pattern: "resource_timeout",
        title: "checkout latency failed 30 of 100 evaluations: the query timed out",
        evidence_notworking_error_class: "resource_timeout",
        evidence_notworking_class_errors: 30,
        evidence_notworking_first_failure_micros: at(4, 14, 3),
        evidence_notworking_last_failure_micros: at(5, 9),
        evidence_notworking_last_success_micros: at(4, 13),
        evidence_notworking_last_edit_micros: at(4, 14, 1),
        limitations: JSON.stringify(["edit_timing_only"]),
      }),
    );
    expect(timeout.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "Error type",
      "Errors of this type",
      "First recorded failure",
      "Last recorded failure",
      "Last recorded success",
      "Latest alert edit",
    ]);
    expect(timeout.findAll("dd").map((dd) => dd.text())).toEqual([
      "30",
      "100",
      "Query timed out",
      "30",
      "Nov 4, 14:03",
      "Nov 5, 09:00",
      "Nov 4, 13:00",
      "Nov 4, 14:01",
    ]);
    expect(timeout.find('[data-test="alert-calibration-finding-tier"]').exists()).toBe(false);
    expect(timeout.find('[data-test="alert-calibration-finding-limitations"]').text()).toContain(
      "The latest edit is shown for timing only; it is not a confirmed cause.",
    );

    const merged = mountCard(
      failing({
        alert_id: "a1",
        pattern: "stream_missing",
        tier: "A",
        title: "orders error rate reads logs/orders_v1, which doesn't exist",
        advice: "check_missing_stream",
        evidence_notworking_stream: "logs/orders_v1",
        evidence_notworking_checked_at_micros: at(5, 9, 30),
        evidence_notworking_error_class: "stream_missing",
        evidence_notworking_class_errors: 30,
        evidence_notworking_first_failure_micros: at(4, 14, 3),
        evidence_notworking_last_failure_micros: at(5, 9),
        limitations: JSON.stringify(["no_success_in_window"]),
      }),
    );
    expect(merged.findAll("dt").map((dt) => dt.text())).toEqual([
      "Stream",
      "Errors",
      "Evaluations",
      "Checked",
      "Error type",
      "Errors of this type",
      "First recorded failure",
      "Last recorded failure",
    ]);
    expect(merged.find('[data-test="alert-calibration-finding-limitations"]').text()).toContain(
      "No successful evaluation is recorded in this window, so when it last worked is unknown.",
    );

    const errorsOnly = mountCard(
      failing({
        pattern: "stream_missing",
        tier: "A",
        advice: "check_stream_not_found",
        evidence_notworking_error_class: "stream_missing",
      }),
    );
    expect(errorsOnly.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "Error type",
    ]);
    expect(errorsOnly.find('[data-test="alert-calibration-finding-advice"]').text()).toContain(
      "Check the source the query reads: evaluations recorded it as not found.",
    );

    const partial = mountCard(
      failing({
        title: "checkout latency failed 30 of 100 evaluations",
        quality: "partial",
        quality_reasons: JSON.stringify(["error_classes_timed_out"]),
        evidence_notworking_first_failure_micros: at(4, 14, 3),
        evidence_notworking_error_sample: "search sql execute error overflow at <timestamp>",
      }),
    );
    expect(partial.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "First recorded failure",
      "Error message",
    ]);
    expect(partial.find('[data-test="alert-calibration-finding-quality-reasons"]').text()).toBe(
      "Reason: error types were not read in time",
    );

    const unknown = mountCard(
      failing({
        pattern: "made_up",
        evidence_notworking_error_class: "made_up",
        evidence_notworking_class_errors: 4,
      }),
    );
    expect(unknown.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "Errors of this type",
    ]);
    expect(unknown.text()).not.toContain("made_up");
  });

  it("renders_resource_rows_options_and_costs_in_amber", () => {
    const resource = (overrides: Partial<FindingRecord>) =>
      finding({
        schema_version: 2,
        kind: "finding",
        rule_id: "failure",
        severity: "Medium",
        confidence: "High",
        tier: "C",
        alert_id: "a7",
        alert_name: "app_timeout",
        pattern: "resource_timeout",
        advice: "reduce_query_time",
        title: "app_timeout failed 96 of 315 evaluations: the query timed out",
        actions: undefined,
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_schedulerhealth_affected_orgs: undefined,
        evidence_schedulerhealth_skipped_windows: undefined,
        evidence_schedulerhealth_late_ratio: undefined,
        insight_actions: JSON.stringify([
          { type: "review_alert", alert_id: "a7", focus: "query" },
          { type: "review_alert", alert_id: "a7", focus: "settings" },
        ]),
        evidence_notworking_evaluation_errors: 96,
        evidence_notworking_evaluations: 315,
        evidence_notworking_error_class: "resource_timeout",
        evidence_notworking_class_errors: 96,
        evidence_notworking_query_limit_secs: 30,
        evidence_notworking_ok_evaluations_timed: 219,
        evidence_notworking_ok_p50_ms: 21_000,
        evidence_notworking_ok_p90_ms: 28_000,
        evidence_notworking_ok_max_ms: 29_600,
        evidence_notworking_ok_near_limit: 64,
        evidence_notworking_period_secs: 3_600,
        evidence_notworking_frequency_secs: 300,
        ...overrides,
      });
    const options = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper
        .findAll('[data-test^="alert-calibration-finding-option-"]')
        .map((option) => option.text());
    const FILTER = "Narrower filter: Data the filter leaves out is no longer checked.";

    const timeout = mountCard(resource({ limitations: JSON.stringify(["limit_may_differ"]) }));
    const tile = timeout.find('[data-test="alert-calibration-finding-tile"]');
    expect(tile.classes()).toContain("bg-badge-warning-soft-bg");
    expect(timeout.html()).not.toMatch(/error-soft|badge-error/);
    expect(timeout.find('[data-test="alert-calibration-finding-tier"]').text()).toBe(
      "Owner decision",
    );
    expect(timeout.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "Error type",
      "Errors of this type",
      "Query time limit",
      "Successful evaluation time",
      "Near the time limit",
    ]);
    expect(
      timeout
        .findAll("dd")
        .map((dd) => dd.text())
        .slice(4),
    ).toEqual([
      "30 seconds",
      "median 21 seconds · 90th percentile 28 seconds · longest 29.6 seconds",
      "64 of 219 successful evaluations took 24 seconds or more",
    ]);
    const advice = timeout.find('[data-test="alert-calibration-finding-advice"]');
    expect(advice.text()).toContain(
      "The query keeps reaching its time limit. Each option makes it cheaper and costs some coverage:",
    );
    expect(options(timeout)).toEqual([
      "Shorter query window: Each run checks 1 hour, which overlaps the next run by 55 minutes. Down to 5 minutes it still checks all data, but the threshold then applies to 5 minutes, not 1 hour.",
      FILTER,
      "Less frequent runs: A breach can wait up to the new interval before it is noticed (now 5 minutes). Keep the window at least as long as the interval, or part of each interval goes unchecked.",
    ]);
    expect(timeout.find('[data-test="alert-calibration-finding-limitations"]').text()).toContain(
      "These evaluations stopped before this node's query time limit, so another limit may have applied; the options still help.",
    );
    expect(
      timeout
        .findAll('[data-test="alert-calibration-finding-action-review_alert-button"]')
        .map((button) => button.text()),
    ).toEqual(["Review alert"]);

    const memory = mountCard(
      resource({
        pattern: "resource_memory",
        advice: "reduce_query_memory",
        evidence_notworking_error_class: "resource_memory",
        evidence_notworking_ok_near_limit: 0,
        evidence_notworking_ok_max_ms: 2_100,
        evidence_notworking_ok_p90_ms: 900,
        evidence_notworking_ok_p50_ms: 400,
        evidence_notworking_period_secs: 300,
        evidence_notworking_frequency_secs: 600,
      }),
    );
    expect(memory.find('[data-test="alert-calibration-finding-advice"]').text()).toContain(
      "The query keeps running out of memory. Each option makes it cheaper and costs some coverage:",
    );
    expect(
      memory
        .findAll("dd")
        .map((dd) => dd.text())
        .slice(5),
    ).toEqual([
      "median 400 ms · 90th percentile 900 ms · longest 2.1 seconds",
      "0 of 219 successful evaluations took 24 seconds or more",
    ]);
    expect(options(memory)[0]).toBe(
      "Shorter query window: Each run checks 5 minutes of every 10 minutes. A shorter window leaves more of each interval unchecked.",
    );

    const cron = mountCard(resource({ evidence_notworking_frequency_secs: undefined }));
    expect(options(cron)).toEqual([
      "Shorter query window: Each run checks less data, so data outside the shorter window is not checked.",
      FILTER,
      "Less frequent runs: A breach can wait longer before it is noticed. Keep the window at least as long as the gap between runs.",
    ]);

    const realTime = mountCard(
      resource({
        evidence_notworking_period_secs: undefined,
        evidence_notworking_frequency_secs: undefined,
      }),
    );
    expect(options(realTime)).toEqual([
      "Shorter query window: Real-time alerts check each record as it arrives, so only a narrower filter applies.",
      FILTER,
    ]);

    const unread = mountCard(
      resource({
        quality: "partial",
        quality_reasons: JSON.stringify(["evaluation_times_unread"]),
        evidence_notworking_query_limit_secs: undefined,
        evidence_notworking_ok_evaluations_timed: undefined,
        evidence_notworking_ok_p50_ms: undefined,
        evidence_notworking_ok_p90_ms: undefined,
        evidence_notworking_ok_max_ms: undefined,
        evidence_notworking_ok_near_limit: undefined,
      }),
    );
    expect(unread.findAll("dt").map((dt) => dt.text())).toEqual([
      "Errors",
      "Evaluations",
      "Error type",
      "Errors of this type",
    ]);
    expect(unread.find('[data-test="alert-calibration-finding-quality-reasons"]').text()).toBe(
      "Reason: evaluation times were not read",
    );
    expect(options(unread)).toHaveLength(3);

    const noSuccess = mountCard(
      resource({
        evidence_notworking_ok_evaluations_timed: 0,
        evidence_notworking_ok_p50_ms: undefined,
        evidence_notworking_ok_p90_ms: undefined,
        evidence_notworking_ok_max_ms: undefined,
        evidence_notworking_ok_near_limit: 0,
      }),
    );
    expect(noSuccess.findAll("dt").map((dt) => dt.text())).toContain("Query time limit");
    expect(noSuccess.findAll("dt").map((dt) => dt.text())).not.toContain("Near the time limit");

    for (const wrapper of [timeout, memory, cron, realTime, unread]) {
      for (const code of [
        "reduce_query",
        "limit_may_differ",
        "evaluation_times_unread",
        "resource_",
      ]) {
        expect(wrapper.text()).not.toContain(code);
      }
    }
    expect(
      mountCard(finding()).find('[data-test="alert-calibration-finding-options"]').exists(),
    ).toBe(false);
  });

  it("an_unreadable_schedule_never_reads_as_real_time", () => {
    const unreadable = mountCard(
      finding({
        schema_version: 2,
        kind: "finding",
        rule_id: "failure",
        severity: "Medium",
        confidence: "High",
        tier: "C",
        alert_id: "a7",
        alert_name: "app_timeout",
        pattern: "resource_timeout",
        advice: "reduce_query_time",
        title: "app_timeout failed 96 of 315 evaluations: the query timed out",
        actions: undefined,
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_schedulerhealth_affected_orgs: undefined,
        evidence_schedulerhealth_skipped_windows: undefined,
        evidence_schedulerhealth_late_ratio: undefined,
        quality: "partial",
        quality_reasons: JSON.stringify(["schedule_unreadable"]),
        evidence_notworking_evaluation_errors: 96,
        evidence_notworking_evaluations: 315,
        evidence_notworking_error_class: "resource_timeout",
        evidence_notworking_class_errors: 96,
      }),
    );
    expect(
      unreadable
        .findAll('[data-test^="alert-calibration-finding-option-"]')
        .map((option) => option.text()),
    ).toEqual([
      "Shorter query window: Each run checks less data, so data outside the shorter window is not checked.",
      "Narrower filter: Data the filter leaves out is no longer checked.",
      "Less frequent runs: A breach can wait longer before it is noticed. Keep the window at least as long as the gap between runs.",
    ]);
    expect(unreadable.text()).not.toContain("Real-time");
    expect(unreadable.find('[data-test="alert-calibration-finding-quality"]').text()).toBe(
      "Partial evidence",
    );
    expect(unreadable.find('[data-test="alert-calibration-finding-quality-reasons"]').text()).toBe(
      "Reason: the alert's schedule could not be read",
    );
    expect(unreadable.text()).not.toContain("schedule_unreadable");
  });

  it("renders the no-destination advice and candidate rows, and nothing extra for a plain record", () => {
    const review = { type: "review_alert", alert_id: "a1", focus: "settings" };
    const noDestination = (overrides: Partial<FindingRecord>) =>
      finding({
        schema_version: 2,
        kind: "finding",
        rule_id: "no_destination",
        severity: "High",
        tier: "A",
        title: "ops_quiet fired 5 times and has no destination attached now",
        alert_id: "a1",
        alert_name: "ops_quiet",
        finding_id: "f1",
        actions: undefined,
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_nodestination_firings: 5,
        evidence_nodestination_creates_incident: false,
        advice: "add_destination",
        insight_actions: JSON.stringify([review]),
        ...overrides,
      });
    const actionRows = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper
        .findAll('[data-test^="alert-calibration-finding-action-"]')
        .filter((row) => !row.attributes("data-test")?.endsWith("-button"))
        .map((row) => [row.attributes("data-test"), row.text()]);
    const advice = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper.find('[data-test="alert-calibration-finding-advice"]').text();

    const suggested = mountCard(
      noDestination({
        advice: "attach_folder_destination",
        insight_actions: JSON.stringify([
          {
            type: "apply_suggestion",
            alert_id: "a1",
            patch: [{ field: "destinations", from: [], to: ["ops-pager"] }],
          },
          review,
        ]),
        evidence_nodestination_candidate: "ops-pager",
        evidence_nodestination_candidate_alerts: 3,
      }),
    );
    expect(suggested.findAll("dt").map((dt) => dt.text())).toEqual([
      "Firings",
      "Delivered through incidents",
      "Suggested destination",
      "Enabled alerts in this folder using it",
    ]);
    expect(suggested.findAll("dd").map((dd) => dd.text())).toEqual(["5", "No", "ops-pager", "3"]);
    expect(advice(suggested)).toContain(
      "Other enabled alerts in this folder send to the suggested destination.",
    );
    expect(actionRows(suggested)).toEqual([
      ["alert-calibration-finding-action-apply_suggestion", "Review change"],
      ["alert-calibration-finding-action-review_alert", "Review alert"],
    ]);

    const redacted = mountCard(noDestination({}));
    expect(redacted.findAll("dt").map((dt) => dt.text())).toEqual([
      "Firings",
      "Delivered through incidents",
    ]);
    expect(advice(redacted)).toContain(
      "Add a destination in Edit Alert, or confirm this alert is meant to notify no one.",
    );
    expect(actionRows(redacted)).toEqual([
      ["alert-calibration-finding-action-review_alert", "Review alert"],
    ]);

    const v1 = mountCard(
      finding({
        rule_id: "no_destination",
        severity: "High",
        title: "ops_quiet fired 5 times and has no destination attached now",
        alert_id: "a1",
        alert_name: "ops_quiet",
        actions: "AttachDestination",
        evidence_schedulerhealth_top_orgs: undefined,
        evidence_nodestination_firings: 5,
        evidence_nodestination_creates_incident: false,
      }),
    );
    expect(v1.findAll("dt").map((dt) => dt.text())).toEqual([
      "Firings",
      "Delivered through incidents",
    ]);
    expect(v1.find('[data-test="alert-calibration-finding-advice"]').exists()).toBe(false);
    expect(actionRows(v1).map(([test]) => test)).toEqual([
      "alert-calibration-finding-action-AttachDestination",
    ]);
  });

  it("a_card_offers_dismiss_and_folds_when_dismissed", async () => {
    const id = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
    const record = finding({
      schema_version: 2,
      kind: "finding",
      rule_id: "no_destination",
      title: "ops_cpu fired with no destination",
      alert_id: "a1",
      alert_name: "ops_cpu",
      actions: undefined,
      insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a1" }]),
      finding_id: id,
      scope_kind: "alert",
      scope_key: "a1",
    });
    const open = mountCard(record);
    const panel = open.find('[data-test="alert-calibration-finding-actions"]');
    const buttons = panel.findAll("button");
    expect(buttons[buttons.length - 1].attributes("data-test")).toBe(
      "alert-calibration-finding-dismiss",
    );
    expect(buttons[buttons.length - 1].text()).toBe("Dismiss…");
    expect(open.find('[data-test="alert-calibration-finding-dismissed"]').exists()).toBe(false);
    open.unmount();

    const alone = mountCard({ ...record, insight_actions: JSON.stringify([]) });
    const lonePanel = alone.find('[data-test="alert-calibration-finding-actions"]');
    expect(lonePanel.findAll("button").map((b) => b.text())).toEqual(["Dismiss…"]);
    alone.unmount();

    const folded = mount(AlertCalibrationFindingCard, {
      props: {
        finding: record,
        dismissal: {
          id,
          rule_id: "no_destination",
          pattern: null,
          scope_kind: "alert",
          scope_key: "a1",
          state: "active",
          revision: 2,
          reason: "known_issue",
          note: null,
          has_note: false,
          actor: "u-ops@example.com",
          dismissed_at: 1,
          duration_days: 90,
          expires_at: new Date(2027, 1, 3).getTime() * 1000,
          reopened_at: null,
          reopened_by: null,
          updated_at: 1,
          alert_name: "ops_cpu",
        },
      },
      global: { plugins: [store] },
    });
    expect(folded.find('[data-test="alert-calibration-finding-dismissed"]').text()).toBe(
      "Dismissed",
    );
    const fold = folded.find('[data-test="alert-calibration-finding-fold"]');
    expect(fold.text()).toContain("Dismissed by u-ops@example.com");
    expect(fold.text()).toContain("Will fix later");
    expect(fold.text()).toContain("Hidden until Feb 3, 2027");
    expect(fold.find('[data-test="alert-calibration-finding-reopen"]').text()).toBe("Undo");
    expect(folded.find("dl").exists()).toBe(false);
    expect(folded.find('[data-test="alert-calibration-finding-actions"]').exists()).toBe(false);
    expect(folded.find('[data-test="alert-calibration-finding-dismiss"]').exists()).toBe(false);
    expect(folded.text()).toContain("ops_cpu fired with no destination");
    const row = folded.props("dismissal");
    folded.unmount();

    const ended = mount(AlertCalibrationFindingCard, {
      props: { finding: record, dismissal: { ...row!, state: "expired" } },
      global: { plugins: [store] },
    });
    expect(ended.find('[data-test="alert-calibration-finding-fold"]').exists()).toBe(false);
    expect(ended.find('[data-test="alert-calibration-finding-dismissed"]').exists()).toBe(false);
    expect(ended.find('[data-test="alert-calibration-finding-dismiss"]').exists()).toBe(true);
    ended.unmount();

    const v1 = mountCard(finding({ rule_id: "noise", alert_id: "a1", finding_id: id }));
    expect(v1.find('[data-test="alert-calibration-finding-dismiss"]').exists()).toBe(false);
    v1.unmount();
  });

  it("a_folding_card_keeps_its_dialog_until_the_dialog_closes", async () => {
    const id = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
    const record = finding({
      schema_version: 2,
      kind: "finding",
      rule_id: "noise",
      title: "ops_cpu fires too often",
      alert_id: "a1",
      alert_name: "ops_cpu",
      finding_id: id,
      scope_kind: "alert",
      scope_key: "a1",
    });
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: { finding: record },
      global: { plugins: [store] },
    });
    const dialog = () => wrapper.findComponent(AlertCalibrationDismissDialog);
    expect(dialog().exists()).toBe(false);
    await wrapper.find('[data-test="alert-calibration-finding-dismiss"]').trigger("click");
    expect(dialog().props("open")).toBe(true);

    await wrapper.setProps({
      dismissal: {
        id,
        rule_id: "noise",
        pattern: null,
        scope_kind: "alert",
        scope_key: "a1",
        state: "active",
        revision: 1,
        reason: "expected",
        note: null,
        has_note: false,
        actor: "u-ops@example.com",
        dismissed_at: 1,
        duration_days: 90,
        expires_at: new Date(2027, 1, 3).getTime() * 1000,
        reopened_at: null,
        reopened_by: null,
        updated_at: 1,
        alert_name: "ops_cpu",
      },
    });
    expect(dialog().exists()).toBe(true);
    dialog().vm.$emit("update:open", false);
    await nextTick();

    await wrapper.setProps({ dismissal: null });
    expect(dialog().props("open")).toBe(false);
    wrapper.unmount();
  });

  it("reopen_from_a_folded_card_sends_the_rows_revision", async () => {
    const id = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
    const record = finding({
      schema_version: 2,
      kind: "finding",
      rule_id: "noise",
      title: "ops_cpu fires too often",
      alert_id: "a1",
      alert_name: "ops_cpu",
      finding_id: id,
      scope_kind: "alert",
      scope_key: "a1",
    });
    const dismissal = {
      id,
      rule_id: "noise",
      pattern: null,
      scope_kind: "alert",
      scope_key: "a1",
      state: "active" as const,
      revision: 7,
      reason: "expected" as const,
      note: null,
      has_note: false,
      actor: "u-ops@example.com",
      dismissed_at: 1,
      duration_days: null,
      expires_at: null,
      reopened_at: null,
      reopened_by: null,
      updated_at: 1,
      alert_name: "ops_cpu",
    };
    vi.mocked(alertCalibration.reopenDismissal).mockResolvedValue({
      data: { ...dismissal, state: "reopened", revision: 8 },
    } as never);
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: { finding: record, dismissal },
      global: { plugins: [store] },
    });
    expect(wrapper.find('[data-test="alert-calibration-finding-fold"]').text()).toContain(
      "Hidden until undone",
    );
    await wrapper.find('[data-test="alert-calibration-finding-reopen"]').trigger("click");
    await flushPromises();
    expect(alertCalibration.reopenDismissal).toHaveBeenCalledWith("default", id, 7);
    wrapper.unmount();
  });

  it("a_finding_marked_as_an_intended_report_says_it_is_a_mark", () => {
    const id = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
    const record = finding({
      schema_version: 2,
      kind: "finding",
      rule_id: "noise",
      title: "ops_cpu fires too often",
      alert_id: "a1",
      alert_name: "ops_cpu",
      finding_id: id,
      scope_kind: "alert",
      scope_key: "a1",
    });
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: {
        finding: record,
        dismissal: {
          id,
          rule_id: "noise",
          pattern: null,
          scope_kind: "alert",
          scope_key: "a1",
          state: "active",
          revision: 3,
          reason: "intended_report",
          note: null,
          has_note: false,
          actor: "u-ops@example.com",
          dismissed_at: 1,
          duration_days: null,
          expires_at: null,
          reopened_at: null,
          reopened_by: null,
          updated_at: 1,
          alert_name: "ops_cpu",
        },
      },
      global: { plugins: [store] },
    });
    expect(wrapper.find('[data-test="alert-calibration-finding-dismissed"]').text()).toBe(
      "Intended report",
    );
    const fold = wrapper.find('[data-test="alert-calibration-finding-fold"]').text();
    expect(fold).toContain("Marked as intended report by u-ops@example.com");
    expect(fold).not.toContain("Another reason");
    expect(fold).not.toContain("Dismissed by");
    wrapper.unmount();
  });
});
