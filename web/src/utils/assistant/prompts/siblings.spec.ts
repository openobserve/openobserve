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

import { buildAutoObserveAskPrompt, MAX_ASK_CHARS } from "./autoobserve";
import { buildIncidentReportPrompt, MAX_REPORT_CHARS } from "./incident";
import { raw } from "@/types/i18n";
import { buildOnCallVerdictPrompt, MAX_VERDICT_CHARS } from "./oncall";

describe("buildIncidentReportPrompt", () => {
  it("asks about the report with the incident and the report as blocks", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      title: "Checkout errors",
      severity: "P1",
      report: "## Root cause\nA bad deploy.",
    });
    expect(prompt.text).toBe("Explain this incident analysis report");
    expect(prompt.chips.map((chip) => chip.kind)).toEqual(["incident", "report"]);
    expect(prompt.chips[0].ref).toMatchObject({ type: "incident", id: "inc-1", org: "default" });
    expect(String(prompt.chips[0].secondary)).toContain("Interactive incident mode");
    expect(String(prompt.title)).toContain("Checkout errors");
  });

  it("cuts a long report to the cap", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      title: "x",
      report: "a".repeat(MAX_REPORT_CHARS + 10),
    });
    expect((prompt.chips[1].data as { report: string }).report).toHaveLength(MAX_REPORT_CHARS);
  });

  it("leads with the Time chip of the incident window and labels the attached version", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      title: "x",
      report: "## Cause",
      reportLabel: raw("Report 1 · 02:14 · 8 B"),
      window: { from: 1_000_000, to: 2_000_000 },
    });
    expect(prompt.chips.map((chip) => chip.kind)).toEqual(["time", "incident", "report"]);
    expect(String(prompt.chips[2].label)).toBe("Report 1 · 02:14 · 8 B");
  });
});

describe("buildOnCallVerdictPrompt", () => {
  it("sends the verdict and asks what to do next", () => {
    const prompt = buildOnCallVerdictPrompt({
      org: "default",
      id: "r1",
      name: "Payments down",
      verdict: "Likely the database failover.",
    });
    expect(prompt.text).toContain("what to do next");
    expect(prompt.chips).toHaveLength(1);
    expect(prompt.chips[0].ref).toMatchObject({ type: "oncall_verdict", id: "r1" });
    expect(
      (
        buildOnCallVerdictPrompt({
          org: "o",
          id: "r",
          name: "n",
          verdict: "v".repeat(MAX_VERDICT_CHARS + 1),
        }).chips[0].data as { verdict: string }
      ).verdict,
    ).toHaveLength(MAX_VERDICT_CHARS);
  });
});

describe("buildAutoObserveAskPrompt", () => {
  it("sends the ask and asks for a recommendation", () => {
    const prompt = buildAutoObserveAskPrompt({
      org: "default",
      id: "ask-1",
      title: "Retune the alert",
      body: "b".repeat(MAX_ASK_CHARS + 3),
    });
    expect(prompt.text).toContain("recommend");
    expect(prompt.chips[0].ref).toMatchObject({ type: "autoobserve_ask", id: "ask-1" });
    expect((prompt.chips[0].data as { body: string }).body).toHaveLength(MAX_ASK_CHARS);
  });
});
