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
import en from "@/locales/languages/en-US.json";
import i18n from "@/locales";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { FindingRecord } from "./digests";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import { decisionCopy } from "@/components/autoobserve/insight/insightCopy";
import {
  dismissalCopy,
  dismissBodyOf,
  dismissableOf,
  dismissedSinceRun,
  DISMISS_REASONS,
  DURATION_OPTIONS,
  FINDING_PATTERN_LABEL,
  isDismissable,
  openCount,
  REASON_LABEL,
  type DismissableFinding,
  type DismissalView,
} from "./dismissals";

const ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";

const finding = (overrides: Partial<FindingRecord> = {}): FindingRecord =>
  ({
    _timestamp: 1,
    org: "demo-org",
    config_id: "c1",
    window_start: 0,
    window_end: 1,
    finding_count: 1,
    skip_count: 0,
    alerts_in_scope: 3,
    coverage_gap: false,
    schema_version: 2,
    kind: "finding",
    rule_id: "noise",
    severity: "Medium",
    confidence: "High",
    title: "ops_cpu fires too often",
    alert_id: "a1",
    alert_name: "ops_cpu",
    finding_id: ID,
    scope_kind: "alert",
    scope_key: "a1",
    ...overrides,
  }) as FindingRecord;

const view = (overrides: Partial<DismissalView> = {}): DismissalView => ({
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
  duration_days: 90,
  expires_at: new Date(2027, 1, 3).getTime() * 1000,
  reopened_at: null,
  reopened_by: null,
  updated_at: 1,
  alert_name: "ops_cpu",
  ...overrides,
});

const t = i18n.global.t as unknown as TranslateFn;
const copy = dismissalCopy(t, "en-US");

const resolves = (key: string) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);

describe("dismissals", () => {
  it("only_v2_per_alert_findings_are_dismissable", () => {
    expect(isDismissable(finding())).toBe(true);
    expect(isDismissable(finding({ schema_version: undefined, finding_id: undefined }))).toBe(
      false,
    );
    expect(isDismissable(finding({ rule_id: "scheduler_health" }))).toBe(false);
    expect(isDismissable(finding({ scope_kind: "cluster" }))).toBe(false);
    expect(isDismissable(finding({ rule_id: "made_up" as FindingRecord["rule_id"] }))).toBe(false);
    expect(isDismissable(finding({ finding_id: ID.slice(1) }))).toBe(false);
  });

  it("the_body_carries_the_records_own_identity_and_one_duration_mode", () => {
    const failure = finding({
      rule_id: "failure",
      pattern: "stream_missing",
    }) as DismissableFinding;
    expect(dismissBodyOf(failure, { reason: "other", note: "  x  ", duration: "90" })).toEqual({
      rule_id: "failure",
      pattern: "stream_missing",
      scope_kind: "alert",
      scope_key: "a1",
      reason: "other",
      note: "x",
      duration_days: 90,
    });
    const forever = dismissBodyOf(failure, {
      reason: "other",
      note: "x",
      duration: "until_reopened",
    });
    expect(forever.until_reopened).toBe(true);
    expect("duration_days" in forever).toBe(false);
    const noNote = dismissBodyOf(finding() as DismissableFinding, {
      reason: "expected",
      note: "",
      duration: "30",
    });
    expect("note" in noNote).toBe(false);
    expect("pattern" in noNote).toBe(false);
  });

  it("write_errors_map_by_status_and_never_show_server_text", () => {
    const statuses = [403, 404, 409, 429, 500, 400, undefined];
    // Every failure carries server text, as P4's error bodies do.
    const errors = statuses.map((status) =>
      Object.assign(new Error("Alert not found."), {
        response: status
          ? { status, data: { code: status, message: "Alert not found." } }
          : undefined,
      }),
    );
    const notices = errors.map((error) => copy.writeError(error));
    expect(notices.map((n) => n.variant)).toEqual([
      "error",
      "error",
      "warning",
      "error",
      "error",
      "error",
      "error",
    ]);
    expect(notices.map((n) => n.text)).toEqual([
      t("alertCalibration.dismiss.error.denied"),
      t("alertCalibration.dismiss.error.gone"),
      t("alertCalibration.dismiss.error.changed"),
      t("alertCalibration.dismiss.error.throttled"),
      t("alertCalibration.dismiss.error.failed"),
      t("alertCalibration.dismiss.error.failed"),
      t("alertCalibration.dismiss.error.failed"),
    ]);
    for (const notice of notices) expect(notice.text).not.toContain("Alert not found.");
    const reopens = errors.map((error) => copy.reopenResult(error));
    for (const result of reopens) expect(result.text).not.toContain("Alert not found.");
    expect(reopens.map((r) => r.variant)).toEqual([
      "error",
      "error",
      "warning",
      "error",
      "error",
      "error",
      "error",
    ]);
    expect(reopens.map((r) => r.refetch)).toEqual([false, true, true, false, false, false, false]);
  });

  it("open_count_subtracts_only_findings_dismissed_since_the_run", () => {
    const records = ["f1", "f2", "f3"].map((id) => finding({ finding_id: id }));
    const active = new Set(["f1", "f9"]);
    expect(openCount({ finding_count: 3 }, records, active)).toBe(2);
    expect(dismissedSinceRun(records, active)).toBe(1);
    expect(openCount({ finding_count: null }, records, active)).toBeNull();
    expect(openCount({ finding_count: 0 }, [], new Set(["f9"]))).toBe(0);
    expect(openCount({ finding_count: 0 }, records, active)).toBe(0);
  });

  it("every_dismissal_label_exists_in_en_us", () => {
    const used = new Set<string>();
    const recording = ((key: string) => {
      used.add(key);
      return key as I18nText;
    }) as unknown as TranslateFn;
    const rec = dismissalCopy(recording, "en-US");
    for (const status of [403, 404, 409, 429, 500]) {
      rec.writeError({ response: { status } });
      rec.reopenResult({ response: { status } });
    }
    rec.findingLabel("failure", "stream_missing");
    rec.findingLabel("failure", "ignored_matcher");
    rec.findingLabel("made_up", null);
    for (const reason of [...DISMISS_REASONS, "made_up"]) rec.reasonLabel(reason);
    for (const duration of DURATION_OPTIONS) {
      rec.durationLabel(duration);
      rec.endsLine(duration, Date.now());
    }
    rec.until(view());
    rec.until(view({ expires_at: null }));
    rec.saved(view());
    rec.saved(view({ expires_at: null }));
    rec.title("ops_cpu");
    rec.title(null);
    for (const duration of DURATION_OPTIONS) rec.scopeLine("Demo", duration, Date.now());
    rec.savedWithUndo(view(), "ops_cpu");
    rec.savedWithUndo(view({ expires_at: null }), null);
    rec.undo();
    rec.button();
    rec.filterDismissed(3);
    rec.filterDismissed(null);
    rec.allOpenDismissed(2);
    rec.ruleAllDismissed(2);
    rec.capped(1000, 1234);
    rec.alertName(view());
    rec.alertName(view({ alert_name: null }));
    rec.byAgo(view());
    rec.reopened();
    for (const key of Object.values(REASON_LABEL)) used.add(key);
    for (const key of Object.values(FINDING_PATTERN_LABEL)) used.add(key);

    const missing = [...used].filter((key) => typeof resolves(key) !== "string");
    expect(missing).toEqual([]);
    expect(DISMISS_REASONS.filter((reason) => !(reason in REASON_LABEL))).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it("fold_parts_join_actor_reason_and_until", () => {
    expect(copy.foldParts(view())).toEqual([
      "Dismissed by u-ops@example.com",
      "Will fix later",
      "Hidden until Feb 3, 2027",
    ]);
    expect(
      copy.foldParts(view({ reason: "made_up" as never, duration_days: null, expires_at: null })),
    ).toEqual(["Dismissed by u-ops@example.com", "Another reason", "Hidden until undone"]);
  });

  it("one_decision_reads_the_same_in_both_lists_and_a_mark_says_it_is_a_mark", () => {
    const decided = decisionCopy(i18n.global.t as unknown as TranslateFn, "en-US");
    const sameDecision: [string, string][] = [
      ["not_useful", "not_needed"],
      ["known_issue", "will_fix_later"],
      ["false_positive", "false_positive"],
      ["planned_work", "planned_work"],
      ["intended_report", "intended_report"],
      ["expected", "expected"],
      ["other", "other"],
      ["made_up", "made_up"],
    ];
    for (const [stored, route] of sameDecision) {
      expect([stored, String(copy.reasonLabel(stored))]).toEqual([
        stored,
        String(decided.recordReason(route)),
      ]);
    }
    expect(copy.reasonLabel("planned_work")).toBe("Planned work");
    expect(copy.reasonLabel("intended_report")).toBe("Marked as intended report");
    const mark = view({ reason: "intended_report", duration_days: null, expires_at: null });
    expect(copy.foldParts(mark)).toEqual([
      "Marked as intended report by u-ops@example.com",
      "Hidden until undone",
    ]);
    expect(copy.badge(mark)).toBe("Intended report");
    expect(copy.badge(view())).toBe("Dismissed");
  });
});

describe("dismissableOf: a rail item of a calibration finding (test 9)", () => {
  const item = (
    evidence: Record<string, unknown> = {},
    over: Partial<AutoObserveSuggestion> = {},
  ): AutoObserveSuggestion => ({
    id: ID,
    org: "demo-org",
    analyzer: "alert_calibration",
    kind: "alert_not_working",
    subject: { kind: "alert", key_dims: { entity_id: "a2" } },
    evidence: {
      alert_name: "payments-latency",
      pattern: "field_missing",
      rule_id: "failure",
      finding_id: ID,
      ...evidence,
    },
    score: null,
    confidence: "suggestive",
    status: "proposed",
    decided_score: null,
    on_accept: null,
    ...over,
  });

  it("scopes the dismissal to the alert the item names, not to the item id (M-K)", () => {
    const target = dismissableOf(item());
    expect(target).toEqual({
      finding_id: ID,
      rule_id: "failure",
      pattern: "field_missing",
      scope_kind: "alert",
      scope_key: "a2",
      alert_name: "payments-latency",
    });
    expect(
      dismissBodyOf(target as NonNullable<typeof target>, {
        reason: "known_issue",
        note: "",
        duration: "30",
      }),
    ).toEqual({
      rule_id: "failure",
      pattern: "field_missing",
      scope_kind: "alert",
      scope_key: "a2",
      reason: "known_issue",
      duration_days: 30,
    });
  });

  it("refuses what the server would refuse, and AutoObserve's own rows", () => {
    expect(dismissableOf(item({ finding_id: "0b87270549" }))).toBeNull();
    expect(dismissableOf(item({ finding_id: undefined }))).toBeNull();
    expect(dismissableOf(item({ rule_id: "scheduler_health" }))).toBeNull();
    expect(dismissableOf(item({ rule_id: "made_up" }))).toBeNull();
    expect(dismissableOf(item({}, { subject: { kind: "alert", key_dims: {} } }))).toBeNull();
    expect(dismissableOf(item({}, { kind: "blind_guardrail" }))).toBeNull();
  });

  it("leaves out a pattern or name it does not have", () => {
    expect(dismissableOf(item({ pattern: undefined, alert_name: "" }))).toEqual({
      finding_id: ID,
      rule_id: "failure",
      scope_kind: "alert",
      scope_key: "a2",
    });
  });
});
