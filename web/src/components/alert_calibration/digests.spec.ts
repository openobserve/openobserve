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
  coverageNotes,
  coverageVerdict,
  isClean,
  latestEmission,
  latestPerWindow,
  latestRun,
  parseAffectedAlerts,
  type DigestRecord,
  type RuleId,
  type RunRow,
  type Severity,
} from "./digests";
import { formatEvidence, formatMinutes } from "./format";

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
  coverage_meta_fallback_used: false,
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
    expect(latestEmission([])).toEqual({ run: null, findings: [] });
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

  it("names every coverage column off its default, in words", () => {
    const notes = coverageNotes(
      gt,
      run({
        coverage_definitions_without_facts: 1,
        coverage_facts_without_definition: 2,
        coverage_meta_fallback_used: true,
      }),
    );
    expect(notes).toEqual([
      "2 alerts had trigger rows but no definition.",
      "1 alert had no trigger rows in the window, which is not counted as a gap.",
      "Read from the triggers stream of the _meta organization, which is not counted as a gap.",
    ]);
    expect(coverageNotes(gt, run())).toEqual([]);
  });

  it("picks the latest run by its window, not by when it was written", () => {
    const later = run({ window_end: 900, emitted_at: 1 });
    expect(latestRun([run({ emitted_at: 2 }), later])).toBe(later);
    expect(latestRun([])).toBeNull();
  });
});

describe("the formatting", () => {
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
  });
});

describe("an org-wide finding's affected alerts", () => {
  it("reads the listed alerts back out of their one JSON column", () => {
    const column = JSON.stringify([
      {
        alert_id: "a2",
        alert_name: "disk",
        skipped_windows: 3,
        late_evaluations: 0,
        evaluations: 100,
      },
      {
        alert_id: "a1",
        alert_name: "cpu",
        skipped_windows: 0,
        late_evaluations: 40,
        evaluations: 100,
      },
    ]);
    expect(parseAffectedAlerts(column).map((a) => [a.alert_name, a.skipped_windows])).toEqual([
      ["disk", 3],
      ["cpu", 0],
    ]);
  });

  it("lists nothing for a missing or malformed column, and drops entries without a usable name", () => {
    for (const value of [undefined, "", "not json", "{}", 42]) {
      expect(parseAffectedAlerts(value)).toEqual([]);
    }
    expect(
      parseAffectedAlerts(JSON.stringify([{ alert_id: "a1" }, { alert_name: " " }, null, "x"])),
    ).toEqual([]);
  });
});
