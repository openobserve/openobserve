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

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import {
  boundedFindings,
  boundedResult,
  boundedRow,
  chipOpenQuery,
  claimNumbers,
  fenceQuery,
  footerUsage,
  manualRouteOf,
  promptRange,
  queryCount,
  stepsOf,
  toolLinksOf,
  turnAnnotationKey,
  windowsOf,
} from "./evidence";

const US = 1000;
const FROM = 1_760_000_000_000;
const TO = 1_760_000_900_000;
const SQL = 'SELECT service_name, count(*) FROM "default" GROUP BY service_name';

const answer = (blocks: ContentBlock[]): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: blocks,
});

// The `complete` harness turn: list, schema, query, as the typed reducer leaves them.
const steps: ContentBlock[] = [
  {
    type: "tool_call",
    tool: "StreamList",
    call_id: "call_1",
    stepState: "done",
    summary: "Found 3 log streams" as any,
  },
  {
    type: "tool_call",
    tool: "StreamSchema",
    call_id: "call_2",
    stepState: "done",
    context: { stream_name: "default" },
    summary: "11 fields" as any,
  },
  {
    type: "tool_call",
    tool: "SearchSQL",
    call_id: "call_3",
    stepState: "done",
    context: { stream_name: "default", sql: SQL },
    callArgs: {
      stream_name: "default",
      stream_type: "logs",
      sql: SQL,
      start_time: FROM * US,
      end_time: TO * US,
    },
    summary: { count: 4, took: 380 } as any,
    result: { hits: [{ service_name: "checkout" }], total: 4 },
  },
];

describe("stepsOf", () => {
  it("reads kind, target, counts, range and duration from structured fields", () => {
    const facts = stepsOf(answer(steps), "acme");
    expect(facts.map((step) => [step.kind, step.target, step.count, step.rows])).toEqual([
      ["stream_list", null, 3, null],
      ["schema", "default", 11, null],
      ["query", "default", null, 4],
    ]);
    expect(facts[2]).toMatchObject({
      n: 3,
      range: { from: FROM, to: TO },
      tookMs: 380,
      query: { language: "sql", text: SQL, stream: "default", streamType: "logs", org: "acme" },
    });
  });

  it("never shows a step without its result as done; a stored one reads interrupted", () => {
    const facts = stepsOf(answer([{ type: "tool_call", tool: "SearchSQL", call_id: "c" }]), "acme");
    expect(facts[0].state).toBe("interrupted");
  });

  it("keeps a policy refusal out of the trail; it renders as its notice", () => {
    const facts = stepsOf(
      answer([
        {
          type: "tool_call",
          tool: "o2_UpdateAlert",
          stepState: "failed",
          errorType: "permission_denied_tool",
        },
      ]),
      "acme",
    );
    expect(facts).toEqual([]);
  });

  it("prefers a typed query frame over the call arguments", () => {
    const facts = stepsOf(
      answer([{ ...steps[2], query: { language: "sql", text: "SELECT 2", stream: "other" } }]),
      "acme",
    );
    expect(facts[0].query).toMatchObject({ text: "SELECT 2", stream: "other" });
  });
});

describe("windowsOf / queryCount", () => {
  it("lists each evaluated range once and counts the queries that ran", () => {
    const facts = stepsOf(answer([...steps, { ...steps[2], call_id: "call_4" }]), "acme");
    expect(windowsOf(facts)).toHaveLength(1);
    expect(queryCount(facts)).toBe(2);
  });
});

describe("fenceQuery", () => {
  const facts = stepsOf(answer(steps), "acme");

  it("links an exact match to its step and takes the step's range", () => {
    expect(fenceQuery(SQL, "sql", facts, "acme", null)).toMatchObject({
      rangeSource: "step",
      sourceStep: { callId: "call_3" },
      query: { stream: "default", from: FROM, to: TO },
    });
  });

  it("takes the turn's window on the same stream without claiming the step", () => {
    const fence = fenceQuery('SELECT * FROM "default" LIMIT 5', "sql", facts, "acme", null);
    expect(fence).toMatchObject({ rangeSource: "turn", sourceStep: null, query: { from: FROM } });
  });

  it("falls back to the page's range for a fence no step explains", () => {
    const page = { from: 1, to: 2 };
    expect(fenceQuery("up", "promql", facts, "acme", page)).toMatchObject({
      rangeSource: "page",
      query: { language: "promql", streamType: "metrics", from: 1, to: 2 },
    });
  });

  it("is not a query for other languages", () => {
    expect(fenceQuery("ls", "bash", facts, "acme", null)).toBeNull();
  });
});

describe("claimNumbers", () => {
  it("numbers by distinct call_id in order of first citation", () => {
    expect([...claimNumbers(["call_3", "call_1", "call_3"])]).toEqual([
      ["call_3", 1],
      ["call_1", 2],
    ]);
  });
});

describe("bounded payloads (untrusted data is capped)", () => {
  it("keeps 10 hit rows of 20 columns and 500 characters", () => {
    const hits = Array.from({ length: 30 }, () =>
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, "x".repeat(900)])),
    );
    const result = boundedResult({ hits, total: 2341, took: 12 })!;
    expect(result.hits).toHaveLength(10);
    expect(Object.keys(result.hits![0])).toHaveLength(20);
    expect(result.hits![0].f0).toHaveLength(500);
    expect(result).toMatchObject({ total: 2341, took: 12 });
  });

  it("serialises objects in a row as text, never as markup", () => {
    expect(boundedRow({ a: { b: "<img>" }, n: 3 })).toEqual({ a: '{"b":"<img>"}', n: "3" });
  });

  it("refuses a findings payload without likely_cause and confidence", () => {
    expect(boundedFindings({ evidence: [] })).toBeNull();
    expect(
      boundedFindings({
        likely_cause: "pool",
        confidence: "inconclusive",
        evidence: [
          { text: "x", kind: "verified", call_id: "c" },
          { text: 1, kind: "verified" },
        ],
        ruled_out: ["deploy", 3],
        unknowns: [],
        next_steps: [],
      }),
    ).toMatchObject({
      confidence: "inconclusive",
      evidence: [{ callId: "c" }],
      ruledOut: ["deploy"],
    });
  });

  it("reads credits only when the server counts them", () => {
    expect(footerUsage({ total_tokens: 18954, llm_calls: 3 })).toEqual({
      totalTokens: 18954,
      llmCalls: 3,
    });
    expect(footerUsage({ credits: 2 })).toEqual({ credits: 2 });
  });
});

describe("manualRouteOf", () => {
  it("takes the turn's last query and the prompt's window when the step has none", () => {
    const prompt: ChatMessage = {
      role: "user",
      content: raw("q"),
      chips: [
        {
          id: "t",
          kind: "time",
          label: raw("Time"),
          ref: { type: "time", org: "acme", from: 5, to: 9 },
          sizeBytes: 0,
          provenance: "page",
          sent: "whitelist",
        },
      ],
    };
    const failed = answer([
      {
        type: "tool_call",
        tool: "SearchSQL",
        call_id: "e",
        success: false,
        stepState: "failed",
        context: { sql: SQL },
      },
    ]);
    expect(manualRouteOf(failed, promptRange(prompt), "acme")).toMatchObject({
      text: SQL,
      stream: "default",
      from: 5,
      to: 9,
    });
  });

  it("reads the prompt's time chip, then the window it was sent with, then the stored one", () => {
    const bare: ChatMessage = { role: "user", content: raw("q") };
    expect(promptRange(bare)).toBeNull();
    expect(promptRange(bare, { from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
    expect(promptRange({ ...bare, sentWindow: { from: 3, to: 4 } }, { from: 1, to: 2 })).toEqual({
      from: 3,
      to: 4,
    });
  });

  it("keys a turn's vote, findings outcome and window apart", () => {
    expect(
      new Set([
        turnAnnotationKey("t1", "feedback"),
        turnAnnotationKey("t1", "findings"),
        turnAnnotationKey("t1", "window"),
        turnAnnotationKey("t2", "feedback"),
      ]).size,
    ).toBe(4);
  });

  it("is null without any query", () => {
    expect(manualRouteOf(answer([]), null, "acme")).toBeNull();
  });
});

describe("toolLinksOf / chipOpenQuery", () => {
  it("offers first-party create, get and update routes only", () => {
    const nav = {
      resource_type: "dashboard",
      action: "navigate_direct" as const,
      label: raw("x"),
      target: { dashboard_id: "d" },
    };
    const message = answer([
      { type: "tool_call", tool: "createDashboard", stepState: "done", navigationAction: nav },
      {
        type: "tool_call",
        tool: "mcp__x__createDashboard",
        stepState: "done",
        navigationAction: nav,
      },
      {
        type: "tool_call",
        tool: "SearchSQL",
        stepState: "done",
        navigationAction: { ...nav, action: "load_query" },
      },
    ]);
    expect(toolLinksOf(message)).toHaveLength(1);
  });

  it("opens a row chip on its stream one minute either side of the row", () => {
    const query = chipOpenQuery(
      {
        id: "r",
        kind: "log_row",
        label: raw("Row"),
        ref: { type: "log_row", org: "acme", stream: "default" },
        data: { _timestamp: FROM * US },
        sizeBytes: 1,
        provenance: "door",
        sent: "serialized",
      },
      "acme",
    );
    expect(query).toMatchObject({ stream: "default", from: FROM - 60_000, to: FROM + 60_000 });
  });
});
