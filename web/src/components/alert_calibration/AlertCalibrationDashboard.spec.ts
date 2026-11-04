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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
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

  it("shows the cluster-wide scheduler rule only in _meta, without an alert count", async () => {
    const cluster = record({
      rule_id: "scheduler_health",
      severity: "Medium",
      confidence: "High",
      title: "In the last 24 hours the alert scheduler skipped 4 evaluation windows",
      actions: "ScaleAlertScheduler",
    });
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : ([...findings, cluster] as never),
    );
    const selected = store.state.selectedOrganization;
    store.state.selectedOrganization = { ...selected, identifier: "_meta" };
    try {
      const wrapper = await mountPage();
      const rule = wrapper.find('[data-test="alert-calibration-dashboard-rule-scheduler_health"]');
      expect(rule.exists()).toBe(true);
      expect(rule.text()).not.toMatch(/\d+ alerts?/);
      await rule.find("button").trigger("click");
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-calibration-dashboard-rule-scheduler_health"]').text(),
      ).toContain("skipped 4 evaluation windows");
      wrapper.unmount();
    } finally {
      store.state.selectedOrganization = selected;
    }
  });

  it("opens the flagged alert, and the evidence filtered to its rule", async () => {
    const wrapper = await mountPage();
    await wrapper
      .find('[data-test="alert-calibration-dashboard-rule-failure"] button')
      .trigger("click");
    await flushPromises();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await wrapper.find('[data-test="alert-calibration-dashboard-open-alert"]').trigger("click");
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/alerts/detail/a1"),
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();

    // The rule stays open across the route change, since the page itself was never left.
    await wrapper.find('[data-test="alert-calibration-dashboard-view-evidence"]').trigger("click");
    await flushPromises();
    expect(wrapper.router.currentRoute.value.name).toBe("alertCalibrationDigest");
    expect(wrapper.router.currentRoute.value.query.rule).toBe("failure");
    wrapper.unmount();
  });

  it("a_v2_run_hides_the_silent_group_and_explains_definition_checks", async () => {
    const v2 = (extra: Partial<DigestRecord>) =>
      record({ schema_version: 2, kind: "finding", ...extra });
    const broken = v2({
      rule_id: "failure",
      pattern: "stream_missing",
      severity: "High",
      confidence: "High",
      title: "orders error rate reads logs/orders_v1, which doesn't exist",
      alert_id: "a1",
      alert_name: "orders error rate",
      finding_id: "f1",
    });
    const quiet = v2({
      rule_id: "failure",
      pattern: "source_inactive",
      severity: "Medium",
      confidence: "Medium",
      title: "orders error rate reads logs/batch_logs, which has no recent data",
      alert_id: "a1",
      alert_name: "orders error rate",
      finding_id: "f2",
    });
    const emit = (checks: string, gap: boolean) =>
      vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
        read === ""
          ? ([run] as never)
          : ([broken, quiet].map((r) => ({
              ...r,
              coverage_gap: gap,
              coverage_definition_checks: checks,
            })) as never),
      );

    emit("unavailable", false);
    const off = await mountPage();
    const rules = off.findAll('[data-test^="alert-calibration-dashboard-rule-"]');
    expect(rules.map((r) => r.attributes("data-test"))).not.toContain(
      "alert-calibration-dashboard-rule-silent",
    );
    const failure = off.find('[data-test="alert-calibration-dashboard-rule-failure"]');
    expect(failure.text()).toContain("Alert not working");
    // Two findings on one alert are still one flagged alert.
    expect(failure.text()).toContain("1 alert");
    const neutral = off.findAll('[data-test="alert-calibration-dashboard-note"]');
    expect(neutral.map((n) => n.text())).toEqual([
      "Alert definition checks need AutoObserve, which is off. The other checks ran.",
    ]);
    expect(neutral[0].find(".text-status-warning-text").exists()).toBe(false);
    expect(off.find('[data-test="alert-calibration-dashboard-gap-note"]').exists()).toBe(false);
    off.unmount();

    emit("not_yet", true);
    const notYet = await mountPage();
    const gap = notYet.find('[data-test="alert-calibration-dashboard-gap-note"]');
    expect(gap.text()).toBe(
      "AutoObserve has not checked alert definitions in the last day, so they were not judged.",
    );
    expect(gap.find(".text-status-warning-text").exists()).toBe(true);
    notYet.unmount();

    // A version-1 run keeps its legacy labels and its Silent group.
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : (findings as never),
    );
    const v1 = await mountPage();
    expect(v1.find('[data-test="alert-calibration-dashboard-rule-silent"]').text()).toContain(
      "Silent",
    );
    expect(v1.find('[data-test="alert-calibration-dashboard-rule-failure"]').text()).toContain(
      "Failure",
    );
    v1.unmount();
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

  it("a scoped latest run reads as the caller's alerts, not the org", async () => {
    const latest: RunRow = {
      ...run,
      finding_count: 0,
      skip_count: 0,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const { emitted_at, ...columns } = latest;
    const runRow = { ...columns, _timestamp: emitted_at, kind: "run" } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([runRow] as never),
    );
    const selected = store.state.selectedOrganization;
    store.state.selectedOrganization = { ...selected, identifier: "_meta" };
    try {
      const wrapper = await mountPage();
      const banner = wrapper.findComponent(OBanner);
      expect(banner.text()).toBe("No findings on the alerts you can access in the latest run.");
      expect(banner.props("variant")).toBe("info");
      const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
      expect(items[0]).toMatchObject({ value: 0, tone: "neutral" });
      expect(items[1]).toMatchObject({
        value: "—",
        sub: "Shown only with access to every alert",
        subIcon: "info-outline",
      });
      expect(
        wrapper.find('[data-test="alert-calibration-dashboard-rule-scheduler_health"]').exists(),
      ).toBe(false);
      wrapper.unmount();
    } finally {
      store.state.selectedOrganization = selected;
    }

    const clean: RunRow = { ...run, finding_count: 0, skip_count: 0 };
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([clean] as never) : ([] as never),
    );
    const root = await mountPage();
    const banner = root.findComponent(OBanner);
    expect(banner.text()).toBe("The latest run found nothing to fix.");
    expect(banner.props("variant")).toBe("success");
    const items = root.findComponent(OStatStrip).props("items") as StatItem[];
    expect(items[0]).toMatchObject({ value: 0, tone: "success" });
    expect(items[1]).toMatchObject({ value: 4 });
    expect(items[1].sub).toBeUndefined();
    root.unmount();
  });

  it("a scoped latest run whose counts are not ready yet says so in amber", async () => {
    const latest: RunRow = {
      ...run,
      finding_count: null,
      skip_count: null,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const { emitted_at, ...columns } = latest;
    const runRow = { ...columns, _timestamp: emitted_at, kind: "run" } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([runRow] as never),
    );
    const wrapper = await mountPage();
    const banner = wrapper.findComponent(OBanner);
    expect(banner.text()).toBe(
      "Counts on the alerts you can access are not ready yet. Refresh shortly.",
    );
    expect(banner.props("variant")).toBe("warning");
    const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
    expect(items[0]).toMatchObject({ value: "—", tone: "neutral" });
    wrapper.unmount();
  });

  it("a pending run's rule groups show an amber Pending, never a zero or a no-alert claim", async () => {
    const latest: RunRow = {
      ...run,
      finding_count: null,
      skip_count: null,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const { emitted_at, ...columns } = latest;
    const runRow = { ...columns, _timestamp: emitted_at, kind: "run" } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([runRow] as never),
    );
    const wrapper = await mountPage();
    const rules = wrapper.findAll('[data-test^="alert-calibration-dashboard-rule-"]');
    expect(rules.length).toBeGreaterThan(0);
    const pending = wrapper.findAllComponents(OBadge).filter((b) => b.text() === "Pending");
    expect(pending).toHaveLength(rules.length);
    for (const badge of pending) expect(badge.props("variant")).toBe("warning-soft");
    for (const rule of rules) {
      expect(rule.text()).not.toMatch(/\d+ alerts?/);
      expect(rule.text()).toContain("Pending");
      await rule.find("button").trigger("click");
      await flushPromises();
      expect(rule.text()).not.toContain("No alert flagged");
      expect(rule.text()).toContain("not ready yet");
    }
    wrapper.unmount();
  });

  it("a pending run still counts the findings that came back, and only the empty rules pend", async () => {
    const latest: RunRow = {
      ...run,
      finding_count: null,
      skip_count: null,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const unread = { ...findings[0], finding_count: null, skip_count: null } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([unread] as never),
    );
    const wrapper = await mountPage();
    const failure = wrapper.find('[data-test="alert-calibration-dashboard-rule-failure"]');
    expect(failure.text()).toContain("1 alert");
    expect(failure.text()).not.toContain("Pending");
    const noise = wrapper.find('[data-test="alert-calibration-dashboard-rule-noise"]');
    expect(noise.text()).toContain("Pending");
    expect(noise.text()).not.toMatch(/\d+ alerts?/);
    wrapper.unmount();
  });

  it("records whose counts are not ready pend the board, though the run list had counts", async () => {
    for (const finding_count of [1, 0]) {
      const latest: RunRow = {
        ...run,
        finding_count,
        skip_count: 0,
        alerts_in_scope: null,
        visibility: "scoped",
      };
      const { emitted_at, ...columns } = latest;
      const runRow = {
        ...columns,
        _timestamp: emitted_at,
        kind: "run",
        finding_count: null,
        skip_count: null,
        written_skip_count: null,
      } as DigestRecord;
      vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
        read === "" ? ([latest] as never) : ([runRow] as never),
      );
      const wrapper = await mountPage();
      const banners = wrapper.findAllComponents(OBanner);
      expect(banners.map((b) => b.text())).toEqual([
        "Counts on the alerts you can access are not ready yet. Refresh shortly.",
      ]);
      expect(banners[0].props("variant")).toBe("warning");
      const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
      expect(items[0]).toMatchObject({ value: "—", tone: "neutral" });
      const rules = wrapper.findAll('[data-test^="alert-calibration-dashboard-rule-"]');
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.text()).not.toMatch(/\d+ alerts?/);
        expect(rule.text()).toContain("Pending");
        await rule.find("button").trigger("click");
        await flushPromises();
        expect(rule.text()).not.toContain("No alert flagged");
      }
      wrapper.unmount();
    }
  });

  it("a scoped version-2 run shows version-2 rules and its definition-check note", async () => {
    // The scoped list row and run row as the server sends them for a version-2 run (P3I-D1).
    const versioned = {
      schema_version: 2,
      coverage_definition_checks: "unavailable" as const,
      coverage_definition_checks_truncated: false,
    };
    const latest: RunRow = {
      ...run,
      ...versioned,
      finding_count: 1,
      skip_count: 0,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const { emitted_at, ...columns } = latest;
    const runRow = { ...columns, _timestamp: emitted_at, kind: "run" } as DigestRecord;
    const visible = {
      ...findings[0],
      ...versioned,
      kind: "finding",
      finding_count: 1,
      alerts_in_scope: null,
      visibility: "scoped",
    } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([runRow, visible] as never),
    );
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-rule-silent"]').exists()).toBe(
      false,
    );
    const failure = wrapper.find('[data-test="alert-calibration-dashboard-rule-failure"]');
    expect(failure.text()).toContain("Alert not working");
    expect(failure.text()).toContain("1 alert");
    const notes = wrapper.findAll('[data-test="alert-calibration-dashboard-note"]');
    expect(notes.map((n) => n.text())).toEqual([
      "Alert definition checks need AutoObserve, which is off. The other checks ran.",
    ]);
    const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
    expect(items[1]).toMatchObject({ value: "—" });
    wrapper.unmount();
  });

  it("a list row whose count is not ready pends the board, though the records had counts", async () => {
    const latest: RunRow = {
      ...run,
      finding_count: null,
      skip_count: null,
      alerts_in_scope: null,
      visibility: "scoped",
    };
    const { emitted_at, ...columns } = latest;
    const runRow = {
      ...columns,
      _timestamp: emitted_at,
      kind: "run",
      finding_count: 0,
      skip_count: 0,
      written_skip_count: 0,
    } as DigestRecord;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([latest] as never) : ([runRow] as never),
    );
    const wrapper = await mountPage();
    const banners = wrapper.findAllComponents(OBanner);
    expect(banners.map((b) => b.text())).toEqual([
      "Counts on the alerts you can access are not ready yet. Refresh shortly.",
    ]);
    const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
    expect(items[0]).toMatchObject({ value: "—", tone: "neutral" });
    const rules = wrapper.findAll('[data-test^="alert-calibration-dashboard-rule-"]');
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.text()).toContain("Pending");
    wrapper.unmount();
  });
});
