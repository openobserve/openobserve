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
import enMessages from "@/locales/languages/en-US.json";
import AlertCalibrationFindingCard from "@/components/alert_calibration/AlertCalibrationFindingCard.vue";
import { ADVICE_LABEL, RULE_META } from "@/components/alert_calibration/rules";
import type { FindingRecord } from "@/components/alert_calibration/digests";

const resolveKey = (key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      enMessages,
    );

const record = (overrides: Partial<FindingRecord>): FindingRecord =>
  ({
    _timestamp: 1,
    org: "ops",
    config_id: "c1",
    window_start: 0,
    window_end: 1,
    schema_version: 2,
    kind: "finding",
    rule_id: "no_destination",
    severity: "High",
    confidence: "High",
    tier: "A",
    title: "ops_quiet fired 5 times and has no destination attached now",
    alert_id: "a1",
    alert_name: "ops_quiet",
    finding_id: "f1",
    evidence_nodestination_firings: 5,
    evidence_nodestination_creates_incident: false,
    ...overrides,
  }) as FindingRecord;

describe("alert calibration destination suggestion copy", () => {
  it("every new copy key resolves and no code or id shows", () => {
    const keys = [
      ADVICE_LABEL.attach_folder_destination,
      ADVICE_LABEL.add_destination,
      ...RULE_META.no_destination.evidence.filter((field) => field.optional).map((f) => f.labelKey),
    ];
    expect(keys).toEqual([
      "alertCalibration.advice.attachFolderDestination",
      "alertCalibration.advice.addDestination",
      "alertCalibration.evidence.suggestedDestination",
      "alertCalibration.evidence.folderAlertsUsingIt",
    ]);
    expect(keys.filter((key) => typeof resolveKey(key) !== "string")).toEqual([]);

    const review = { type: "review_alert", alert_id: "a1", focus: "settings" };
    const shown = [
      record({
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
      record({ advice: "add_destination", insight_actions: JSON.stringify([review]) }),
    ].map((finding) =>
      mount(AlertCalibrationFindingCard, {
        props: { finding },
        global: { plugins: [store] },
      }).text(),
    );
    for (const text of shown) {
      expect(text).not.toMatch(/attach_folder_destination|add_destination|apply_suggestion/);
      expect(text).not.toMatch(/evidence_|alertCalibration\./);
      expect(text).not.toMatch(/\ba1\b|\bf1\b/);
    }
    expect(shown[0]).toContain("ops-pager");
  });
});
