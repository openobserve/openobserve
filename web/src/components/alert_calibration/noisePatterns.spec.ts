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
import { gt } from "@/types/i18n";
import {
  adviceOf,
  limitationsOf,
  qualityReasonsOf,
  routineSkipsOf,
  type DigestRecord,
  type RuleId,
} from "./digests";
import { formatEvidenceField, skipDetailLabel, skipReasonLabel } from "./format";
import { evidenceFor } from "./rules";
import { dismissalCopy, findingPatternKey } from "./dismissals";

const record = (overrides: Partial<DigestRecord> = {}): DigestRecord & { rule_id: RuleId } => ({
  _timestamp: 1,
  org: "acme",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  finding_count: 1,
  skip_count: 0,
  alerts_in_scope: 1,
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
  schema_version: 2,
  kind: "finding",
  ...overrides,
  rule_id: overrides.rule_id ?? "noise",
});

const shown = (r: DigestRecord & { rule_id: RuleId }) =>
  evidenceFor(r).map((field) => [field.column, formatEvidenceField(gt, r, field, "en-US")]);

/** The section 4 example of the noise rule revision, as the digest flattens it. */
const SHORT_BLIPS = record({
  pattern: "short_blips",
  limitations: JSON.stringify([
    "attended_lower_bound",
    "on_schedule_estimate",
    "duration_upper_bound",
  ]),
  advice: "add_pending_period",
  evidence_shortblips_complete_episodes: 80,
  evidence_shortblips_would_not_alert: 37,
  evidence_shortblips_interval_secs: 60,
  evidence_shortblips_current_pending_secs: 0,
  evidence_shortblips_suggested_pending_secs: 600,
  evidence_shortblips_short_episodes: 37,
  evidence_shortblips_long_episodes: 43,
  evidence_shortblips_bounded_episodes: 37,
  evidence_shortblips_silence_secs: 300,
});

const RECOVERY_HOLD = record({
  pattern: "recovery_hold",
  limitations: JSON.stringify(["recovery_reported_later", "on_schedule_estimate"]),
  advice: "add_recovery_hold",
  evidence_recoveryhold_short_clear_gaps: 47,
  evidence_recoveryhold_clear_gaps: 79,
  evidence_recoveryhold_interval_secs: 60,
  evidence_recoveryhold_current_keep_firing_for_secs: 0,
  evidence_recoveryhold_suggested_keep_firing_for_secs: 120,
});

const STRETCH_AT = new Date(2026, 10, 20, 9, 0).getTime() * 1000;

const SUSTAINED = record({
  pattern: "sustained_no_response",
  tier: "C",
  limitations: JSON.stringify([
    "firing_time_lower_bound",
    "attended_lower_bound",
    "on_schedule_estimate",
  ]),
  advice: "review_threshold",
  evidence_sustainedfiring_span_secs: 7 * 86_400,
  evidence_sustainedfiring_firing_secs: 517_104,
  evidence_sustainedfiring_firing_share: 0.855,
  evidence_sustainedfiring_episodes_in_span: 56,
  evidence_sustainedfiring_firings_in_span: 1082,
  evidence_sustainedfiring_stretch_started_at: STRETCH_AT,
  evidence_sustainedfiring_longest_lower_secs: 122_400,
  evidence_sustainedfiring_open_lower_secs: 122_400,
  evidence_sustainedfiring_org_answer_rows: 25,
});

describe("a short-blips card", () => {
  it("lists the longer firings the suggestion does not remove", () => {
    expect(shown(SHORT_BLIPS)).toEqual([
      ["evidence_shortblips_complete_episodes", "80"],
      ["evidence_shortblips_would_not_alert", "37"],
      ["evidence_shortblips_interval_secs", "1 minute"],
      ["evidence_shortblips_current_pending_secs", "0 seconds"],
      ["evidence_shortblips_suggested_pending_secs", "10 minutes"],
      ["evidence_shortblips_long_episodes", "43"],
    ]);
  });

  it("says a cooldown-bounded value follows the cooldown, not a measured length", () => {
    expect(limitationsOf(gt, SHORT_BLIPS)).toEqual([
      "Some responses could not be matched to one alert group, so the attended count is a minimum.",
      "Lengths are counted in checks on the alert's saved schedule; a missed check does not show.",
      "37 short firings were paused by the alert's 5 minutes cooldown, so the suggested value follows the cooldown, not a measured firing length.",
    ]);
    expect(adviceOf(gt, SHORT_BLIPS)).toBe(
      "Set a pending period, so the condition must hold that long before the alert fires.",
    );
  });

  it("drops the cooldown sentence when the record does not state the cooldown", () => {
    const unstated = { ...SHORT_BLIPS, evidence_shortblips_silence_secs: undefined };
    expect(limitationsOf(gt, unstated)).toHaveLength(2);
  });
});

describe("a recovery-hold card", () => {
  it("shows the clears it measured and both holds, with no removed-firings count", () => {
    expect(shown(RECOVERY_HOLD)).toEqual([
      ["evidence_recoveryhold_short_clear_gaps", "47"],
      ["evidence_recoveryhold_clear_gaps", "79"],
      ["evidence_recoveryhold_interval_secs", "1 minute"],
      ["evidence_recoveryhold_current_keep_firing_for_secs", "0 seconds"],
      ["evidence_recoveryhold_suggested_keep_firing_for_secs", "2 minutes"],
    ]);
  });

  it("states that recovery is reported later by the suggested hold", () => {
    expect(limitationsOf(gt, RECOVERY_HOLD)[0]).toBe(
      "With the hold, every recovery is reported up to 2 minutes later.",
    );
    expect(adviceOf(gt, RECOVERY_HOLD)).toBe(
      "Set Keep firing for, so a clear that the next check undoes does not end the firing.",
    );
  });
});

describe("a sustained-firing card", () => {
  it("shows the evidence, each duration as a lower bound", () => {
    expect(shown(SUSTAINED)).toEqual([
      ["evidence_sustainedfiring_firing_share", "85.5%"],
      ["evidence_sustainedfiring_span_secs", "7 days"],
      ["evidence_sustainedfiring_firings_in_span", "1,082"],
      ["evidence_sustainedfiring_episodes_in_span", "56"],
      ["evidence_sustainedfiring_stretch_started_at", "Nov 20, 09:00"],
      ["evidence_sustainedfiring_longest_lower_secs", "At least 34 hours"],
      ["evidence_sustainedfiring_open_lower_secs", "Yes, for at least 34 hours"],
      ["evidence_sustainedfiring_last_attended_at", "None recorded"],
      ["evidence_sustainedfiring_org_answer_rows", "25"],
    ]);
  });

  it("says when it is no longer firing, and when someone last responded", () => {
    const answered = new Date(2026, 10, 18, 14, 30).getTime() * 1000;
    const r = {
      ...SUSTAINED,
      evidence_sustainedfiring_open_lower_secs: undefined,
      evidence_sustainedfiring_last_attended_at: answered,
      evidence_sustainedfiring_firings_in_span: undefined,
    };
    const rows = Object.fromEntries(shown(r));
    expect(rows.evidence_sustainedfiring_open_lower_secs).toBe("No");
    expect(rows.evidence_sustainedfiring_last_attended_at).toBe("Nov 18, 14:30");
    expect(rows).not.toHaveProperty("evidence_sustainedfiring_firings_in_span");
  });

  it("suggests no value and never calls the alert unimportant", () => {
    const words = [adviceOf(gt, SUSTAINED), ...limitationsOf(gt, SUSTAINED)].join(" ");
    expect(words).toContain("suggests no value");
    expect(words).toContain("the share is a minimum");
    expect(words.toLowerCase()).not.toMatch(/unimportant|not important|delete|retire/);
  });
});

describe("the noise rule's quality reasons", () => {
  it("names truncated reads in words", () => {
    const r = record({
      quality: "partial",
      quality_reasons: JSON.stringify(["transitions_truncated", "responses_truncated"]),
    });
    expect(qualityReasonsOf(gt, r)).toEqual([
      "not every state change was read",
      "not every response was read",
    ]);
  });
});

describe("a noise pattern's decline", () => {
  it.each([
    ["insufficient_short_episodes", "Too few short firings to suggest a pending period"],
    ["insufficient_short_clear_gaps", "Too few short clears to suggest a recovery hold"],
    [
      "candidate_not_above_current",
      "The suggestion is not above the current setting, or removes no firing",
    ],
    [
      "silence_exceeds_cap",
      "The cooldown pauses every firing past the longest suggested wait, so none counts as short",
    ],
    ["response_signal_unusable", "Too few responses recorded in the org to read a missing one"],
  ])("names %s", (reason, text) => {
    expect(skipReasonLabel(gt, reason)).toBe(text);
  });

  it.each([
    ["insufficient_short_episodes", { required: 20, actual: 5 }, "5 of the 20 needed"],
    ["insufficient_short_clear_gaps", { required: 20, actual: 12 }, "12 of the 20 needed"],
    [
      "candidate_not_above_current",
      { current_secs: 600, candidate_secs: 300 },
      "Suggested 5 minutes, now 10 minutes",
    ],
    [
      "silence_exceeds_cap",
      { silence_secs: 3600, cap_secs: 900 },
      "Cooldown 1 hour, limit 15 minutes",
    ],
    ["response_signal_unusable", { required: 10, actual: 3 }, "3 of the 10 needed"],
    ["response_signal_unusable", { required: 10 }, "Not read; 10 needed"],
  ])("states %s's numbers", (reason, detail, text) => {
    expect(skipDetailLabel(gt, JSON.stringify(detail), reason, "en-US")).toBe(text);
  });

  it("points to Logs when a known reason's numbers are missing", () => {
    expect(skipDetailLabel(gt, "{}", "silence_exceeds_cap")).toBe("More detail in Logs");
  });
});

describe("a run's routine declines", () => {
  it("reads each line, and drops one this build cannot read", () => {
    const lines = [
      { rule_id: "noise", pattern: "short_blips", reason: "insufficient_samples", count: 12 },
      { rule_id: "failure", reason: "insufficient_history", count: 3 },
      { rule_id: "noise", reason: "window_too_short" },
      "noise",
    ];
    expect(routineSkipsOf({ omitted_routine_skips: JSON.stringify(lines) })).toEqual([
      { rule_id: "noise", pattern: "short_blips", reason: "insufficient_samples", count: 12 },
      { rule_id: "failure", reason: "insufficient_history", count: 3 },
    ]);
    expect(routineSkipsOf({ omitted_routine_skips: null })).toEqual([]);
    expect(routineSkipsOf({})).toEqual([]);
    expect(routineSkipsOf({ omitted_routine_skips: "not json" })).toEqual([]);
  });
});

describe("a noise pattern's name", () => {
  it("names each pattern of the noise rule, and no pattern another rule does not have", () => {
    const copy = dismissalCopy(gt, "en-US");
    expect(copy.findingLabel("noise", "recovery_hold")).toBe("Noise: Recovery hold");
    expect(copy.findingLabel("noise", "sustained_no_response")).toBe(
      "Noise: Sustained firing, no response",
    );
    expect(copy.findingLabel("noise", "short_blips")).toBe("Noise: Short blips");
    expect(copy.findingLabel("noise", "stream_missing")).toBe("Noise");
    expect(findingPatternKey("failure", "short_blips")).toBeUndefined();
    expect(findingPatternKey("failure", "stream_missing")).toBe(
      "alertCalibration.errorClass.streamMissing",
    );
  });
});
