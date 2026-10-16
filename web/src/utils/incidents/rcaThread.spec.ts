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
import {
  finishedStepCount,
  formatRcaClock,
  formatRcaDuration,
  formatRcaElapsed,
  isInterruptedStep,
  RCA_STAGES,
  RCA_UNFINISHED_TOOL_ERROR,
  rcaStageLabel,
  rcaThreadPlainText,
  rcaToolStatusLabel,
  rcaTriggerLabel,
  splitRcaNote,
  toolCallsDurationMs,
} from "./rcaThread";
import { RCA_T0, rcaStep, rcaThread, rcaToolCall } from "@/test/unit/fixtures/rcaThread";

describe("rcaThread utils", () => {
  describe("formatRcaDuration (TH37)", () => {
    it.each([
      [252_000, "4m12s"],
      [300, "0.3s"],
      [12_000, "12s"],
      [123_000, "2m03s"],
      [3_900_000, "1h05m"],
      [-5, "0.0s"],
    ])("%i ms → %s", (ms, text) => {
      expect(formatRcaDuration(ms)).toBe(text);
    });

    it("formatRcaElapsed shows whole seconds under 10 s", () => {
      expect(formatRcaElapsed(7_900)).toBe("7s");
      expect(formatRcaElapsed(107_000)).toBe("1m47s");
    });
  });

  describe("stages (TH18, TH37)", () => {
    it("lists the seven stages in protocol order with their labels", () => {
      expect(RCA_STAGES.map((stage) => rcaStageLabel(stage))).toEqual([
        "Context",
        "Topology",
        "Changes",
        "Traces",
        "Log patterns",
        "Metrics",
        "Converge",
      ]);
      expect(RCA_STAGES[4]).toBe("log_patterns");
    });

    it("shows an unknown stage id as written", () => {
      expect(rcaStageLabel("custom_stage")).toBe("custom_stage");
    });
  });

  it("labels every trigger with the user's local part", () => {
    expect(rcaTriggerLabel("auto_new_incident", "system")).toBe("Auto on incident open");
    expect(rcaTriggerLabel("reanalyze", "j.okafor@acme.io")).toBe("Re-analyze by j.okafor");
    expect(rcaTriggerLabel("manual", "a.rao@acme.io")).toBe("Analysis by a.rao");
    expect(rcaTriggerLabel("oncall_page", "system")).toBe("On-call page");
    expect(rcaTriggerLabel("legacy", "system")).toBe("Earlier report");
  });

  it("splits [eN] citations out of a note (TH38)", () => {
    expect(splitRcaNote("Errors rose [e3] after [e12].")).toEqual([
      { kind: "text", text: "Errors rose " },
      { kind: "cite", id: "e3" },
      { kind: "text", text: " after " },
      { kind: "cite", id: "e12" },
      { kind: "text", text: "." },
    ]);
    expect(splitRcaNote("no citations [x1]")).toEqual([
      { kind: "text", text: "no citations [x1]" },
    ]);
  });

  describe("splitRcaNote inline markdown (F9, VE43)", () => {
    it("marks bold, italics and inline code, and keeps citations inside bold", () => {
      expect(splitRcaNote("**Pool full [e2]** then *retries* and `max_conns=100`")).toEqual([
        { kind: "text", text: "Pool full ", bold: true },
        { kind: "cite", id: "e2" },
        { kind: "text", text: " then " },
        { kind: "text", text: "retries", italic: true },
        { kind: "text", text: " and " },
        { kind: "text", text: "max_conns=100", code: true },
      ]);
      expect(splitRcaNote("_flag_ off")).toEqual([
        { kind: "text", text: "flag", italic: true },
        { kind: "text", text: " off" },
      ]);
    });

    it("a link shows as its text and URL in plain text", () => {
      expect(splitRcaNote("see [logs](https://evil.example/x) now")).toEqual([
        { kind: "text", text: "see " },
        { kind: "text", text: "logs (https://evil.example/x)" },
        { kind: "text", text: " now" },
      ]);
    });

    it("HTML stays text, and snake_case or a*b are not italics", () => {
      expect(splitRcaNote('<img src=x onerror="alert(1)"> db_pool_in_use 2*3*4')).toEqual([
        { kind: "text", text: '<img src=x onerror="alert(1)"> db_pool_in_use 2*3*4' },
      ]);
    });
  });

  it("sums tool durations, counting a running call as 0", () => {
    expect(
      toolCallsDurationMs([
        rcaToolCall({ duration_ms: 1_200 }),
        rcaToolCall({ duration_ms: null, status: "running" }),
        rcaToolCall({ duration_ms: 300 }),
      ]),
    ).toBe(1_500);
  });

  it("labels tool status OK / Error / Running", () => {
    expect(rcaToolStatusLabel(rcaToolCall({ status: "ok" }))).toBe("OK");
    expect(rcaToolStatusLabel(rcaToolCall({ status: "error" }))).toBe("Error");
    expect(rcaToolStatusLabel(rcaToolCall({ status: "running" }))).toBe("Running");
  });

  describe("finishedStepCount (TH40 E, m1)", () => {
    const cut = rcaToolCall({ status: "error", error: RCA_UNFINISHED_TOOL_ERROR });

    it("does not count a step whose tool call the run's end cut off", () => {
      const steps = [
        rcaStep({ index: 1 }),
        rcaStep({ index: 2, tool_calls: [rcaToolCall(), cut] }),
        rcaStep({ index: 3 }),
      ];
      expect(isInterruptedStep(steps[1])).toBe(true);
      expect(isInterruptedStep(steps[0])).toBe(false);
      // Step 3 is last and the cancelled run never submitted a report.
      expect(finishedStepCount(rcaThread({ active: false, report_submitted: false, steps }))).toBe(
        1,
      );
    });

    it("the projection-closed last step counts only when the report was submitted", () => {
      const steps = [rcaStep({ index: 1 }), rcaStep({ index: 2 })];
      expect(finishedStepCount(rcaThread({ active: false, report_submitted: true, steps }))).toBe(
        2,
      );
      expect(finishedStepCount(rcaThread({ active: false, report_submitted: false, steps }))).toBe(
        1,
      );
      // While live, a closed last step is done; an open one is not.
      expect(finishedStepCount(rcaThread({ active: true, steps }))).toBe(2);
      expect(
        finishedStepCount(
          rcaThread({ active: true, steps: [rcaStep(), rcaStep({ index: 2, ended_at: null })] }),
        ),
      ).toBe(1);
    });

    it("matches the projection's error text", () => {
      expect(RCA_UNFINISHED_TOOL_ERROR).toBe("The run ended before this tool call finished");
    });
  });

  it("Copy thread text has the start, step titles, notes, tool names and key args (TH38)", () => {
    const text = rcaThreadPlainText(rcaThread(), "Investigation thread");

    expect(text.split("\n")).toEqual([
      "Investigation thread",
      "",
      `Analysis started · ${formatRcaClock(RCA_T0)} UTC`,
      "Analyze incident checkout-errors (3 alerts, P1).",
      "",
      "1. Load incident context · 08:53:24 UTC",
      "Checkout errors rose at 08:52 [e3] after the deploy [e7].",
      "  - SearchSQL: SELECT count(*) FROM checkout_logs [OK · 42 rows · 1.2s]",
      "  - get_topology: service=checkout [Error · 0.3s]",
      "    upstream timeout",
      "",
      "2. Map the checkout dependencies · 08:53:41 UTC",
      "  - get_service_graph: checkout [Running]",
    ]);
  });
});
