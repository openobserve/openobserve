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
import alertCalibration from "@/services/alert_calibration";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AlertCalibrationDigestDetail from "./AlertCalibrationDigestDetail.vue";
import { SEARCH_SIZE, type DigestRecord } from "./digests";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return { ...actual, default: { ...actual.default, readDigests: vi.fn() } };
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
    expect(analytics.track).toHaveBeenCalledWith("alert_calibration_digest_logs_opened");
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
    expect(root.find('[data-test="alert-calibration-digest-view-in-logs"]').exists()).toBe(true);
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
