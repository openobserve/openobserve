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

import type { StoredTurn } from "@/components/O2AIChat.history";

import { projectSharedRecord, scrubModelNames, sharedMarkdown } from "./sharedRecord";

const turns = (): StoredTurn[] => [
  {
    user: { text: "Was claude-3-5-sonnet or GPT-4o slower?" },
    frames: [
      { type: "message_delta", content: "Checking with gemini-1.5-pro." },
      {
        type: "tool_call",
        tool: "SearchSQL",
        message: "Querying",
        call_id: "c1",
        context: { sql: "SELECT * FROM payments" },
      },
      { type: "tool_result", tool: "SearchSQL", success: true, call_id: "c1", message: "done" },
      { type: "message_delta", content: "Payments were slower." },
      { type: "complete" },
    ],
  },
];

const steps = (messages: ReturnType<typeof projectSharedRecord>) =>
  JSON.stringify(messages.flatMap((message) => message.contentBlocks ?? []));

describe("projectSharedRecord", () => {
  it("scrubs model names from every text field for a viewer", () => {
    const messages = projectSharedRecord(turns(), "viewer", { scrubModels: true, timezone: "" });
    const all = JSON.stringify(messages);
    expect(all).not.toMatch(/claude|gpt-4o|gemini/i);
    expect(String(messages[0].content)).toBe("Was the model or the model slower?");
  });

  it("leaves a query's stream and SQL as they are, so the block still opens", () => {
    const frames = [
      {
        type: "query",
        language: "sql",
        text: "SELECT * FROM gpt_4o_traces",
        stream: "gpt_4o_traces",
      },
      { type: "complete" },
    ];
    const messages = projectSharedRecord([{ user: { text: "q" }, frames }], "viewer", {
      scrubModels: true,
      timezone: "",
    });
    expect(steps(messages)).toContain('"stream":"gpt_4o_traces"');
    expect(steps(messages)).toContain("SELECT * FROM gpt_4o_traces");
  });

  it("keeps the text as is without the scrub, and leaves the query cache's objects intact", () => {
    const input = turns();
    const messages = projectSharedRecord(input, "viewer", { scrubModels: false, timezone: "" });
    expect(String(messages[0].content)).toContain("claude-3-5-sonnet");
    projectSharedRecord(input, "viewer", { scrubModels: true, timezone: "" });
    expect(input[0].user?.text).toContain("claude-3-5-sonnet");
  });

  it("drops tool inputs and outputs when redacted, keeping which tool ran", () => {
    const messages = projectSharedRecord(turns(), "viewer", {
      scrubModels: true,
      timezone: "",
      redacted: true,
    });
    expect(steps(messages)).toContain("SearchSQL");
    expect(steps(messages)).not.toContain("SELECT * FROM payments");
  });

  it("drops query, findings and link evidence when redacted, and a hidden stream's query", () => {
    const evidence = (): StoredTurn[] => [
      {
        user: { text: "Why?" },
        frames: [
          {
            type: "query",
            language: "sql",
            text: "SELECT secret FROM payments",
            stream: "payments",
          },
          { type: "findings", likely_cause: "card numbers leak", confidence: "high" },
          { type: "message_delta", content: "Done." },
          { type: "complete" },
        ],
      },
    ];
    const plain = projectSharedRecord(evidence(), "viewer", { scrubModels: false, timezone: "" });
    expect(steps(plain)).toContain("SELECT secret FROM payments");
    expect(steps(plain)).toContain("card numbers leak");
    const redacted = projectSharedRecord(evidence(), "viewer", {
      scrubModels: false,
      timezone: "",
      redacted: true,
    });
    expect(steps(redacted)).not.toContain("SELECT secret");
    expect(steps(redacted)).not.toContain("card numbers");
    const hidden = projectSharedRecord(evidence(), "viewer", {
      scrubModels: false,
      timezone: "",
      hidden: { c9: { reason: "stream_forbidden", stream: "payments" } },
    });
    expect(steps(hidden)).not.toContain("SELECT secret");
  });

  it("hides a step whose stream the viewer can't read", () => {
    const messages = projectSharedRecord(turns(), "viewer", {
      scrubModels: true,
      timezone: "",
      hidden: { c1: { reason: "stream_forbidden", stream: "payments" } },
    });
    expect(steps(messages)).toContain("Hidden · you don't have access to stream payments");
    expect(steps(messages)).not.toContain("SELECT * FROM payments");
  });

  it("names the owner's prompts for anyone but the owner, in the page and in Markdown", () => {
    const messages = projectSharedRecord(turns(), "viewer", {
      scrubModels: true,
      timezone: "",
      author: "Priya",
    });
    expect(messages[0].author).toBe("Priya");
    const markdown = sharedMarkdown("Checkout", messages);
    expect(markdown).toContain("## Priya");
    expect(markdown).not.toContain("## You");
    const own = projectSharedRecord(turns(), "viewer", { scrubModels: true, timezone: "" });
    expect(sharedMarkdown("Checkout", own)).toContain("## You");
  });
});

describe("scrubModelNames", () => {
  it.each([
    ["ask claude-3-opus", "ask the model"],
    ["anthropic/claude-sonnet-4", "the model"],
    ["gpt-4.1-mini answered", "the model answered"],
    ["o3-mini and llama-3.1-70b", "the model and the model"],
  ])("scrubs %s", (input, output) => {
    expect(scrubModelNames(input)).toBe(output);
  });

  it("leaves ordinary words alone", () => {
    expect(scrubModelNames("Claude from billing asked about o1 latency")).toBe(
      "Claude from billing asked about o1 latency",
    );
  });
});
