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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import type { FindingRecord } from "./digests";

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
    expect(rows.map((row) => row.text())).toEqual([
      "globex3 skipped, 0 of 100 late",
      "acme0 skipped, 40 of 100 late",
    ]);
    expect(wrapper.text()).toContain("Most affected orgs");
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

  it("lists nothing for a rule that names its alert", () => {
    const wrapper = mountCard(
      finding({ rule_id: "noise", alert_name: "cpu", actions: "RaiseThreshold" }),
    );
    expect(wrapper.find('[data-test="alert-calibration-finding-lag-row"]').exists()).toBe(false);
  });
});
