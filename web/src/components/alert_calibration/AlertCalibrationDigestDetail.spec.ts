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
import AlertCalibrationDigestDetail from "./AlertCalibrationDigestDetail.vue";
import { SEARCH_SIZE, type DigestRecord } from "./digests";

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
    wrapper.unmount();
  });
});
