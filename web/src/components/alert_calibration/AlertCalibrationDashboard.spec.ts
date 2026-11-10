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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { alertCalibrationKeys } from "@/services/alert_calibration.querykeys";
import alertCalibration from "@/services/alert_calibration";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AlertCalibrationDashboard from "./AlertCalibrationDashboard.vue";
import type { DigestRecord, RunRow } from "./digests";
import analytics from "@/services/product_analytics";
import { openAlertReview } from "./reviewAlert";
import autoobserveDecisions, { type DecisionView } from "@/services/autoobserveDecisions";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("./reviewAlert", () => ({ openAlertReview: vi.fn() }));

// The decision route answers 404 while its switch is off; this spec pins today's routes.
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  const off = () =>
    Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } }));
  return { ...actual, default: { ...actual.default, list: vi.fn(off) } };
});
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
      listDismissals: vi.fn(),
      dismissFinding: vi.fn(),
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

const fid = (n: number) => n.toString(16).padStart(64, "0");

const dismissalPage = (ids: string[], total = ids.length) =>
  ({
    data: {
      items: ids.map((id) => ({
        id,
        rule_id: "no_destination",
        pattern: null,
        scope_kind: "alert",
        scope_key: "a1",
        state: "active",
        revision: 1,
        reason: "known_issue",
        note: null,
        has_note: false,
        actor: "u-ops@example.com",
        dismissed_at: NOW,
        duration_days: 90,
        expires_at: NOW + 90 * DAY_MICROS,
        reopened_at: null,
        reopened_by: null,
        updated_at: NOW,
        alert_name: "ops_cpu",
      })),
      next_cursor: null,
      total,
    },
  }) as never;

/** One v2 no-destination finding per alert, each with its own identity. */
const nodest = (n: number, extra: Partial<DigestRecord> = {}) =>
  record({
    schema_version: 2,
    kind: "finding",
    rule_id: "no_destination",
    severity: "Medium",
    confidence: "High",
    title: `ops_a${n} fired with no destination`,
    alert_id: `a${n}`,
    alert_name: `ops_a${n}`,
    finding_id: fid(n),
    scope_kind: "alert",
    scope_key: `a${n}`,
    ...extra,
  });

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

const serverError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const mountPage = async (query: Record<string, string> = {}) => {
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
  await router.push({ name: "alertCalibration", query: { org_identifier: "default", ...query } });
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
    // The board waits for the dismissals read, so every test answers it.
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
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
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_finding_alert_opened", {
      rule: "failure",
      source: "dashboard",
    });
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

  it("a failed runs read shows the AutoObserve load failure, with the server's words only under Details", async () => {
    vi.mocked(alertCalibration.readDigests).mockRejectedValue(serverError(500, "internal"));
    const wrapper = await mountPage();
    const board = wrapper.find('[data-test="alert-calibration-dashboard-no-board"]');
    expect(board.text()).toContain("Couldn't load findings");
    expect(board.text()).toContain(
      "Something went wrong while loading them. Try again in a moment.",
    );
    expect(board.text()).toContain("Retry");
    expect(wrapper.text()).not.toContain("internal");
    await board.find('[data-test="alert-calibration-dashboard-error-details"]').trigger("click");
    expect(board.text()).toContain("internal");
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
      expect(items[0]).toMatchObject({ value: "0", tone: "neutral" });
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
    expect(items[0]).toMatchObject({ value: "0", tone: "success" });
    expect(items[1]).toMatchObject({ value: "4" });
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

describe("AlertCalibrationDashboard dismissals", () => {
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
    }
  };
  const serve = (records: DigestRecord[], count: number, extra: Partial<DigestRecord> = {}) =>
    vi
      .mocked(alertCalibration.readDigests)
      .mockImplementation(async (_org, read) =>
        read === ""
          ? ([{ ...run, finding_count: count }] as never)
          : (records.map((r) => ({ ...r, finding_count: count, ...extra })) as never),
      );
  const openStat = (wrapper: VueWrapper) =>
    (wrapper.findComponent(OStatStrip).props("items") as StatItem[]).find(
      (item) => item.key === "findings",
    );
  const filterText = () =>
    document.body.querySelector('[data-test="alert-calibration-filter-dismissed"]')?.textContent ??
    "";

  beforeEach(() => {
    queryClient.clear();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
    vi.mocked(alertCalibration.getConfig).mockResolvedValue(config(true) as never);
    vi.mocked(alertCalibration.getStatus).mockResolvedValue({ data: { last_run: null } } as never);
    vi.mocked(alertCalibration.listDismissals).mockReset();
    vi.mocked(alertCalibration.dismissFinding).mockReset();
  });

  it("nothing_folds_before_the_server_and_the_list_confirm", async () => {
    serve([nodest(1), nodest(2)], 2);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValueOnce(dismissalPage([]));
    const wrapper = await mountPage();
    await settle();
    const group = wrapper.find('[data-test="alert-calibration-dashboard-rule-no_destination"]');
    await group.find("button").trigger("click");
    await settle();
    expect(openStat(wrapper)?.label).toBe("Open findings");
    expect(openStat(wrapper)?.value).toBe("2");
    expect(filterText()).toContain("Dismissed (0)");

    await wrapper
      .find(
        '[data-test="alert-calibration-dashboard-alert-a1"] [data-test="alert-calibration-dashboard-dismiss"]',
      )
      .trigger("click");
    await settle();
    let land: (value: unknown) => void = () => {};
    vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(
      () => new Promise((resolve) => (land = resolve)) as never,
    );
    vi.mocked(alertCalibration.dismissFinding).mockResolvedValue({
      data: { id: fid(1), state: "active", expires_at: NOW },
    } as never);
    (
      document.body.querySelector(
        '[data-test="alert-calibration-dismiss-reason-known_issue"]',
      ) as HTMLElement
    ).click();
    await settle();
    (
      document.body.querySelector('[data-test="alert-calibration-dismiss-submit"]') as HTMLElement
    ).click();
    await settle();

    expect(alertCalibration.dismissFinding).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="alert-calibration-dashboard-alert-a1"]').exists()).toBe(true);
    expect(openStat(wrapper)?.value).toBe("2");
    expect(filterText()).toContain("Dismissed (0)");

    land(dismissalPage([fid(1)]));
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-alert-a1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-calibration-dashboard-alert-a2"]').exists()).toBe(true);
    expect(openStat(wrapper)?.value).toBe("1");
    expect(filterText()).toContain("Dismissed (1)");
    wrapper.unmount();
  });

  it("open_and_dismissed_counts_stay_apart", async () => {
    serve([nodest(1), nodest(2), nodest(3)], 3, { dismissed_count: 4 });
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(1), fid(9)]));
    const wrapper = await mountPage();
    await settle();
    expect(openStat(wrapper)?.value).toBe("2");
    expect(filterText()).toContain("Dismissed (2)");
    const group = wrapper.find('[data-test="alert-calibration-dashboard-rule-no_destination"]');
    expect(group.text()).toContain("2 alerts");
    wrapper.unmount();
  });

  it("all_open_dismissed_reads_as_hidden_not_clear", async () => {
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(1)]));
    const wrapper = await mountPage();
    await settle();
    const banner = wrapper.find('[data-test="alert-calibration-dashboard-all-dismissed"]');
    expect(banner.text()).toBe("Nothing open. 1 dismissed finding is hidden; see Dismissed.");
    const notice = wrapper
      .findAllComponents(OBanner)
      .find((b) => b.props("dataTest") === "alert-calibration-dashboard-all-dismissed");
    expect(notice?.props("variant")).toBe("default");
    expect(wrapper.text()).not.toContain("The latest run found nothing to fix.");
    const group = wrapper.find('[data-test="alert-calibration-dashboard-rule-no_destination"]');
    await group.find("button").trigger("click");
    await settle();
    expect(
      wrapper.find('[data-test="alert-calibration-dashboard-rule-all-dismissed"]').text(),
    ).toBe("Nothing open: 1 alert's finding is dismissed.");
    wrapper.unmount();
  });

  it("a_failed_state_read_renders_with_the_findings_in_one_paint", async () => {
    queryClient.setQueryDefaults(["org"], { retry: false });
    serve([nodest(1)], 1);
    let fail: (reason: unknown) => void = () => {};
    vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)) as never,
    );
    const wrapper = await mountPage();
    await settle();
    // The records are in, the state read is not: the board must still be a skeleton.
    expect(wrapper.find('[data-test="alert-calibration-dashboard-attention"]').exists()).toBe(
      false,
    );

    fail(Object.assign(new Error("HTTP 500"), { response: { status: 500 } }));
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-attention"]').exists()).toBe(true);
    const unknown = wrapper.find('[data-test="alert-calibration-dashboard-states-unknown"]');
    expect(unknown.text()).toContain(
      "Dismissed findings couldn't be loaded, so some findings below may already be dismissed.",
    );
    expect(filterText()).toContain("Dismissed (—)");

    vi.mocked(alertCalibration.listDismissals).mockRejectedValue(
      Object.assign(new Error("HTTP 500"), { response: { status: 500 } }),
    );
    await wrapper.find('[data-test="alert-calibration-dashboard-states-retry"]').trigger("click");
    await settle();
    expect(alertCalibration.listDismissals).toHaveBeenCalledTimes(2);

    await wrapper.router.replace({ query: { org_identifier: "default", findings: "dismissed" } });
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dismissed-error"]').exists()).toBe(true);
    queryClient.setQueryDefaults(["org"], {});
    wrapper.unmount();
  });

  it("with_the_decision_route_on_the_dismissed_view_is_one_list_counted_without_applies", async () => {
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(7)]));
    const base = {
      family: "alert_finding",
      state: "active",
      note: null,
      has_note: false,
      actor: "root@example.com",
      source: "ui",
      decided_at: NOW - 1000,
      revision: 1,
    } as const;
    const dismissed: DecisionView = {
      ...base,
      decision_id: `alert_finding:${fid(7)}`,
      id: fid(7),
      action: "dismiss",
      reason: "will_fix_later",
      until: NOW + 90 * DAY_MICROS,
      subject: { title: "ops-b", folder: "ops", team: null },
    };
    const applied: DecisionView = {
      ...base,
      decision_id: `alert_finding:${fid(7)}:apply`,
      id: fid(7),
      action: "apply",
      state: "applied",
      reason: null,
      until: NOW + 30 * DAY_MICROS,
      subject: { title: "ops-b", folder: "ops", team: null },
    };
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: { decisions: [dismissed, applied], total: 2, limit: 500, offset: 0 },
    } as never);
    try {
      const wrapper = await mountPage({ findings: "dismissed" });
      await settle();
      expect(wrapper.find('[data-test="decision-dismissed"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-calibration-dismissed"]').exists()).toBe(false);
      expect(wrapper.findAll('[data-test="decision-dismissed-row"]')).toHaveLength(1);
      expect(filterText()).toContain("Dismissed (1)");
      wrapper.unmount();
    } finally {
      vi.mocked(autoobserveDecisions.list).mockImplementation(() =>
        Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } })),
      );
    }
  });

  it("a_reader_without_access_sees_the_no_access_state_without_retry", async () => {
    vi.mocked(alertCalibration.readDigests).mockRejectedValue(
      serverError(403, { code: 403, message: "Unauthorized Access" }),
    );
    const wrapper = await mountPage();
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-no-access"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Runs unavailable");
    expect(wrapper.text()).not.toContain("Retry");
    wrapper.unmount();
  });

  it("a_failed_read_names_the_dashboard_not_the_runs", async () => {
    vi.mocked(alertCalibration.readDigests).mockRejectedValue(serverError(500, {}));
    const wrapper = await mountPage();
    await settle();
    expect(wrapper.text()).not.toContain("Runs unavailable");
    expect(wrapper.text()).toContain("Couldn't load findings");
    wrapper.unmount();
  });

  it("a_finding_link_opens_its_group_and_marks_the_row", async () => {
    serve([nodest(1), nodest(2)], 2);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const wrapper = await mountPage({ finding: fid(2) });
    await settle();
    const row = wrapper.find('[data-test="alert-calibration-dashboard-alert-a2"]');
    expect(row.exists()).toBe(true);
    expect(row.attributes("data-focused")).toBe("true");
    expect(scroll).toHaveBeenCalled();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-finding-gone"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("a_link_to_a_finding_no_longer_open_says_so_in_one_neutral_line", async () => {
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
    const wrapper = await mountPage({ finding: fid(9) });
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-finding-gone"]').text()).toBe(
      "This finding is no longer open.",
    );
    wrapper.unmount();
  });

  it("a_link_to_a_dismissed_finding_points_to_dismissed_where_its_undo_is", async () => {
    serve([nodest(1), nodest(2)], 2);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(2)]));
    const wrapper = await mountPage({ finding: fid(2) });
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-finding-gone"]').text()).toBe(
      "This finding is dismissed. Undo it from Dismissed.",
    );
    wrapper.unmount();
  });

  it("a_scoped_reader_is_told_the_finding_may_be_on_an_alert_they_cannot_access", async () => {
    serve([nodest(1)], 1, { visibility: "scoped" } as Partial<DigestRecord>);
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === ""
        ? ([{ ...run, finding_count: 1, visibility: "scoped" }] as never)
        : ([{ ...nodest(1), finding_count: 1, visibility: "scoped" }] as never),
    );
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
    const wrapper = await mountPage({ finding: fid(9) });
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-finding-gone"]').text()).toBe(
      "This finding is not open in the latest run, or it is on an alert you can't access.",
    );
    wrapper.unmount();
  });

  it("the_gone_line_takes_the_caption_s_place_so_the_groups_never_move", async () => {
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
    const wrapper = await mountPage({ finding: fid(9) });
    await settle();
    const attention = wrapper.find('[data-test="alert-calibration-dashboard-attention"]');
    expect(attention.text()).not.toContain("From the latest run.");
    const gone = wrapper.find('[data-test="alert-calibration-dashboard-finding-gone"]');
    expect(gone.element.nextElementSibling?.getAttribute("data-test")).toBe(
      "alert-calibration-dashboard-latest-age",
    );
    wrapper.unmount();
  });

  it("the_filter_lives_in_the_url", async () => {
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(7)]));
    const wrapper = await mountPage({ findings: "dismissed" });
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dismissed"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="alert-calibration-dashboard-rule-no_destination"]').exists(),
    ).toBe(false);
    const replace = vi.spyOn(wrapper.router, "replace");
    (
      document.body.querySelector('[data-test="alert-calibration-filter-open"]') as HTMLElement
    ).click();
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(wrapper.router.currentRoute.value.query.findings).toBeUndefined();
    expect(wrapper.router.currentRoute.value.query.org_identifier).toBe("default");
    expect(wrapper.find('[data-test="alert-calibration-dismissed"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="alert-calibration-dashboard-rule-no_destination"]').exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("a_run_after_everything_was_dismissed_still_reads_hidden_not_clear", async () => {
    // The next run leaves the dismissed findings out: no finding records, only the run's own.
    const runOnly = (extra: Partial<DigestRecord>) =>
      vi
        .mocked(alertCalibration.readDigests)
        .mockImplementation(async (_org, read) =>
          read === ""
            ? ([{ ...run, finding_count: 0 }] as never)
            : ([record({ schema_version: 2, kind: "run", finding_count: 0, ...extra })] as never),
        );
    const before = (ids: string[]) => {
      const page = dismissalPage(ids) as { data: { items: { dismissed_at: number }[] } };
      for (const item of page.data.items) item.dismissed_at = NOW - 10_000;
      return page as never;
    };

    runOnly({ dismissed_count: 2 });
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(before([fid(1), fid(2)]));
    const wrapper = await mountPage();
    await settle();
    expect(wrapper.find('[data-test="alert-calibration-dashboard-all-dismissed"]').text()).toBe(
      "Nothing open. 2 dismissed findings are hidden; see Dismissed.",
    );
    expect(wrapper.text()).not.toContain("The latest run found nothing to fix.");
    expect(openStat(wrapper)).toMatchObject({ value: "0", tone: "neutral" });
    wrapper.unmount();

    // A scoped reader gets no org total, so its own dismissals from before the run stand in.
    queryClient.clear();
    runOnly({ dismissed_count: null, visibility: "scoped", alerts_in_scope: null });
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(before([fid(3)]));
    const scoped = await mountPage();
    await settle();
    expect(scoped.find('[data-test="alert-calibration-dashboard-all-dismissed"]').text()).toBe(
      "Nothing open. 1 dismissed finding is hidden; see Dismissed.",
    );
    scoped.unmount();
  });

  it("active_dismissals_stay_reachable_without_a_board", async () => {
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([fid(7)]));
    const listed = async (wrapper: VueWrapper) =>
      wrapper.findAll('[data-test="alert-calibration-dismissed-reopen"]').length;

    vi.mocked(alertCalibration.readDigests).mockResolvedValue([] as never);
    const noRun = await mountPage();
    await settle();
    expect(noRun.find('[data-test="alert-calibration-dashboard-empty"]').exists()).toBe(true);
    expect(filterText()).toContain("Dismissed (1)");
    noRun.unmount();
    const noRunList = await mountPage({ findings: "dismissed" });
    await settle();
    expect(noRunList.find('[data-test="alert-calibration-dashboard-no-board"]').exists()).toBe(
      true,
    );
    expect(await listed(noRunList)).toBe(1);
    noRunList.unmount();

    vi.mocked(alertCalibration.readDigests).mockRejectedValue(new Error("HTTP 500"));
    const failed = await mountPage({ findings: "dismissed" });
    await settle();
    expect(failed.find('[data-test="alert-calibration-dashboard-no-board"]').exists()).toBe(true);
    expect(await listed(failed)).toBe(1);
    failed.unmount();

    queryClient.clear();
    serve([nodest(1)], 1);
    vi.mocked(alertCalibration.getConfig).mockResolvedValue(config(false) as never);
    const off = await mountPage({ findings: "dismissed" });
    await settle();
    expect(off.find('[data-test="alert-calibration-dashboard-no-board"]').exists()).toBe(true);
    expect(await listed(off)).toBe(1);
    off.unmount();

    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
    const clean = await mountPage();
    await settle();
    expect(clean.find('[data-test="alert-calibration-dashboard-not-enabled"]').exists()).toBe(true);
    expect(filterText()).toBe("");
    clean.unmount();
  });

  it("a_cached_state_read_waits_for_this_visits_answer", async () => {
    serve([nodest(1)], 1);
    const key = alertCalibrationKeys.dismissals("default");
    const fresh = () => {
      let land: (value: unknown) => void = () => {};
      vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(
        () => new Promise((resolve) => (land = resolve)) as never,
      );
      return (value: unknown) => land(value);
    };
    const board = (wrapper: VueWrapper) =>
      wrapper.find('[data-test="alert-calibration-dashboard-attention"]').exists();

    // An earlier visit cached f1 as dismissed; it has since been reopened.
    queryClient.setQueryData(key, {
      items: (dismissalPage([fid(1)]) as { data: { items: unknown[] } }).data.items,
      total: 1,
      capped: false,
    });
    const answer = fresh();
    const wrapper = await mountPage();
    await settle();
    expect(board(wrapper)).toBe(false);
    answer(dismissalPage([]));
    await settle();
    expect(board(wrapper)).toBe(true);
    expect(openStat(wrapper)?.value).toBe("1");
    expect(filterText()).toContain("Dismissed (0)");
    wrapper.unmount();

    // An earlier visit cached a failed read; this visit's read succeeds.
    queryClient.clear();
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: key })
      .setState({ status: "error", error: new Error("HTTP 500"), errorUpdateCount: 1 });
    const second = fresh();
    const again = await mountPage();
    await settle();
    expect(board(again)).toBe(false);
    second(dismissalPage([]));
    await settle();
    expect(board(again)).toBe(true);
    expect(again.find('[data-test="alert-calibration-dashboard-states-unknown"]').exists()).toBe(
      false,
    );
    again.unmount();
  });
});

describe("AlertCalibrationDashboard row next steps", () => {
  const v2failure = record({
    schema_version: 2,
    kind: "finding",
    rule_id: "failure",
    severity: "High",
    confidence: "High",
    title: "payments filters on upstream_bucket, a field its stream doesn't have",
    alert_id: "a1",
    alert_name: "payments",
    finding_id: fid(1),
    scope_kind: "alert",
    scope_key: "a1",
    insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a1", focus: "query" }]),
  });

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(openAlertReview).mockReset();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
      ai_enabled: true,
    };
    vi.mocked(alertCalibration.getConfig).mockResolvedValue(config(true) as never);
    vi.mocked(alertCalibration.getStatus).mockResolvedValue({ data: { last_run: null } } as never);
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === ""
        ? ([{ ...run, finding_count: 1 }] as never)
        : ([{ ...v2failure, finding_count: 1 }] as never),
    );
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(dismissalPage([]));
  });

  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
    }
  };
  const openFailures = async () => {
    const w = await mountPage();
    await settle();
    await w.find('[data-test="alert-calibration-dashboard-rule-failure"] button').trigger("click");
    await settle();
    return w;
  };

  const rowButtons = (w: VueWrapper) =>
    w
      .find('[data-test="alert-calibration-dashboard-alert-a1"]')
      .findAll("button")
      .map((b) => b.text());

  it("Review alert comes first and opens the editor at the finding's focus", async () => {
    const w = await openFailures();
    expect(rowButtons(w)).toEqual(["Review alert", "Open alert", "Ask AI", "Dismiss…"]);
    await w.find('[data-test="alert-calibration-dashboard-review-alert"]').trigger("click");
    expect(openAlertReview).toHaveBeenCalledWith(
      w.router,
      "default",
      { type: "review_alert", alert_id: "a1", focus: "query" },
      expect.objectContaining({ finding_id: fid(1), alert_name: "payments" }),
    );
    w.unmount();
  });

  it("Ask AI hands the chat a draft-only request and never sends it", async () => {
    const w = await openFailures();
    await w.find('[data-test="alert-calibration-dashboard-ask-ai"]').trigger("click");
    const [[payload]] = w.emitted("sendToAiChat") as [[Record<string, unknown>]];
    expect(payload.autoSend).toBe(false);
    expect(payload.prompt).toContain("Alert payments filters on upstream_bucket");
    expect(payload.chipName).toBe("AutoObserve finding · payments");
    w.unmount();
  });

  it("dismiss_on_a_row_is_the_quiet_xs_button_the_cards_use_not_a_link", async () => {
    const w = await openFailures();
    const dismiss = w
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "alert-calibration-dashboard-dismiss");
    expect(dismiss?.props("variant")).toBe("ghost-muted");
    expect(dismiss?.props("size")).toBe("xs");
    w.unmount();
  });

  it("Ask AI is absent when AI is off", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: false };
    const w = await openFailures();
    expect(rowButtons(w)).toEqual(["Review alert", "Open alert", "Dismiss…"]);
    w.unmount();
  });

  it("a version-1 row keeps today's buttons", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: false };
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : (findings as never),
    );
    const w = await openFailures();
    expect(w.findAll('[data-test="alert-calibration-dashboard-review-alert"]')).toHaveLength(0);
    expect(rowButtons(w)).toContain("Open alert");
    w.unmount();
  });

  it("an_applied_finding_says_so_on_its_row_with_undo_instead_of_review_change", async () => {
    const withChange = record({
      ...findings[1],
      finding_id: fid(7),
      insight_actions: JSON.stringify([
        {
          type: "apply_suggestion",
          alert_id: "a2",
          patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
        },
      ]),
    } as Partial<DigestRecord>);
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : ([findings[0], withChange] as never),
    );
    const applied: DecisionView = {
      decision_id: `alert_finding:${fid(7)}:apply`,
      family: "alert_finding",
      id: fid(7),
      action: "apply",
      state: "applied",
      reason: null,
      note: null,
      has_note: false,
      actor: "root@example.com",
      source: "ui",
      decided_at: NOW - 1000,
      until: null,
      revision: 2,
      change: {
        alert: { id: "a2", title: "cpu" },
        fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
      },
    };
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: { decisions: [applied], total: 1, limit: 500, offset: 0 },
    } as never);
    try {
      const wrapper = await mountPage();
      await settle();
      await wrapper
        .find('[data-test="alert-calibration-dashboard-rule-noise"] button')
        .trigger("click");
      await settle();
      const row = wrapper.find('[data-test="alert-calibration-dashboard-alert-a2"]');
      expect(row.find('[data-test="alert-calibration-dashboard-applied"]').text()).toBe("Applied");
      expect(row.find('[data-test="alert-calibration-dashboard-review-change"]').exists()).toBe(
        false,
      );
      expect(row.find('[data-test="alert-calibration-dashboard-undo-apply"]').text()).toBe("Undo");
      // The run's sentence describes the alert before the change, so the row says what was changed instead.
      const line = row.find('[data-test="alert-calibration-dashboard-alert-line"]').text();
      expect(line).not.toContain("40 times");
      expect(line).toContain("0 seconds → 2 minutes");
      wrapper.unmount();
    } finally {
      vi.mocked(autoobserveDecisions.list).mockImplementation(() =>
        Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } })),
      );
    }
  });

  it("an_undone_apply_offers_review_change_again_without_a_reload", async () => {
    const withChange = record({
      ...findings[1],
      finding_id: fid(7),
      insight_actions: JSON.stringify([
        {
          type: "apply_suggestion",
          alert_id: "a2",
          patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
        },
      ]),
    } as Partial<DigestRecord>);
    // The server offers a change only while the alert still needs it, so the applied alert's record has none.
    let alertHasChange = false;
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === ""
        ? ([run] as never)
        : ([
            findings[0],
            alertHasChange ? withChange : { ...withChange, insight_actions: "[]" },
          ] as never),
    );
    const applied: DecisionView = {
      decision_id: `alert_finding:${fid(7)}:apply`,
      family: "alert_finding",
      id: fid(7),
      action: "apply",
      state: "applied",
      reason: null,
      note: null,
      has_note: false,
      actor: "root@example.com",
      source: "ui",
      decided_at: NOW - 1000,
      until: null,
      revision: 2,
      change: {
        alert: { id: "a2", title: "cpu" },
        fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
      },
    };
    const page = (view: DecisionView) =>
      ({ data: { decisions: [view], total: 1, limit: 500, offset: 0 } }) as never;
    vi.mocked(autoobserveDecisions.list).mockResolvedValue(page(applied));
    const undo = vi.spyOn(autoobserveDecisions, "undo").mockResolvedValue({
      data: { change: "changed", decision: { ...applied, state: "undone", revision: 3 } },
    } as never);
    try {
      const wrapper = await mountPage();
      await settle();
      await wrapper
        .find('[data-test="alert-calibration-dashboard-rule-noise"] button')
        .trigger("click");
      await settle();
      vi.mocked(autoobserveDecisions.list).mockResolvedValue(
        page({ ...applied, state: "undone", revision: 3 }),
      );
      alertHasChange = true;
      await wrapper.find('[data-test="alert-calibration-dashboard-undo-apply"]').trigger("click");
      await settle();
      const row = wrapper.find('[data-test="alert-calibration-dashboard-alert-a2"]');
      expect(row.find('[data-test="alert-calibration-dashboard-applied"]').exists()).toBe(false);
      expect(row.find('[data-test="alert-calibration-dashboard-review-change"]').text()).toBe(
        "Review change",
      );
      wrapper.unmount();
    } finally {
      undo.mockRestore();
      vi.mocked(autoobserveDecisions.list).mockImplementation(() =>
        Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } })),
      );
    }
  });

  it("a finding that stores a change offers Review change on its row, opening the dialog (W5)", async () => {
    const withChange = record({
      ...findings[1],
      finding_id: fid(7),
      insight_actions: JSON.stringify([
        {
          type: "apply_suggestion",
          alert_id: "a2",
          patch: [{ field: "pending_period_secs", from: 0, to: 120 }],
        },
      ]),
    } as Partial<DigestRecord>);
    vi.mocked(alertCalibration.readDigests).mockImplementation(async (_org, read) =>
      read === "" ? ([run] as never) : ([findings[0], withChange] as never),
    );
    const wrapper = await mountPage();
    await wrapper
      .find('[data-test="alert-calibration-dashboard-rule-noise"] button')
      .trigger("click");
    await flushPromises();
    const row = wrapper.find('[data-test="alert-calibration-dashboard-alert-a2"]');
    const button = row.find('[data-test="alert-calibration-dashboard-review-change"]');
    expect(button.text()).toBe("Review change");
    await button.trigger("click");
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "ReviewChangeDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("target")).toMatchObject({
      findingId: fid(7),
      alertId: "a2",
      alertName: "cpu",
    });
    await wrapper
      .find('[data-test="alert-calibration-dashboard-rule-failure"] button')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper
        .find('[data-test="alert-calibration-dashboard-alert-a1"]')
        .find('[data-test="alert-calibration-dashboard-review-change"]')
        .exists(),
    ).toBe(false);
    wrapper.unmount();
  });
});
