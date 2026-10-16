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
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration from "@/services/alert_calibration";
import AlertCalibrationDashboard from "./AlertCalibrationDashboard.vue";
import type { DigestRecord, RunRow } from "./digests";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      getConfig: vi.fn(),
      getStatus: vi.fn(),
      readDigests: vi.fn(),
      requestRun: vi.fn(),
    },
  };
});

const DAY_MICROS = 86_400_000_000;
const NOW = Date.now() * 1000;
const WINDOW_END = NOW - DAY_MICROS;
const WINDOW_START = WINDOW_END - 30 * DAY_MICROS;

const coverage = {
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
  coverage_meta_fallback_used: false,
};

const run: RunRow = {
  window_start: WINDOW_START,
  window_end: WINDOW_END,
  emitted_at: NOW - 100,
  finding_count: 2,
  skip_count: 1,
  alerts_in_scope: 4,
  ...coverage,
};

const record = (extra: Partial<DigestRecord>): DigestRecord => ({
  _timestamp: NOW - 100,
  org: "default",
  config_id: "c1",
  window_start: WINDOW_START,
  window_end: WINDOW_END,
  finding_count: 2,
  skip_count: 1,
  alerts_in_scope: 4,
  ...coverage,
  ...extra,
});

const findings = [
  record({
    rule_id: "failure",
    severity: "High",
    confidence: "High",
    title: "payments failed 10 of 20 evaluations",
    actions: "FixAlertQuery",
    alert_id: "a1",
    alert_name: "payments",
  }),
  record({
    rule_id: "noise",
    severity: "Medium",
    confidence: "High",
    title: "cpu fired 40 times without an incident",
    actions: "RaiseThreshold",
    alert_id: "a2",
    alert_name: "cpu",
  }),
];

const config = (enabled: boolean) => ({
  data: {
    id: "c1",
    org: "default",
    enabled,
    frequency_minutes: 1440,
    window_minutes: 43_200,
    created_at: 1,
    updated_at: 1,
  },
});

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/alert-calibration",
        name: "alertCalibration",
        component: AlertCalibrationDashboard,
      },
      {
        path: "/alert-calibration/runs",
        name: "alertCalibrationRuns",
        component: { template: "<div />" },
      },
      {
        path: "/alert-calibration/digests/:windowStart/:windowEnd",
        name: "alertCalibrationDigest",
        component: { template: "<div />" },
      },
      {
        path: "/alert-calibration/settings",
        name: "alertCalibrationSettings",
        component: { template: "<div />" },
      },
      { path: "/alerts/detail/:alert_id", name: "alertDetail", component: { template: "<div />" } },
      { path: "/alerts", name: "alertList", component: { template: "<div />" } },
    ],
  });
  await router.push({ name: "alertCalibration", query: { org_identifier: "default" } });
  await router.isReady();
  const wrapper = mount(AlertCalibrationDashboard, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return Object.assign(wrapper, { router });
};

describe("AlertCalibrationDashboard", () => {
  beforeEach(() => {
    queryClient.clear();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
    vi.mocked(alertCalibration.getConfig).mockResolvedValue(config(true) as never);
    vi.mocked(alertCalibration.getStatus).mockResolvedValue({ data: { last_run: null } } as never);
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : (findings as never),
    );
  });

  it("lists the alerts each rule flagged in the latest run, worst rule first", async () => {
    const wrapper = await mountPage();
    const rules = wrapper.findAll('[data-test^="alert-calibration-dashboard-rule-"]');
    expect(rules.map((r) => r.attributes("data-test"))).toEqual([
      "alert-calibration-dashboard-rule-failure",
      "alert-calibration-dashboard-rule-noise",
      "alert-calibration-dashboard-rule-no_destination",
      "alert-calibration-dashboard-rule-notify_failed",
      "alert-calibration-dashboard-rule-silent",
    ]);
    expect(rules[0].text()).toContain("1 alert");
    expect(rules[4].text()).toContain("0 alerts");
    await rules[0].find("button").trigger("click");
    await flushPromises();
    const alert = wrapper.find('[data-test="alert-calibration-dashboard-alert-a1"]');
    expect(alert.text()).toContain("payments");
    expect(alert.text()).toContain("failed 10 of 20 evaluations");
    wrapper.unmount();
  });

  it("opens the flagged alert, and the evidence filtered to its rule", async () => {
    const wrapper = await mountPage();
    await wrapper
      .find('[data-test="alert-calibration-dashboard-rule-failure"] button')
      .trigger("click");
    await flushPromises();
    await wrapper.find('[data-test="alert-calibration-dashboard-open-alert"]').trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.name).toBe("alertDetail");
    expect(wrapper.router.currentRoute.value.params).toEqual({ alert_id: "a1" });

    // The rule stays open across the route change, since the page itself was never left.
    await wrapper.find('[data-test="alert-calibration-dashboard-view-evidence"]').trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.name).toBe("alertCalibrationDigest");
    expect(wrapper.router.currentRoute.value.query.rule).toBe("failure");
    wrapper.unmount();
  });

  it("points an org with calibration off at the settings instead of an empty board", async () => {
    vi.mocked(alertCalibration.getConfig).mockResolvedValue(config(false) as never);
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-not-enabled"]').exists()).toBe(
      true,
    );
    await wrapper
      .find('[data-test="alert-calibration-dashboard-not-enabled"] button')
      .trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.name).toBe("alertCalibrationSettings");
    wrapper.unmount();
  });
});
