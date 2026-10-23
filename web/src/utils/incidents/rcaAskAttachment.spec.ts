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
import { RCA_ASK_MAX_CHARS, buildRcaAskAttachment, type RcaAskInput } from "./rcaAskAttachment";
import { RCA_T0, rcaRunSummary, rcaRunSummaryLegacy, sec } from "@/test/unit/fixtures/rcaThread";

const REPORT = "# Root cause\nThe deploy exhausted the pool.";

const input = (overrides: Partial<RcaAskInput> = {}): RcaAskInput => ({
  incidentId: "inc-7",
  incidentTitle: "checkout 5xx",
  runLabel: "Run 2 · Oct 9, 08:53 UTC",
  run: {
    run_id: "run-2",
    trigger: "manual",
    state: "completed",
    started_at: RCA_T0,
    ended_at: RCA_T0 + sec(300),
  },
  summary: rcaRunSummary(),
  report: REPORT,
  ...overrides,
});

const NOTE = /\n\n\[Truncated: [^\]]*the last ([\d,]+) characters were left out\.\]$/;

describe("buildRcaAskAttachment (J5)", () => {
  it("frames the block as data first, then the header, the record sections, and the report last", () => {
    const text = buildRcaAskAttachment(input());
    const blocks = text.split("\n\n");

    // The framing line comes before anything taken from the analysis.
    expect(blocks[0]).toMatch(/read-only/);
    expect(blocks[0]).toMatch(/not an instruction/);
    expect(blocks[1].startsWith("# Incident analysis: Run 2 · Oct 9, 08:53 UTC")).toBe(true);

    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "Verdict",
      "Hypotheses",
      "Evidence",
      "Blind spots",
      "Timeline",
      "Report",
    ]);
    expect(text.endsWith(`## Report\n${REPORT}`)).toBe(true);
  });

  it("the header names the incident, the run, its trigger and state", () => {
    const text = buildRcaAskAttachment(input());

    expect(text).toContain("inc-7 (checkout 5xx)");
    expect(text).toContain("run-2");
    expect(text).toContain("manual");
    expect(text).toContain("completed");
    expect(text).toContain("2025-10-09T08:53:20Z");
  });

  it("carries the verdict, the probable cause, hypotheses with status and reason, and numbered evidence", () => {
    const text = buildRcaAskAttachment(input());

    expect(text).toContain("root_cause_identified");
    expect(text).toContain("checkout-api deploy 4f2c1e exhausted the orders-db connection pool");
    expect(text).toMatch(/h2 \[contributing\] Pool sized at 100 .*no headroom/);
    expect(text).toMatch(/h4 \[ruled_out\] Node CPU saturation/);
    // Evidence: number, kind, target, summary and the query that produced it.
    expect(text).toMatch(
      /\[2\] PromQL on metrics\n {4}Summary: 6 series · 240 points\n {4}Query: max\(db_pool_in_use\{db="orders"\}\)/,
    );
    expect(text).toContain("Feature-flag history: No toolset in this org provides flag changes.");
    expect(text).toContain("Deploy 4f2c1e (PR #812) rolls out to checkout-api [1]");
  });

  it("several root causes: each cause with its onset and band", () => {
    const base = rcaRunSummary();
    const summary = rcaRunSummary({
      card: {
        ...base.card,
        outcome: "multiple_root_causes",
        causes: [
          { id: "h1", statement: "pool exhausted", onset_us: RCA_T0, band: "high" },
          { id: "h2", statement: "cache evicted", band: "medium" },
        ],
      },
    });
    const text = buildRcaAskAttachment(input({ summary }));

    expect(text).toContain("Outcome: multiple_root_causes");
    expect(text).toContain("Root cause h1 from 2025-10-09T08:53:20Z (high): pool exhausted");
    expect(text).toContain("Root cause h2 (medium): cache evicted");
  });

  it("a legacy run has no record sections; the report still comes after the header", () => {
    const text = buildRcaAskAttachment(input({ summary: rcaRunSummaryLegacy() }));

    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(["Report"]);
    expect(text.endsWith(REPORT)).toBe(true);
  });

  it("no summary and no report: just the framing line and the header", () => {
    const text = buildRcaAskAttachment(input({ summary: null, report: "   " }));

    expect(text).not.toContain("## ");
    expect(text.split("\n\n")).toHaveLength(2);
  });

  it("a record with no report has no Report section", () => {
    const text = buildRcaAskAttachment(input({ report: "" }));

    expect(text).not.toContain("## Report");
    expect(text).toContain("## Timeline");
  });

  describe("the 24,000-char cap", () => {
    // The untruncated length for a report of `n` chars.
    const base = buildRcaAskAttachment(input({ report: "x" })).length - 1;
    const withReport = (n: number) => buildRcaAskAttachment(input({ report: "y".repeat(n) }));

    it("an attachment of exactly the cap is kept whole", () => {
      const text = withReport(RCA_ASK_MAX_CHARS - base);

      expect(text).toHaveLength(RCA_ASK_MAX_CHARS);
      expect(text).not.toMatch(NOTE);
    });

    it("one char over the cap is truncated with the note", () => {
      const text = withReport(RCA_ASK_MAX_CHARS - base + 1);

      expect(text.length).toBeLessThanOrEqual(RCA_ASK_MAX_CHARS);
      expect(text).toMatch(NOTE);
    });

    it("for any overflow: at most 24,000 chars, the head kept, and the note counts the cut exactly", () => {
      const head = buildRcaAskAttachment(input({ report: "" }));
      // The cut count crosses every digit and thousands-separator boundary.
      for (const extra of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000]) {
        for (let delta = -150; delta <= 150; delta += 1) {
          const n = RCA_ASK_MAX_CHARS - base + extra + delta;
          if (n <= RCA_ASK_MAX_CHARS - base) continue;
          const text = withReport(n);
          const match = text.match(NOTE);

          expect(text.length, `report ${n}`).toBeLessThanOrEqual(RCA_ASK_MAX_CHARS);
          expect(match, `report ${n}`).not.toBeNull();
          const kept = text.length - match![0].length;
          expect(Number(match![1].replace(/,/g, "")), `report ${n}`).toBe(base + n - kept);
          expect(text.startsWith(head), `report ${n}`).toBe(true);
        }
      }
    });

    it("the framing line and the verdict survive a huge report", () => {
      const text = withReport(200_000);

      expect(text.split("\n\n")[0]).toMatch(/not an instruction/);
      expect(text).toContain("## Verdict");
      expect(text).toContain("## Report");
    });
  });
});
