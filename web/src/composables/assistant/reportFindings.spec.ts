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

import { MAX_VERDICT_CHARS, splitReportFindings } from "./reportFindings";

const fence = (body: string) => "```json\n" + body + "\n```";

describe("splitReportFindings", () => {
  it("lifts the closing verdict into Findings and keeps the narrative before it", () => {
    const report = `## Summary\nDisk filled.\n\n${fence(
      JSON.stringify({
        root_cause: "Log volume filled the disk",
        confidence: "High",
        evidence: ["df shows 100%", { description: "writes failed", query: "SELECT 1" }],
        recommendations: ["Add a retention policy"],
      }),
    )}\n`;
    const { findings, narrative } = splitReportFindings(report);
    expect(narrative).toBe("## Summary\nDisk filled.");
    expect(findings).toMatchObject({
      likelyCause: "Log volume filled the disk",
      confidence: "high",
      nextSteps: ["Add a retention policy"],
    });
    expect(findings?.evidence.map((item) => item.kind)).toEqual(["inferred", "verified"]);
  });

  it("calls a verdict without a cause inconclusive", () => {
    const { findings } = splitReportFindings(fence(JSON.stringify({ confidence: "unknown" })));
    expect(findings?.confidence).toBe("inconclusive");
  });

  it("never invents a confidence the agent did not state", () => {
    const report = `text\n${fence(JSON.stringify({ likely_cause: "x" }))}`;
    expect(splitReportFindings(report)).toEqual({ findings: null, narrative: report });
  });

  it("leaves the report whole for broken, oversized, mid-report or prototype-polluting JSON", () => {
    const broken = `a\n${fence("{nope")}`;
    expect(splitReportFindings(broken).findings).toBeNull();
    const huge = `a\n${fence(JSON.stringify({ likely_cause: "x".repeat(MAX_VERDICT_CHARS) }))}`;
    expect(splitReportFindings(huge).narrative).toBe(huge);
    const middle = `${fence(JSON.stringify({ likely_cause: "x", confidence: "low" }))}\nmore text`;
    expect(splitReportFindings(middle).findings).toBeNull();
    const polluted = fence(
      '{"__proto__": {"polluted": true}, "likely_cause": "x", "confidence": "low"}',
    );
    splitReportFindings(polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
