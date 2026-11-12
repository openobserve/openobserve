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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AlertCalibrationDigestDetail from "./AlertCalibrationDigestDetail.vue";
import { SEARCH_SIZE, type DigestRecord } from "./digests";
import { ALERT_PREFILL_KEY } from "@/utils/alerts/alertPrefillStorage";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listByFolderId: vi.fn().mockResolvedValue({ data: { list: [] } }) },
  });
});

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: { ...actual.default, readDigests: vi.fn(), listDismissals: vi.fn() },
  };
});

const WINDOW_START = 1_000_000_000;
const WINDOW_END = 2_000_000_000;

const runColumns = (written: number): DigestRecord => ({
  _timestamp: WINDOW_END + 5,
  org: "default",
  config_id: "c1",
  schema_version: 2,
  window_start: WINDOW_START,
  window_end: WINDOW_END,
  finding_count: 0,
  skip_count: written,
  written_skip_count: written,
  omitted_routine_skip_count: 0,
  alerts_in_scope: written,
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
});

const skip = (written: number, n: number, extra: Partial<DigestRecord> = {}): DigestRecord => ({
  ...runColumns(written),
  kind: "skip",
  rule_id: "noise",
  alert_id: `a${n}`,
  alert_name: `queue_${String(n).padStart(3, "0")}`,
  skip_reason: "sentinel_by_design",
  ...extra,
});

/** Truncation is flagged in amber, the same token for every cap notice (P1-D7, UX ruling 22). */
const AMBER = "text-status-warning-text";

/** OText's own meta colour wins over a class on it, so the amber has to sit on the text inside. */
const amberText = (selector: string, wrapper: VueWrapper) =>
  wrapper.find(`${selector} .${AMBER}`).text();

const finding = (total: number, n: number): DigestRecord => ({
  ...runColumns(0),
  finding_count: total,
  kind: "finding",
  rule_id: "noise",
  severity: "Medium",
  confidence: "High",
  title: `queue_${String(n).padStart(3, "0")} fired often`,
  alert_id: `a${n}`,
  alert_name: `queue_${String(n).padStart(3, "0")}`,
});

const mountDetail = async (records: DigestRecord[]) => {
  vi.mocked(alertCalibration.readDigests).mockResolvedValue(records);
  // The page waits for the dismissals read, so every mount answers it.
  vi.mocked(alertCalibration.listDismissals).mockResolvedValue({
    data: { items: [], next_cursor: null, total: 0 },
  } as never);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/alert-calibration/digests/:windowStart/:windowEnd",
        name: "alertCalibrationDigest",
        component: AlertCalibrationDigestDetail,
      },
      {
        path: "/alert-calibration/runs",
        name: "alertCalibrationRuns",
        component: { template: "<div />" },
      },
      { path: "/alerts", name: "alertList", component: { template: "<div />" } },
      { path: "/alerts/edit/:alert_id", name: "editAlert", component: { template: "<div />" } },
    ],
  });
  await router.push({
    name: "alertCalibrationDigest",
    params: { windowStart: WINDOW_START, windowEnd: WINDOW_END },
    query: { org_identifier: "default" },
  });
  await router.isReady();
  const wrapper = mount(AlertCalibrationDigestDetail, {
    props: { windowStart: WINDOW_START, windowEnd: WINDOW_END },
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const notChecked = (written: number, n: number, cause: string): DigestRecord =>
  skip(written, n, {
    rule_id: "failure",
    skip_reason: "definition_not_checked",
    skip_detail: JSON.stringify({ cause }),
  });

const GROUP = '[data-test="alert-calibration-skip-group"]';

describe("AlertCalibrationDigestDetail definition not checked", () => {
  beforeEach(() => {
    queryClient.clear();
    sessionStorage.clear();
  });

  it("shows no group when no skip is a not-checked definition", async () => {
    const wrapper = await mountDetail([skip(1, 1)]);
    expect(wrapper.find(GROUP).exists()).toBe(false);
    expect(wrapper.findAll('[data-test="alert-calibration-digest-skip"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it("moves them out of the declined list into one group by cause, in words only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountDetail([
      notChecked(4, 1, "unsupported_query"),
      notChecked(4, 2, "warp_drive"),
      notChecked(4, 3, "probe_timeout"),
      skip(4, 3, { rule_id: "failure", skip_reason: "insufficient_history" }),
    ]);
    const group = wrapper.get(GROUP);
    expect(group.get('[data-test="alert-calibration-skip-group-title"]').text()).toBe(
      "Definition not checked",
    );
    expect(group.get('[data-test="alert-calibration-skip-group-count"]').text()).toBe("3");
    const causes = group.findAll('[data-test="alert-calibration-skip-group-cause"]');
    const why = '[data-test="alert-calibration-skip-group-cause-why"]';
    expect(causes.map((c) => c.get(why).text())).toEqual([
      "The check timed out.",
      "The check can't read this kind of query yet.",
      "The check did not finish.",
    ]);
    expect(causes[0].text()).toContain("It is checked again within a day.");
    expect(causes[1].text()).toContain("Review the query:");
    for (const code of [
      "probe_timeout",
      "unsupported_query",
      "warp_drive",
      "definition_not_checked",
    ]) {
      expect(wrapper.text()).not.toContain(code);
    }
    expect(wrapper.findAll('[data-test="alert-calibration-digest-skip"]')).toHaveLength(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Duplicate keys");
    warn.mockRestore();
    wrapper.unmount();
  });

  it("Review query opens the alert editor at the query with the skip as its handoff", async () => {
    const wrapper = await mountDetail([notChecked(1, 7, "probe_rejected")]);
    const button = wrapper.get(`${GROUP} [data-test="alert-calibration-skip-group-row"] button`);
    expect(button.text()).toBe("Review alert");
    await button.trigger("click");
    await flushPromises();
    expect(JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY)!)).toMatchObject({
      source: "calibration",
      target: { alertId: "a7", findingId: "" },
      focus: "query",
    });
    const router = wrapper.vm.$router;
    expect(router.currentRoute.value.name).toBe("editAlert");
    expect(router.currentRoute.value.query).toMatchObject({
      org_identifier: "default",
      prefill: "calibration",
    });
    wrapper.unmount();
  });
});

describe("AlertCalibrationDigestDetail declined list", () => {
  beforeEach(() => {
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  it("says when a run with only declines lists fewer than it wrote", async () => {
    const written = SEARCH_SIZE + 40;
    const wrapper = await mountDetail(
      Array.from({ length: SEARCH_SIZE }, (_, n) => skip(written, n)),
    );
    expect(wrapper.findAll('[data-test="alert-calibration-digest-skip"]')).toHaveLength(
      SEARCH_SIZE,
    );
    expect(wrapper.find('[data-test="alert-calibration-digest-skips-capped"]').text()).toBe(
      `Showing ${SEARCH_SIZE} of ${written} declines: the search stopped at ${SEARCH_SIZE} records.`,
    );
    expect(amberText('[data-test="alert-calibration-digest-skips-capped"]', wrapper)).toBe(
      `Showing ${SEARCH_SIZE} of ${written} declines: the search stopped at ${SEARCH_SIZE} records.`,
    );
    wrapper.unmount();
  });

  it("adds no cap notice when every written decline is listed", async () => {
    const wrapper = await mountDetail([skip(2, 1), skip(2, 2)]);
    expect(wrapper.findAll('[data-test="alert-calibration-digest-skip"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-calibration-digest-skips-capped"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("names a decline's detail and rule in words, never as stored", async () => {
    const wrapper = await mountDetail([
      skip(3, 1, {
        skip_reason: "unmeasurable_signal",
        skip_detail: '{"signal":"incident_linkage"}',
      }),
      skip(3, 2, { skip_reason: "unmeasurable_signal", skip_detail: '{"signal":"queue_depth"}' }),
      skip(3, 3, { rule_id: "capacity" as DigestRecord["rule_id"] }),
    ]);
    const rows = wrapper.findAll('[data-test="alert-calibration-digest-skip"]');
    expect(rows.map((r) => r.text())).toEqual([
      "Another rulequeue_003Quiet by design",
      "Noisequeue_001A signal the rule needs is missingSignal: Incident linkage",
      "Noisequeue_002A signal the rule needs is missingMore detail in Logs",
    ]);
    const shown = wrapper.find('[data-test="alert-calibration-digest-skips"]').text();
    for (const stored of ["{", "incident_linkage", "queue_depth", "capacity"]) {
      expect(shown).not.toContain(stored);
    }
    wrapper.unmount();
  });

  it("flags a capped findings read in the same amber as a capped declined list", async () => {
    const total = SEARCH_SIZE + 30;
    const wrapper = await mountDetail(
      Array.from({ length: SEARCH_SIZE }, (_, n) => finding(total, n)),
    );
    const notice = wrapper.find('[data-test="alert-calibration-digest-findings-capped"]');
    expect(notice.text()).toBe(
      `Showing ${SEARCH_SIZE} of ${total} findings: the search stopped at ${SEARCH_SIZE} records.`,
    );
    expect(amberText('[data-test="alert-calibration-digest-findings-capped"]', wrapper)).toBe(
      notice.text(),
    );
    (wrapper.vm as any).onRuleFilter("failure");
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_rule_filtered", {
      rule: "failure",
    });
    wrapper.unmount();
  });
});

describe("AlertCalibrationDigestDetail for a scoped reader", () => {
  beforeEach(() => {
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  const scoped = (record: DigestRecord): DigestRecord => ({
    ...record,
    alerts_in_scope: null,
    omitted_routine_skip_count: null,
    coverage_unreadable_definitions: null,
    visibility: "scoped",
  });
  const runRow = (findings: number) =>
    scoped({ ...runColumns(0), finding_count: findings, kind: "run" });

  it("no reader gets View in Logs", async () => {
    for (const records of [[runRow(0)], [{ ...runColumns(0), kind: "run" }]]) {
      const wrapper = await mountDetail(records);
      expect(wrapper.find('[data-test="alert-calibration-digest-clean"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-calibration-digest-view-in-logs"]').exists()).toBe(
        false,
      );
      wrapper.unmount();
    }
  });

  it("a scoped run hides View in Logs and the org count", async () => {
    const shown = SEARCH_SIZE - 1;
    const wrapper = await mountDetail([
      runRow(shown),
      ...Array.from({ length: shown }, (_, n) => scoped(finding(shown, n))),
    ]);
    expect(wrapper.find('[data-test="alert-calibration-digest-view-in-logs"]').exists()).toBe(
      false,
    );
    const stats = wrapper.find('[data-test="alert-calibration-digest-stats"]');
    expect(stats.text()).toContain("—");
    expect(stats.get('[data-test="o-stat-card-sub-icon"]').attributes("aria-label")).toBe(
      "Shown only with access to every alert",
    );
    expect(wrapper.find('[data-test="alert-calibration-digest-findings-capped"]').exists()).toBe(
      false,
    );
    wrapper.unmount();

    const nothing = await mountDetail([runRow(0)]);
    expect(nothing.find('[data-test="alert-calibration-digest-clean"]').text()).toContain(
      "Alert calibration found nothing on the alerts you can access in this run.",
    );
    expect(nothing.text()).not.toContain("alerts in scope, alert calibration found nothing");
    nothing.unmount();

    const root = await mountDetail([{ ...runColumns(0), kind: "run" }]);
    expect(root.find('[data-test="alert-calibration-digest-view-in-logs"]').exists()).toBe(false);
    expect(root.find('[data-test="alert-calibration-digest-clean"]').text()).toContain(
      "across 0 alerts in scope",
    );
    root.unmount();
  });

  it("a newer emission's findings show although its counts did not arrive with them", async () => {
    const unread = { finding_count: null, skip_count: null, written_skip_count: null };
    const newer = (n: number) => ({
      ...scoped(finding(0, n)),
      ...unread,
      _timestamp: WINDOW_END + 9,
    });
    const wrapper = await mountDetail([runRow(0), newer(0), newer(1)]);
    expect(wrapper.findAll('[data-test="alert-calibration-finding-tile"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-calibration-digest-clean"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-calibration-digest-none-found"]').exists()).toBe(false);
    const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
    expect(items[0]).toMatchObject({ value: "—", tone: "warning" });
    expect(items[2]).toMatchObject({ value: "—" });
    expect(wrapper.text()).not.toContain("null");
    wrapper.unmount();

    const capped = await mountDetail(Array.from({ length: SEARCH_SIZE }, (_, n) => newer(n)));
    expect(amberText('[data-test="alert-calibration-digest-findings-capped"]', capped)).toBe(
      `Showing ${SEARCH_SIZE} findings: the search stopped at ${SEARCH_SIZE} records.`,
    );
    capped.unmount();
  });

  it("a scoped run whose counts are not ready yet says so in amber, not None found", async () => {
    const unread = { finding_count: null, skip_count: null, written_skip_count: null };
    const wrapper = await mountDetail([{ ...runRow(0), ...unread }]);
    const pending = wrapper
      .findAllComponents(OBanner)
      .find((b) => b.attributes("data-test") === "alert-calibration-digest-counts-pending");
    expect(pending?.props("variant")).toBe("warning");
    expect(pending?.text()).toBe(
      "Counts on the alerts you can access are not ready yet. Refresh shortly.",
    );
    expect(wrapper.find('[data-test="alert-calibration-digest-none-found"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-calibration-digest-clean"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("a scoped version-2 run shows version-2 rules and its definition-check note", async () => {
    // The run row as the server synthesizes it for a scoped reader of a version-2 run (P3I-D1).
    const versioned = {
      schema_version: 2,
      coverage_definition_checks: "unavailable" as const,
      coverage_definition_checks_truncated: false,
    };
    const failure = scoped({ ...finding(1, 0), rule_id: "failure", ...versioned });
    const wrapper = await mountDetail([{ ...runRow(1), ...versioned }, failure]);
    const filter = wrapper.find('[data-test="alert-calibration-digest-rule-filter"]');
    expect(filter.text()).toContain("Alert not working");
    expect(filter.text()).not.toContain("Silent");
    expect(wrapper.text()).toContain(
      "Alert definition checks need AutoObserve, which is off. The other checks ran.",
    );
    wrapper.unmount();
  });
});

describe("AlertCalibrationDigestDetail load failure", () => {
  beforeEach(() => {
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  it("a failed records read shows the plain error copy, never the server's words", async () => {
    vi.mocked(alertCalibration.readDigests).mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 500"), {
        response: { status: 500, data: "internal" },
      }),
    );
    const wrapper = await mountDetail([]);
    const error = wrapper.find('[data-test="alert-calibration-digest-error"]');
    expect(error.text()).toContain("Digest unavailable");
    expect(error.text()).toContain("This run couldn't be loaded. Try again in a moment.");
    expect(wrapper.text()).not.toContain("internal");
    wrapper.unmount();
  });
});

describe("AlertCalibrationDigestDetail dismissed tile", () => {
  beforeEach(() => {
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  const tile = (wrapper: VueWrapper) =>
    (wrapper.findComponent(OStatStrip).props("items") as StatItem[]).find(
      (item) => item.key === "dismissed",
    );

  it("strip counts read in the reader's locale", async () => {
    const wrapper = await mountDetail([
      { ...finding(12_345, 1), alerts_in_scope: 12_345, dismissed_count: 1_000 },
    ]);
    await flushPromises();
    const items = wrapper.findComponent(OStatStrip).props("items") as StatItem[];
    const value = (key: string) => items.find((item) => item.key === key)?.value;
    expect([value("findings"), value("scope"), value("dismissed")]).toEqual([
      "12,345",
      "12,345",
      "1,000",
    ]);
    expect(wrapper.findComponent(OStatStrip).text()).toContain("12,345");
    wrapper.unmount();
  });

  it("the_detail_tile_shows_the_runs_dismissed_count_only_when_written", async () => {
    const written = await mountDetail([{ ...finding(1, 1), dismissed_count: 2 }]);
    await flushPromises();
    expect(tile(written)?.value).toBe("2");
    expect(tile(written)?.sub).toBe("Hidden when this run was made");
    expect(tile(written)?.label).toBe("Dismissed");
    written.unmount();

    const scoped = await mountDetail([{ ...finding(1, 1), dismissed_count: null }]);
    await flushPromises();
    expect(tile(scoped)?.value).toBe("—");
    expect(tile(scoped)?.sub).toBe("Shown only with access to every alert");
    expect(tile(scoped)?.subIcon).toBe("info-outline");
    scoped.unmount();

    const before = await mountDetail([finding(1, 1)]);
    await flushPromises();
    expect(tile(before)).toBeUndefined();
    before.unmount();
  });
});

describe("AlertCalibrationDigestDetail dismissals", () => {
  const ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";
  const dismissable = (): DigestRecord => ({
    ...finding(1, 1),
    finding_id: ID,
    scope_kind: "alert",
    scope_key: "a1",
  });
  const page = (items: unknown[]) => ({ data: { items, next_cursor: null, total: items.length } });
  const active = {
    id: ID,
    rule_id: "noise",
    pattern: null,
    scope_kind: "alert",
    scope_key: "a1",
    state: "active",
    revision: 1,
    reason: "known_issue",
    note: null,
    has_note: false,
    actor: "u-ops@example.com",
    dismissed_at: 1,
    duration_days: null,
    expires_at: null,
    reopened_at: null,
    reopened_by: null,
    updated_at: 1,
    alert_name: "queue_001",
  };
  const card = (wrapper: VueWrapper) =>
    wrapper.find('[data-test="alert-calibration-finding-noise"]');

  beforeEach(() => {
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  it("the_card_paints_once_already_folded_after_a_fresh_dismissals_read", async () => {
    // A board visit before the dismiss left a cached list without this finding.
    queryClient.setQueryData(alertCalibrationKeys.dismissals("default"), {
      items: [],
      total: 0,
      capped: false,
    });
    let answer: (value: unknown) => void = () => {};
    vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const wrapper = await mountDetail([dismissable()]);
    await flushPromises();
    expect(card(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-calibration-digest-stats"]').exists()).toBe(false);
    expect(wrapper.findComponent(OSkeleton).exists()).toBe(true);

    answer(page([active]));
    await flushPromises();
    expect(card(wrapper).find('[data-test="alert-calibration-finding-dismissed"]').text()).toBe(
      "Dismissed",
    );
    expect(card(wrapper).find('[data-test="alert-calibration-finding-fold"]').text()).toContain(
      "Dismissed by u-ops@example.com",
    );
    expect(card(wrapper).find("dl").exists()).toBe(false);
    wrapper.unmount();
  });

  it("a_failed_first_dismissals_read_shows_states_unknown_with_retry", async () => {
    queryClient.setQueryDefaults(["org"], { retry: false });
    vi.mocked(alertCalibration.listDismissals).mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("HTTP 500"), { response: { status: 500 } })),
    );
    const wrapper = await mountDetail([dismissable()]);
    await flushPromises();
    const unknown = wrapper.find('[data-test="alert-calibration-digest-states-unknown"]');
    expect(unknown.text()).toContain(
      "Dismissed findings couldn't be loaded, so some findings below may already be dismissed.",
    );
    expect(
      wrapper.findAllComponents(OBanner).find((b) => b.props("variant") === "error"),
    ).toBeTruthy();
    expect(card(wrapper).find('[data-test="alert-calibration-finding-fold"]').exists()).toBe(false);

    vi.mocked(alertCalibration.listDismissals).mockResolvedValue(page([active]) as never);
    const before = vi.mocked(alertCalibration.listDismissals).mock.calls.length;
    await wrapper.find('[data-test="alert-calibration-digest-states-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(alertCalibration.listDismissals).mock.calls.length).toBe(before + 1);
    expect(wrapper.find('[data-test="alert-calibration-digest-states-unknown"]').exists()).toBe(
      false,
    );
    expect(card(wrapper).find('[data-test="alert-calibration-finding-fold"]').exists()).toBe(true);
    queryClient.setQueryDefaults(["org"], {});
    wrapper.unmount();
  });
});
