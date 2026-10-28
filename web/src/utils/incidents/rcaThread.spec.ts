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
  rcaStageLabel,
  rcaThreadEntries,
  rcaThreadPlainText,
  rcaToolStatusLabel,
  rcaTriggerLabel,
  splitRcaNote,
  toolCallsDurationMs,
} from "./rcaThread";
import {
  RCA_T0,
  rcaSteerRecord,
  rcaStep,
  rcaThread,
  rcaThreadQuestion,
  rcaToolCall,
  sec,
} from "@/test/unit/fixtures/rcaThread";

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
    const cut = rcaToolCall({ status: "error", error: "Interrupted upstream", interrupted: true });

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

    it("an ended run counts the steps Resume keeps, not every closed step", () => {
      // C7: step 3 made no call and shares its message with step 4, so Resume repeats both.
      const steps = [1, 2, 3, 4].map((index) => rcaStep({ index }));
      const ended = { active: false, report_submitted: false, steps };
      expect(finishedStepCount(rcaThread(ended))).toBe(3);
      expect(finishedStepCount(rcaThread({ ...ended, reusable_steps: 2 }))).toBe(2);
      // A live thread never carries the Resume count.
      expect(finishedStepCount(rcaThread({ active: true, steps, reusable_steps: 2 }))).toBe(4);
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

  it("keeps missing timestamps last and omits absent time and key arguments from Copy thread", () => {
    const missing = rcaStep({
      index: 1,
      started_at: null,
      title: "No timestamp",
      tool_calls: [rcaToolCall({ key_arg: null })],
    });
    const dated = rcaStep({ index: 2, started_at: RCA_T0, title: "Dated step", tool_calls: [] });
    const thread = rcaThread({
      started: { at: null, prompt: "Missing start" },
      steps: [missing, dated],
    });
    expect(
      rcaThreadEntries(thread, [])
        .filter((entry) => entry.kind === "step")
        .map((entry) => entry.step.index),
    ).toEqual([2, 1]);
    const text = rcaThreadPlainText(thread, "Thread");
    expect(text).toContain("1. No timestamp\n");
    expect(text).toContain("\nAnalysis started\n");
    expect(text).not.toContain("null");
    expect(formatRcaClock(null)).toBe("");
  });

  describe("04 §10.6: one time order for steps, questions and messages", () => {
    const thread = rcaThread({
      questions: [
        rcaThreadQuestion({ at: RCA_T0 + sec(10) }),
        rcaThreadQuestion({ question_id: "q2", at: null }),
      ],
    });
    const items = [
      rcaSteerRecord({ steer_id: "late", created_at: RCA_T0 + sec(30) }),
      rcaSteerRecord({ steer_id: "early", created_at: RCA_T0 + sec(1) }),
    ];

    it("rcaThreadEntries sorts by time; a question with no time goes last", () => {
      expect(rcaThreadEntries(thread, items).map((entry) => entry.key)).toEqual([
        "steer-early",
        "step-1",
        "question-call_7f",
        "step-2",
        "steer-late",
        "question-q2",
      ]);
    });

    it("Copy thread includes the questions and responder messages in that order", () => {
      const text = rcaThreadPlainText(
        rcaThread({ questions: [rcaThreadQuestion()] }),
        "Investigation thread",
        [
          rcaSteerRecord({
            status: "applied",
            agent_note: "Checking the pool size.",
          }),
        ],
      ).split("\n");

      const steer = text.indexOf("a.rao · 08:56:40 UTC · Applied");
      const question = text.findIndex((line) => line.startsWith("Needs input: Which change"));
      expect(steer).toBeGreaterThan(
        text.indexOf("2. Map the checkout dependencies · 08:53:41 UTC"),
      );
      expect(text.slice(steer + 1, steer + 3)).toEqual([
        "We raised the orders pool to 150 on Oct 8",
        "Agent: Checking the pool size.",
      ]);
      expect(question).toBeGreaterThan(steer);
      expect(text[question]).toMatch(/· 08:57:20 UTC$/);
    });
  });
});
