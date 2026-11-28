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

import { raw } from "@/types/i18n";
import { describe, expect, it } from "vitest";

import {
  INJECTION,
  RANGE,
  RANGE_TEXT,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import {
  MAX_REPORT_CHARS,
  alertInputOf,
  buildAlertFiringPrompt,
  buildAlertPrompt,
  buildIncidentReportPrompt,
  thresholdText,
  type AlertFiringInput,
  type AlertInput,
} from "./alerts";
import { MAX_ASK_CHARS, buildAutoObserveAskPrompt } from "./autoobserve";

describe("buildAlertPrompt", () => {
  const input = (over: Partial<AlertInput> = {}): AlertInput => ({
    org: "default",
    alertId: "a1",
    name: "Checkout 5xx",
    stream: "default",
    condition: "SELECT count(*) AS c FROM default WHERE code >= 500",
    threshold: { op: ">", value: 50, unit: "events" },
    periodMinutes: 10,
    lastFiredAt: Date.UTC(2026, 9, 14, 13, 50, 0),
    destinations: 2,
    timeZone: "UTC",
    ...over,
  });

  it("pins the Troubleshoot wording; destinations are a count, never a URL", () => {
    const build = buildAlertPrompt(input(), "troubleshoot");
    expect(build.text).toBe(
      "Troubleshoot the alert in the attached Alert block: threshold > 50 events for 10 minutes, last fired 2026-10-14 13:50:00 UTC, destinations: 2. The block holds its name, stream and condition. Why did it fire and is the threshold right?",
    );
    expect(build.text).not.toMatch(/https?:/);
    expectPromptRules(build);
  });

  it("carries name, stream and condition in a serialised Alert chip (F3)", () => {
    const build = buildAlertPrompt(input(), "explain");
    expect(build.text).toMatch(/What does it watch, and is it set up to catch what matters\?$/);
    expect(build.chips[0]).toMatchObject({
      kind: "alert",
      label: "Alert · Checkout 5xx",
      sent: "serialized",
      ref: { type: "alert", id: "a1" },
      data: { name: "Checkout 5xx", stream: "default", condition: input().condition },
    });
    expect(build.title).toBe("Alert · Checkout 5xx");
  });

  it("says (unsaved) for an alert being created and labels it a new alert", () => {
    const build = buildAlertPrompt(input({ alertId: undefined, name: "" }), "explain");
    expect(build.text).toContain("in the attached Alert block (unsaved)");
    expect(build.chips[0].label).toBe("Alert · new alert");
  });

  it("omits absent facts and drops an unknown operator", () => {
    const build = buildAlertPrompt(
      { org: "default", alertId: "a1", name: "X", timeZone: "UTC" },
      "troubleshoot",
    );
    expect(build.text).toBe(
      "Troubleshoot the alert in the attached Alert block. The block holds its name, stream and condition. Why did it fire and is the threshold right?",
    );
    expect(thresholdText({ op: "Contains", value: 1 })).toBeNull();
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildAlertPrompt(
      input({
        name: INJECTION,
        stream: INJECTION,
        condition: INJECTION,
        threshold: { op: INJECTION, value: 1, unit: INJECTION },
      }),
      "troubleshoot",
    );
    expectNoInjection(build);
  });

  it("maps a server alert, with the period in minutes and only the destination count", () => {
    expect(
      alertInputOf(
        {
          alert_id: "a1",
          name: "n",
          trigger_condition: { period: 5, operator: ">", threshold: 3 },
          destination: ["https://hooks.example/x"],
        },
        { org: "o", timeZone: "UTC" },
      ),
    ).toMatchObject({ alertId: "a1", periodMinutes: 5, destinations: 1 });
  });
});

describe("buildAlertFiringPrompt", () => {
  const input = (over: Partial<AlertFiringInput> = {}): AlertFiringInput => ({
    org: "default",
    alertId: "a1",
    name: "Checkout 5xx",
    firedAt: Date.UTC(2026, 9, 14, 13, 57, 0),
    observed: { value: 73, unit: "events" },
    threshold: { op: ">", value: 50, unit: "events" },
    window: RANGE,
    stream: "default",
    query: "SELECT count(*) FROM default WHERE code >= 500",
    timeZone: "UTC",
    ...over,
  });

  it("pins the wording: observed value with unit, threshold and window; name, stream and query in the chip", () => {
    const build = buildAlertFiringPrompt(input());
    expect(build.text).toBe(
      `The alert in the attached Alert block fired at 2026-10-14 13:57:00 UTC: observed 73 events against threshold > 50 events over the evaluated window ${RANGE_TEXT}. The block holds its name, stream and query. Why did it fire and what changed?`,
    );
    expect(build.chips[0].data).toEqual({
      name: "Checkout 5xx",
      stream: "default",
      condition: input().query,
    });
    expectPromptRules(build);
  });

  it("chips one firing as `Alert · {name} · fired {HH:mm}` and titles the thread by time", () => {
    const build = buildAlertFiringPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "alert",
      label: "Alert · Checkout 5xx · fired 13:57",
      ref: { type: "alert_firing" },
    });
    expect(build.title).toBe("Alert · Checkout 5xx · 13:57");
  });

  it("omits what the row does not know", () => {
    const build = buildAlertFiringPrompt(
      input({
        observed: undefined,
        threshold: undefined,
        window: undefined,
        stream: undefined,
        query: "",
      }),
    );
    expect(build.text).toBe(
      "The alert in the attached Alert block fired at 2026-10-14 13:57:00 UTC. The block holds its name, stream and query. Why did it fire and what changed?",
    );
  });

  it("gives two firings of one alert two chips", () => {
    const a = buildAlertFiringPrompt(input()).chips[0].id;
    const b = buildAlertFiringPrompt(input({ firedAt: Date.UTC(2026, 9, 14, 14, 0, 0) })).chips[0]
      .id;
    expect(a).not.toBe(b);
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(
      buildAlertFiringPrompt(
        input({
          name: INJECTION,
          stream: INJECTION,
          query: INJECTION,
          observed: { value: 1, unit: INJECTION },
        }),
      ),
    );
  });
});

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
