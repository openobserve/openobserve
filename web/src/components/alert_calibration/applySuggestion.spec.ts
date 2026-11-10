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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { ALERT_PREFILL_VERSION } from "@/ts/interfaces/alertPrefill";
import type { FindingRecord } from "./digests";
import { applyCopy, applySuggestionsOf, toEditHandoff } from "./applySuggestion";

/** The pinned wire shape (spec-detail 4a); each writer phase adds a serde test equal to it. */
const FIXTURE = {
  type: "apply_suggestion",
  alert_id: "a1",
  patch: [{ field: "pending_period_secs", from: 60, to: 120 }],
};

const t = i18n.global.t as unknown as TranslateFn;

const record = (insight_actions: unknown): FindingRecord =>
  ({
    _timestamp: 1,
    org: "ops",
    config_id: "c1",
    window_start: 0,
    window_end: 1,
    schema_version: 2,
    kind: "finding",
    rule_id: "noise",
    severity: "Medium",
    confidence: "High",
    title: "ops_cpu fires too often",
    alert_id: "a1",
    alert_name: "ops_cpu",
    finding_id: "f1",
    insight_actions,
  }) as FindingRecord;

describe("applySuggestionsOf", () => {
  it("keeps a valid apply_suggestion and drops a bad one whole", () => {
    const pending = FIXTURE.patch[0];
    const actions = [
      FIXTURE,
      { ...FIXTURE, patch: [pending, { field: "query", from: "a", to: "b" }] },
      { type: "apply_suggestion", alert_ids: ["a1", "a2"], patch: FIXTURE.patch },
      { ...FIXTURE, alert_ids: ["a1", "a2"] },
      { ...FIXTURE, patch: [{ field: "pending_period_secs", from: 60, to: 90 }] },
      { ...FIXTURE, patch: [{ field: "keep_firing_for_secs", from: 0, to: 90_000 }] },
      { ...FIXTURE, patch: [{ field: "silence_minutes", from: 10, to: -1 }] },
      { ...FIXTURE, patch: [{ field: "silence_minutes", from: 10, to: 10 }] },
      { ...FIXTURE, patch: [{ field: "destinations", from: [], to: "ops" }] },
    ];
    expect(applySuggestionsOf(record(JSON.stringify(actions)))).toEqual([FIXTURE]);
  });

  it("drops an action for another alert, an empty or repeated patch, and anything not JSON", () => {
    const pending = FIXTURE.patch[0];
    const actions = [
      { ...FIXTURE, alert_id: "a2" },
      { ...FIXTURE, patch: [] },
      { ...FIXTURE, patch: [pending, pending] },
      { ...FIXTURE, patch: [{ ...pending, note: "x" }] },
      { ...FIXTURE, reason: "x" },
      { type: "review_alert", alert_id: "a1" },
    ];
    expect(applySuggestionsOf(record(actions))).toEqual([]);
    expect(applySuggestionsOf(record("not json"))).toEqual([]);
    expect(applySuggestionsOf(record(undefined))).toEqual([]);
  });
});

describe("toEditHandoff", () => {
  it("carries the patch in the design's keys and focuses its first field", () => {
    const action = {
      ...FIXTURE,
      patch: [
        { field: "silence_minutes", from: 10, to: 45 },
        { field: "destinations", from: [], to: ["ops-pager"] },
      ],
    };
    const [suggestion] = applySuggestionsOf(record([action]));
    expect(toEditHandoff(suggestion, record([action]))).toEqual({
      version: ALERT_PREFILL_VERSION,
      source: "calibration",
      target: { alertId: "a1", findingId: "f1" },
      focus: "silence",
      patch: {
        silenceMinutes: { from: 10, to: 45 },
        destinations: { from: [], to: ["ops-pager"] },
      },
    });
  });

  it("maps a review focus onto the editor field and carries no patch", () => {
    const review = (focus?: "query" | "threshold" | "grouping" | "settings") =>
      toEditHandoff({ type: "review_alert", alert_id: "a1", focus }, record([]));
    expect(review("query")).toMatchObject({ focus: "query" });
    expect(review("threshold")).toMatchObject({ focus: "threshold" });
    expect(review("grouping")).toMatchObject({ focus: "query" });
    expect(review("settings")).not.toHaveProperty("focus");
    expect(review()).not.toHaveProperty("patch");
  });

  it("opens a failing-notifications alert at its destinations", () => {
    const failed = { ...record([]), rule_id: "notify_failed" } as FindingRecord;
    const review = (focus?: "settings" | "query") =>
      toEditHandoff({ type: "review_alert", alert_id: "a1", focus }, failed);
    expect(review("settings")).toMatchObject({ focus: "destinations" });
    expect(review()).toMatchObject({ focus: "destinations" });
    expect(review("query")).toMatchObject({ focus: "query" });
  });
});

describe("applyCopy", () => {
  const copy = applyCopy(t, "en-US");

  it("reads a change in the editor's own field names and units", () => {
    expect(
      copy.changes([
        { key: "pendingPeriodSecs", from: 60, to: 120, live: 60 },
        { key: "silenceMinutes", from: 10, to: 45, live: 10 },
      ]),
    ).toBe("Hold for 1 minute → 2 minutes and Cooldown period 10 minutes → 45 minutes");
  });

  it("lists up to three names and counts the rest", () => {
    expect(copy.list(["a"])).toBe("a");
    expect(copy.list(["a", "b", "c", "d", "e"])).toBe("a, b, c, and 2 more");
    expect(copy.value("destinations", [])).toBe("No destination");
  });

  it("names the missing destinations in the singular and the plural", () => {
    expect(copy.notApplied("missingDestination", ["gone"])).toBe(
      "gone no longer exists, so destinations were not changed. Choose a destination.",
    );
    expect(copy.notApplied("missingDestination", ["x", "y"])).toBe(
      "x and y no longer exist, so destinations were not changed. Choose a destination.",
    );
  });
});
