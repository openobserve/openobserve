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

describe("buildIncidentReportPrompt", () => {
  it("asks about the report with the incident and the report as blocks", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      runId: "run-9",
      title: "Checkout errors",
      severity: "P1",
      report: "## Root cause\nA bad deploy.",
    });
    expect(prompt.text).toBe("Explain this incident analysis report");
    expect(prompt.chips.map((chip) => chip.kind)).toEqual(["incident", "report"]);
    expect(prompt.chips[0].ref).toMatchObject({ type: "incident", id: "inc-1", org: "default" });
    expect(prompt.chips[0].secondary).toBeUndefined();
    expect(prompt.chips[1].ref).toMatchObject({ type: "incident_report", id: "run-9" });
    expect(String(prompt.title)).toContain("Checkout errors");
  });

  it("asks about the incident alone when it has no report", () => {
    const prompt = buildIncidentReportPrompt({ org: "default", incidentId: "inc-1", title: "x" });
    expect(prompt.text).toBe("Explain this incident");
    expect(prompt.chips.map((chip) => chip.kind)).toEqual(["incident"]);
  });

  it("cuts a long report to the cap", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      runId: "run-9",
      title: "x",
      report: "a".repeat(MAX_REPORT_CHARS + 10),
    });
    expect((prompt.chips[1].data as { report: string }).report).toHaveLength(MAX_REPORT_CHARS);
  });

  it("leads with the Time chip of the incident window and labels the attached version", () => {
    const prompt = buildIncidentReportPrompt({
      org: "default",
      incidentId: "inc-1",
      runId: "run-9",
      title: "x",
      report: "## Cause",
      reportLabel: raw("Run 1 · Oct 16, 14:09 UTC · 8 B"),
      window: { from: 1_000_000, to: 2_000_000 },
    });
    expect(prompt.chips.map((chip) => chip.kind)).toEqual(["time", "incident", "report"]);
    expect(String(prompt.chips[2].label)).toBe("Run 1 · Oct 16, 14:09 UTC · 8 B");
  });

  it("keys the Report chip by run, so two runs of one incident are two chips", () => {
    const base = { org: "default", incidentId: "inc-1", title: "x", report: "## Cause" };
    const first = buildIncidentReportPrompt({ ...base, runId: "run-1" });
    const second = buildIncidentReportPrompt({ ...base, runId: "run-2" });
    expect(first.chips[0].id).toBe(second.chips[0].id);
    expect(first.chips[1].id).not.toBe(second.chips[1].id);
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
