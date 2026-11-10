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
  coverageNoteRows,
  coverageNotes,
  countOrDash,
  coverageVerdict,
  findingsByRule,
  insightActionsOf,
  titleAfterName,
  isClean,
  isScoped,
  latestEmission,
  latestPerWindow,
  latestRun,
  limitationsOf,
  recordHits,
  runIdentity,
  parseLagRows,
  qualityReasonsOf,
  schemaVersion,
  visibilityCopy,
  type DigestRecord,
  type FindingRecord,
  type RuleId,
  type RunRow,
  type Severity,
} from "./digests";
import {
  formatEvidence,
  formatMinutes,
  skipDetailLabel,
  skipReasonLabel,
  splitMinutes,
  coverageBadge,
  SEVERITY_BADGE,
} from "./format";
import { evidenceFor, ruleLabelKey, rulesShownFor } from "./rules";

const run = (overrides: Partial<RunRow> = {}): RunRow => ({
  window_start: 100,
  window_end: 200,
  emitted_at: 300,
  finding_count: 0,
  skip_count: 0,
  alerts_in_scope: 4,
  coverage_gap: false,
  coverage_unreadable_definitions: 0,
  coverage_facts_without_definition: 0,
  coverage_definitions_without_facts: 0,
  coverage_transitions_truncated: false,
  coverage_counters_truncated: false,
  coverage_error_clusters_truncated: false,
  coverage_error_clusters_unattributed: 0,
  coverage_stream_substrate_empty: false,
  ...overrides,
});

const record = (overrides: Partial<DigestRecord> = {}): DigestRecord => {
  const { emitted_at, ...base } = run();
  return { ...base, _timestamp: emitted_at, org: "acme", config_id: "c1", ...overrides };
};

describe("a run pulled again", () => {
  it("lists once per window, as its newest emission, newest first", () => {
    const rows = latestPerWindow([
      run({ emitted_at: 300, finding_count: 2 }),
      run({ emitted_at: 500, finding_count: 3 }),
      run({ window_start: 200, window_end: 300, emitted_at: 400 }),
    ]);
    expect(rows.map((r) => [r.window_end, r.finding_count])).toEqual([
      [200, 3],
      [300, 0],
    ]);
  });

  it("reads its detail from the newest emission only, and keeps only finding records as cards", () => {
    const { run: newest, findings } = latestEmission([
      record({ _timestamp: 300, finding_count: 1, rule_id: "noise", title: "old" }),
      record({
        _timestamp: 500,
        finding_count: 1,
        rule_id: "failure",
        title: "new",
        severity: "High",
      }),
      record({ _timestamp: 500, finding_count: 1 }),
    ]);
    expect(newest?.emitted_at).toBe(500);
    expect(findings.map((f) => f.title)).toEqual(["new"]);
  });

  it("lists findings most severe first, whatever order the search returned them in", () => {
    const finding = (rule_id: RuleId, severity: Severity, alert_name: string) =>
      record({
        _timestamp: 500,
        finding_count: 3,
        rule_id,
        severity,
        alert_name,
        title: alert_name,
      });
    const { findings } = latestEmission([
      finding("no_destination", "Medium", "billing"),
      finding("notify_failed", "High", "orders"),
      finding("failure", "High", "payments"),
      finding("no_destination", "High", "disk"),
    ]);
    expect(findings.map((f) => f.alert_name)).toEqual(["payments", "disk", "orders", "billing"]);
  });

  it("has no detail when the stream holds no record for it", () => {
    expect(latestEmission([])).toEqual({ run: null, findings: [], skips: [] });
  });

  it("keeps a version-1 record without a kind as a finding, and sets a version-2 skip apart", () => {
    const { findings, skips } = latestEmission([
      record({ _timestamp: 500, rule_id: "noise", severity: "Low", title: "v1" }),
      record({
        _timestamp: 500,
        schema_version: 2,
        kind: "finding",
        rule_id: "failure",
        severity: "High",
        title: "v2",
        tier: "A",
      }),
      record({
        _timestamp: 500,
        schema_version: 2,
        kind: "skip",
        rule_id: "silent",
        alert_name: "panics",
        skip_reason: "sentinel_by_design",
      }),
      record({ _timestamp: 500, schema_version: 2, kind: "run" }),
    ]);
    expect(findings.map((f) => [f.title, schemaVersion(f)])).toEqual([
      ["v2", 2],
      ["v1", 1],
    ]);
    expect(skips.map((s) => [s.alert_name, s.skip_reason])).toEqual([
      ["panics", "sentinel_by_design"],
    ]);
  });

  it("names a finding's limitation codes in words and drops any code it does not know", () => {
    const codes = JSON.stringify(["quiet_source", "made_up", "scan_truncated"]);
    expect(limitationsOf(gt, record({ limitations: codes }))).toEqual([
      "A quiet source can be a batch or cron job that is idle by design.",
      "Wider searches timed out, so the empty answer covers less than the full 7 days.",
    ]);
    expect(limitationsOf(gt, record())).toEqual([]);
    expect(limitationsOf(gt, record({ limitations: "plain" }))).toEqual([]);
  });

  it("names the searched window from its column and never guesses one the record left out", () => {
    const searched = JSON.stringify(["searched_window", "scan_truncated"]);
    expect(
      limitationsOf(
        gt,
        record({ limitations: searched, evidence_notworking_searched_secs: 7 * 86_400 }),
      ),
    ).toEqual([
      "Searched only the last 7 days; rarer matching rows are not ruled out.",
      "Wider searches timed out, so the empty answer covers less than the full 7 days.",
    ]);
    expect(limitationsOf(gt, record({ limitations: searched }))).toEqual([
      "Wider searches timed out, so the empty answer covers less than the full 7 days.",
    ]);
  });
});

describe("a run's verdict", () => {
  it("is clean only with no finding, no gap and nothing declined", () => {
    expect(isClean(run())).toBe(true);
    expect(isClean(run({ skip_count: 1 }))).toBe(false);
    expect(isClean(run({ coverage_gap: true }))).toBe(false);
  });

  it("reads a run that measured nothing as such, even though it is also a gap", () => {
    expect(coverageVerdict(run())).toBe("full");
    expect(coverageVerdict(run({ coverage_gap: true }))).toBe("gap");
    expect(
      coverageVerdict(run({ coverage_gap: true, coverage_stream_substrate_empty: true })),
    ).toBe("none");
  });

  it("a_v2_run_hides_the_silent_group_and_explains_definition_checks", () => {
    const rows = (overrides: Partial<RunRow>) =>
      coverageNoteRows(gt, run(overrides)).map((n) => [n.text, n.gap]);
    expect(rows({ coverage_definition_checks: "unavailable" })).toEqual([
      ["Alert definition checks need AutoObserve, which is off. The other checks ran.", false],
    ]);
    expect(rows({ coverage_definition_checks: "not_yet" })).toEqual([
      [
        "AutoObserve has not checked alert definitions in the last day, so they were not judged.",
        true,
      ],
    ]);
    expect(rows({ coverage_definition_checks: "failed" })).toEqual([
      ["Alert definition checks could not be read, so they were not judged.", true],
    ]);
    expect(
      rows({ coverage_definition_checks: "checked", coverage_definition_checks_truncated: true }),
    ).toEqual([
      [
        "Alert definition check results were truncated, so alerts past the cut were not judged.",
        true,
      ],
    ]);
    expect(rows({ coverage_definition_checks: "checked" })).toEqual([]);
    expect(rows({ coverage_definition_checks: "later" as never })).toEqual([]);
    expect(rulesShownFor("default", 2)).not.toContain("silent");
    expect(rulesShownFor("default", 1)).toContain("silent");
    expect(ruleLabelKey("failure", 2)).toBe("alertCalibration.rules.notWorking");
    expect(ruleLabelKey("failure", 1)).toBe("alertCalibration.rules.failure");
    expect(ruleLabelKey("noise", 2)).toBe("alertCalibration.rules.noise");
  });

  it("explains_unassessed_error_types_once_in_amber", () => {
    const rows = (count: number | null) =>
      coverageNoteRows(gt, run({ coverage_error_classes_unassessed: count })).map((n) => [
        n.text,
        n.gap,
      ]);
    expect(rows(1)).toEqual([
      ["Error types were not read for 1 alert, so its card shows counts only.", true],
    ]);
    expect(rows(12)).toEqual([
      ["Error types were not read for 12 alerts, so their cards show counts only.", true],
    ]);
    expect(rows(0)).toEqual([]);
    expect(rows(null)).toEqual([]);
    expect(coverageNoteRows(gt, run())).toEqual([]);
    const carried = runIdentity(record({ coverage_error_classes_unassessed: 3 }));
    expect(carried.coverage_error_classes_unassessed).toBe(3);
  });

  it("names every coverage column off its default, in words", () => {
    const notes = coverageNotes(
      gt,
      run({
        coverage_definitions_without_facts: 1,
        coverage_facts_without_definition: 2,
      }),
    );
    expect(notes).toEqual([
      "2 alerts had trigger rows but no definition, usually ones deleted during the window; not counted as a gap.",
      "1 alert had no trigger rows in the window, which is not counted as a gap.",
    ]);
    expect(coverageNotes(gt, run())).toEqual([]);
  });

  it("picks the latest run by its window, not by when it was written", () => {
    const later = run({ window_end: 900, emitted_at: 1 });
    expect(latestRun([run({ emitted_at: 2 }), later])).toBe(later);
    expect(latestRun([])).toBeNull();
  });
});

describe("the dashboard grouping", () => {
  it("lists every rule, worst first, with its findings in severity order", () => {
    const f = (rule_id: RuleId, severity: Severity, alert_name: string) =>
      ({ rule_id, severity, alert_name }) as FindingRecord;
    const groups = findingsByRule(
      ["failure", "noise", "silent"],
      [f("noise", "Low", "b"), f("failure", "High", "a"), f("noise", "Medium", "c")],
    );
    expect(groups.map((g) => [g.rule_id, g.severity, g.findings.length])).toEqual([
      ["failure", "High", 1],
      ["noise", "Low", 2],
      ["silent", null, 0],
    ]);
  });
});

describe("the dashboard row", () => {
  it("drops the alert's name from the front of its title, and nothing else", () => {
    const f = (title: string, alert_name?: string) => ({ title, alert_name }) as FindingRecord;
    expect(titleAfterName(f("cpu fired 40 times", "cpu"))).toBe("fired 40 times");
    expect(titleAfterName(f("cpu-high fired 40 times", "cpu"))).toBe("-high fired 40 times");
    expect(titleAfterName(f("fired 40 times", "cpu"))).toBe("fired 40 times");
    expect(titleAfterName(f("fired 40 times"))).toBe("fired 40 times");
  });
});

describe("the formatting", () => {
  it("splits a duration into the number a tile shows large and the unit beside it", () => {
    expect(splitMinutes(gt, 43_200)).toEqual({ count: 30, unit: "days" });
    expect(splitMinutes(gt, 1440)).toEqual({ count: 1, unit: "day" });
    expect(splitMinutes(gt, 90)).toEqual({ count: 90, unit: "minutes" });
  });

  it("names a duration in its largest whole unit", () => {
    expect([15, 60, 1440, 10_080, 525_600].map((m) => formatMinutes(gt, m))).toEqual([
      "15 minutes",
      "1 hour",
      "1 day",
      "7 days",
      "1 year",
    ]);
  });

  it("shows evidence by its kind, and a dash for a value the record lacks", () => {
    expect(formatEvidence(gt, 0.371, "ratio")).toBe("37.1%");
    expect(formatEvidence(gt, 42, "seconds")).toBe("42 seconds");
    expect(formatEvidence(gt, 7200, "seconds")).toBe("2 hours");
    expect(formatEvidence(gt, undefined, "count")).toBe("—");
    expect(formatEvidence(gt, true, "boolean")).toBe("Yes");
    expect(formatEvidence(gt, false, "boolean")).toBe("No");
    expect(formatEvidence(gt, undefined, "boolean")).toBe("—");
    const micros = new Date(2026, 10, 4, 9, 30).getTime() * 1000;
    expect(formatEvidence(gt, micros, "time")).toBe("Nov 4, 09:30");
    expect(formatEvidence(gt, undefined, "time")).toBe("—");
  });
});

describe("a skip's reason", () => {
  it("is named in words, and one this build does not know is named generically", () => {
    expect(skipReasonLabel(gt, "incomplete_or_silence_censored_history")).toBe(
      "History incomplete or paused by a silence, so episode lengths are not real",
    );
    expect(skipReasonLabel(gt, "healthy_silence")).toBe(
      "Ran cleanly and never fired; quiet is not a problem by itself",
    );
    expect(skipReasonLabel(gt, "a_later_reason")).toBe("Another reason");
  });

  it("names a known signal in its detail, and any other detail generically", () => {
    expect(skipDetailLabel(gt, '{"signal":"delivery_attempts"}')).toBe(
      "Signal: Attempted deliveries",
    );
    expect(skipDetailLabel(gt, '{"signal":"delay_in_secs"}')).toBe("Signal: Evaluation delay");
    for (const other of ['{"signal":"queue_depth"}', '{"mode":"real_time"}', "[1]", "not json"]) {
      expect(skipDetailLabel(gt, other)).toBe("More detail in Logs");
    }
    expect(skipDetailLabel(gt, undefined)).toBeNull();
    expect(skipDetailLabel(gt, "")).toBeNull();
  });

  it("the_skip_list_names_headroom_instead_of_logs", () => {
    const headroom = (fields: Record<string, unknown>) =>
      JSON.stringify({
        headroom: { operator: ">=", level: "critical", lower_bound: false, valued: 720, ...fields },
      });
    expect(skipDetailLabel(gt, headroom({ value: 42, threshold: 100 }))).toBe(
      "Highest value 42 of threshold 100",
    );
    expect(skipDetailLabel(gt, headroom({ value: 0, threshold: 1 }))).toBe(
      "Highest value 0 of threshold 1",
    );
    expect(skipDetailLabel(gt, headroom({ value: 42, threshold: 80, level: "warning" }))).toBe(
      "Highest value 42 of warning threshold 80",
    );
    expect(skipDetailLabel(gt, undefined)).toBeNull();
    expect(skipDetailLabel(gt, headroom({ value: 1, threshold: 2, operator: "=" }))).toBe(
      "More detail in Logs",
    );
  });
});

describe("a cluster finding's lag lists", () => {
  it("reads each list back out of its one JSON column, keyed by org or by hour", () => {
    const orgs = JSON.stringify([
      { org_id: "globex", skipped_windows: 3, late_evaluations: 0, evaluations: 100 },
      { org_id: "acme", skipped_windows: 0, late_evaluations: 40, evaluations: 120 },
    ]);
    expect(parseLagRows(orgs, "org_id").map((r) => [r.key, r.skipped_windows])).toEqual([
      ["globex", 3],
      ["acme", 0],
    ]);
    const hours = JSON.stringify([
      {
        hour_start_micros: 3_600_000_000,
        skipped_windows: 0,
        late_evaluations: 9,
        evaluations: 50,
      },
    ]);
    expect(parseLagRows(hours, "hour_start_micros")).toEqual([
      { key: 3_600_000_000, skipped_windows: 0, late_evaluations: 9, evaluations: 50 },
    ]);
  });

  it("lists nothing for a missing or malformed column, and drops rows without a usable key", () => {
    for (const value of [undefined, "", "not json", "{}", 42]) {
      expect(parseLagRows(value, "org_id")).toEqual([]);
    }
    const rows = JSON.stringify([{ org_id: " " }, { hour_start_micros: "x" }, null, "x"]);
    expect(parseLagRows(rows, "org_id")).toEqual([]);
    expect(parseLagRows(rows, "hour_start_micros")).toEqual([]);
  });
});

describe("the rules an org is shown", () => {
  it("keeps the cluster-wide scheduler rule to the _meta org, where it runs", () => {
    expect(rulesShownFor("default")).not.toContain("scheduler_health");
    expect(rulesShownFor("_meta")).toContain("scheduler_health");
    expect(rulesShownFor("default")).toContain("noise");
  });
});

describe("a version-2 finding's typed columns", () => {
  const v2 = (overrides: Partial<DigestRecord>) =>
    record({ schema_version: 2, kind: "finding", rule_id: "failure", ...overrides });

  it("parses typed actions from a v2 record and drops an unknown type or focus", () => {
    const insight_actions = JSON.stringify([
      { type: "review_alert", alert_id: "a1", focus: "query" },
      { type: "review_alert", alert_id: "a1" },
      { type: "review_platform" },
      { type: "review_alert", alert_id: "a1", focus: "pending" },
      { type: "review_alert", focus: "query" },
      { type: "apply_suggestion", alert_id: "a1" },
      "review_platform",
      null,
    ]);
    expect(insightActionsOf(v2({ insight_actions }))).toEqual([
      { type: "review_alert", alert_id: "a1", focus: "query" },
      { type: "review_alert", alert_id: "a1" },
      { type: "review_platform" },
    ]);
    expect(insightActionsOf(v2({ insight_actions: [{ type: "review_platform" }] }))).toEqual([
      { type: "review_platform" },
    ]);
    expect(insightActionsOf(v2({ insight_actions: "not json" }))).toEqual([]);
    expect(
      insightActionsOf(v2({ insight_actions: JSON.stringify({ type: "review_platform" }) })),
    ).toEqual([]);
    expect(insightActionsOf(v2({}))).toEqual([]);
  });

  it("names the quality reason codes it knows and drops anything else", () => {
    expect(
      qualityReasonsOf(gt, v2({ quality_reasons: JSON.stringify(["scan_truncated", 3, "x"]) })),
    ).toEqual(["wider searches timed out"]);
    expect(qualityReasonsOf(gt, v2({ quality_reasons: ["scan_truncated"] }))).toEqual([
      "wider searches timed out",
    ]);
    expect(qualityReasonsOf(gt, v2({ quality_reasons: "plain" }))).toEqual([]);
    expect(qualityReasonsOf(gt, v2({}))).toEqual([]);
  });

  it("names an advice code and nothing for an unknown one", () => {
    expect(adviceOf(gt, v2({ advice: "confirm_quiet_source" }))).toBe(
      "Confirm whether this source is expected to be quiet before changing the alert.",
    );
    expect(adviceOf(gt, v2({ advice: "made_up" }))).toBeNull();
    expect(adviceOf(gt, v2({}))).toBeNull();
  });

  it("keeps a review_source action only with both of its names", () => {
    const insight_actions = JSON.stringify([
      { type: "review_source", stream_type: "logs", stream_name: "batch_logs" },
      { type: "review_source", stream_type: "logs" },
      { type: "review_source", stream_type: 1, stream_name: "x" },
    ]);
    expect(insightActionsOf(v2({ insight_actions }))).toEqual([
      { type: "review_source", stream_type: "logs", stream_name: "batch_logs" },
    ]);
  });

  it("shows a pattern's evidence for a v2 failure, and the error counts otherwise", () => {
    const columns = (r: DigestRecord) =>
      evidenceFor({ ...r, rule_id: "failure" }).map((f) => f.column);
    const quiet = v2({
      pattern: "source_inactive",
      evidence_notworking_stream: "logs/batch_logs",
      evidence_notworking_last_data_at_micros: 1_761_300_000_000_000,
      evidence_notworking_checked_at_micros: 1_762_000_000_000_000,
    });
    expect(columns(quiet)).toEqual([
      "evidence_notworking_stream",
      "evidence_notworking_last_data_at_micros",
      "evidence_notworking_checked_at_micros",
    ]);
    // A row that names no stream shows no empty Stream cell.
    const missing = v2({
      pattern: "stream_missing",
      evidence_notworking_evaluation_errors: 33,
      evidence_notworking_evaluations: 33,
      evidence_notworking_checked_at_micros: 1_762_000_000_000_000,
    });
    expect(columns(missing)).toEqual([
      "evidence_notworking_evaluation_errors",
      "evidence_notworking_evaluations",
      "evidence_notworking_checked_at_micros",
    ]);
    const empty = {
      pattern: "empty_scope",
      evidence_notworking_checked_at_micros: 1_762_000_000_000_000,
    };
    expect(columns(v2({ ...empty, evidence_notworking_searched_secs: 604_800 }))).toEqual([
      "evidence_notworking_searched_secs",
      "evidence_notworking_checked_at_micros",
    ]);
    expect(columns(v2(empty))).toEqual(["evidence_notworking_checked_at_micros"]);
    // Version 2 writes no v1 failure column, so a record with no pattern it knows shows the error rows.
    const unclassified = {
      evidence_notworking_evaluation_errors: 30,
      evidence_notworking_evaluations: 100,
      evidence_notworking_error_sample: "x",
    };
    const errorRows = [
      "evidence_notworking_evaluation_errors",
      "evidence_notworking_evaluations",
      "evidence_notworking_error_sample",
    ];
    expect(columns(v2(unclassified))).toEqual(errorRows);
    expect(columns(v2({ ...unclassified, pattern: "future" }))).toEqual(errorRows);
    expect(columns(v2({}))).toEqual([]);
    expect(columns(record({ pattern: "stream_missing" }))).toContain(
      "evidence_failure_error_ratio",
    );
  });

  it("keeps_the_v1_failure_rows_of_a_version_two_record_written_before_error_classes", () => {
    // The shape the base ENT FailureRule wrote (Evidence::Failure flattened by digest.rs), with no pattern.
    const legacy: DigestRecord = {
      _timestamp: 1_762_000_000_000_000,
      schema_version: 2,
      org: "default",
      config_id: "cfg1",
      cluster: "c1",
      window_start: 1_759_400_000_000_000,
      window_end: 1_762_000_000_000_000,
      finding_count: 1,
      skip_count: 0,
      alerts_in_scope: 4,
      coverage_gap: false,
      kind: "finding",
      rule_id: "failure",
      severity: "High",
      confidence: "High",
      title: "payment failures failed 30 of 100 evaluations: stream not found",
      alert_id: "a3",
      alert_name: "payment failures",
      scope_kind: "alert",
      scope_key: "a3",
      finding_id: "f1",
      detector_version: 1,
      quality: "usable",
      audience: "owner",
      insight_actions: JSON.stringify([{ type: "review_alert", alert_id: "a3", focus: "query" }]),
      evidence_failure_evaluation_errors: 30,
      evidence_failure_evaluations: 100,
      evidence_failure_error_ratio: 0.3,
      evidence_failure_top_error: "stream not found",
      evidence_failure_top_error_count: 25,
    } as DigestRecord;
    expect(evidenceFor({ ...legacy, rule_id: "failure" }).map((f) => f.column)).toEqual([
      "evidence_failure_evaluation_errors",
      "evidence_failure_evaluations",
      "evidence_failure_error_ratio",
      "evidence_failure_top_error",
      "evidence_failure_top_error_count",
    ]);
  });

  it("carries the run's version and definition checks out of its own records", () => {
    const { run: identity } = latestEmission([
      record({
        schema_version: 2,
        kind: "run",
        coverage_definition_checks: "not_yet",
        coverage_definition_checks_truncated: false,
      }),
    ]);
    expect(identity?.schema_version).toBe(2);
    expect(identity?.coverage_definition_checks).toBe("not_yet");
    expect(identity?.coverage_definition_checks_truncated).toBe(false);
  });
});

describe("a scoped run", () => {
  const scoped = run({ visibility: "scoped", alerts_in_scope: null });

  it("a scoped row is never clean and shows no org totals", () => {
    expect(isScoped(scoped)).toBe(true);
    expect(isClean(scoped)).toBe(false);
    expect(visibilityCopy(gt, scoped)).toEqual({
      allClear: "No findings on the alerts you can access in the latest run.",
      nothingDescription:
        "Alert calibration found nothing on the alerts you can access in this run.",
      alertsInScope: {
        count: null,
        sub: "Shown only with access to every alert",
        subIcon: "info-outline",
      },
      pending: {
        banner: "Counts on the alerts you can access are not ready yet. Refresh shortly.",
        badge: "Pending",
      },
    });

    expect(isClean(run())).toBe(true);
    expect(visibilityCopy(gt, run())).toEqual({
      allClear: "The latest run found nothing to fix.",
      nothingDescription:
        "No coverage gap and nothing declined: across 4 alerts in scope, alert calibration found nothing.",
      alertsInScope: { count: 4 },
      pending: {
        banner: "Counts on the alerts you can access are not ready yet. Refresh shortly.",
        badge: "Pending",
      },
    });

    const { emitted_at, ...columns } = scoped;
    const runRow = { ...columns, _timestamp: emitted_at, kind: "run" } as DigestRecord;
    const finding = record({
      visibility: "scoped",
      kind: "finding",
      rule_id: "noise",
      severity: "Low",
      confidence: "High",
      title: "cpu fired often",
      alert_id: "a0",
    });
    expect(recordHits([runRow, finding])).toBe(1);
    expect(latestEmission([runRow, finding]).run?.visibility).toBe("scoped");
    expect(recordHits([record({ kind: "run" }), record({ kind: "run" })])).toBe(2);
  });
});

describe("countOrDash", () => {
  it.each([
    [12345, "en-US", "12,345"],
    [12345, "de-DE", "12.345"],
    [0, "en-US", "0"],
    [null, "en-US", "—"],
    [undefined, "en-US", "—"],
  ])("%s in %s reads %s", (count, locale, shown) => {
    expect(countOrDash(count, locale)).toBe(shown);
  });
});

describe("a short-blips noise finding", () => {
  it("shows its own numbers, not the noise rows it never writes", () => {
    const blips = record({
      rule_id: "noise",
      pattern: "short_blips",
      evidence_shortblips_complete_episodes: 89,
      evidence_shortblips_would_not_alert: 51,
      evidence_shortblips_interval_secs: 120,
      evidence_shortblips_current_pending_secs: 0,
      evidence_shortblips_suggested_pending_secs: 120,
    });
    expect(evidenceFor({ ...blips, rule_id: "noise" }).map((f) => f.column)).toEqual([
      "evidence_shortblips_complete_episodes",
      "evidence_shortblips_would_not_alert",
      "evidence_shortblips_interval_secs",
      "evidence_shortblips_current_pending_secs",
      "evidence_shortblips_suggested_pending_secs",
    ]);
  });

  it("keeps the noise rows for a noise finding without the pattern", () => {
    const noisy = record({ rule_id: "noise", evidence_noise_firings: 40 });
    expect(evidenceFor({ ...noisy, rule_id: "noise" }).map((f) => f.column)).toEqual([
      "evidence_noise_firings",
      "evidence_noise_mean_time_to_normal_secs",
      "evidence_noise_incident_linkage_ratio",
    ]);
  });
});

describe("the colours a run's words take", () => {
  it("never paints full coverage green when no alert was in scope", () => {
    expect(coverageBadge(run({ alerts_in_scope: 0 })).tone).toBe("neutral");
    expect(coverageBadge(run({ alerts_in_scope: 0 })).variant).toBe("default-soft");
    expect(coverageBadge(run({ alerts_in_scope: 4 })).tone).toBe("success");
  });

  it("shows High severity in the same orange Incidents uses for High", () => {
    expect(SEVERITY_BADGE.High).toBe("orange-soft");
  });
});
