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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseChatDetail } from "@/services/assistant";
import type { TranslateFn } from "@/types/i18n";

import { assistantFrameSchema } from "./frames";
import { generateNavigationFromToolResult } from "./navigationRoutes";
import {
  KNOWN_FRAME_TYPES,
  foldTurns,
  hidesAttachments,
  mergeIncremental,
  messagesFromTurns,
  minuteLabel,
  projectRecord,
  type ProjectRecordOptions,
  type StoredTurn,
} from "./record";
import { reduce, type ReducerCtx, type StreamState } from "./reducer";

const t = ((key: string, params?: { message?: string }) =>
  params?.message ? `${key}: ${params.message}` : key) as any;

const turn = (text: string, frames: any[], extra: Partial<StoredTurn> = {}): StoredTurn => ({
  user_message_id: `msg_${text}`,
  user: { text },
  frames: [...frames, { type: "complete" }],
  ...extra,
});

describe("messagesFromTurns", () => {
  it("rebuilds user and assistant messages the way the live stream does", () => {
    const messages = messagesFromTurns(
      [
        turn("list streams", [
          { type: "message_delta", content: "Checking." },
          {
            type: "tool_call",
            tool: "StreamList",
            message: "Listing streams",
            call_id: "c1",
            context: {},
          },
          {
            type: "tool_result",
            tool: "StreamList",
            success: true,
            message: "StreamList completed successfully",
            call_id: "c1",
          },
          { type: "message_delta", content: "Found 3." },
        ]),
        turn("thanks", [{ type: "message_delta", content: "Welcome." }]),
      ],
      t,
    );

    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0].content).toBe("list streams");
    const blocks = messages[1].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["text", "tool_call", "text"]);
    expect(blocks[1]).toMatchObject({ tool: "StreamList", call_id: "c1", success: true });
    expect(messages[3].contentBlocks?.[0]).toMatchObject({ type: "text", text: "Welcome." });
  });

  it("shows a failed turn's error and stops folding at it", () => {
    const messages = messagesFromTurns(
      [
        turn("go", [
          { type: "error", error: "rate limited", recoverable: false },
          { type: "message_delta", content: "never shown" },
        ]),
      ],
      t,
    );
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[1])).toContain("rate limited");
    expect(JSON.stringify(messages[1])).not.toContain("never shown");
  });

  it("keeps attached images as attachments", () => {
    const [user] = messagesFromTurns(
      [
        turn("what is this", [], {
          user: {
            text: "what is this",
            images: [{ filename: "x.png", mime: "image/png", url: "data:image/png;base64,AAAA" }],
          },
        }),
      ],
      t,
    );
    expect(user.images).toEqual([
      { data: "AAAA", mimeType: "image/png", filename: "x.png", size: 3 },
    ]);
  });

  it("does not replay a past navigation as a pending confirmation", () => {
    const messages = messagesFromTurns(
      [
        turn("make a dashboard", [
          {
            type: "navigation_action",
            action: "navigate_direct",
            resource_type: "dashboard",
            label: "Open dashboard",
            target: { path: "/dashboards/view" },
          },
        ]),
      ],
      t,
    );
    const blocks = messages.flatMap((m) => m.contentBlocks ?? []);
    expect(blocks.some((b) => b.pendingConfirmation)).toBe(false);
  });

  it("marks a stopped turn after its partial answer", () => {
    const stopped: StoredTurn = {
      user_message_id: "msg_stop",
      user: { text: "explain" },
      frames: [{ type: "message_delta", content: "Partial" }, { type: "cancelled" }],
    };
    const [, assistant] = messagesFromTurns([stopped], t);
    expect(assistant.content).toBe("Partial");
    expect(assistant.contentBlocks).toEqual([
      { type: "text", text: "Partial" },
      { type: "status", turnStatus: "stopped", message: "aiAssistant.responseStoppedByUser" },
    ]);
  });

  it("marks a turn stopped before any answer, closing its running tool call", () => {
    const stopped: StoredTurn = {
      user_message_id: "msg_stop",
      user: { text: "list" },
      frames: [
        { type: "tool_call", tool: "StreamList", message: "Listing", call_id: "c1", context: {} },
        { type: "cancelled" },
      ],
    };
    const messages = messagesFromTurns([stopped], t);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].contentBlocks?.map((b) => b.type)).toEqual(["tool_call", "status"]);
    expect(messages[1].contentBlocks?.[1]?.turnStatus).toBe("stopped");
    expect(messages[1].content).toBe("");
  });

  it("marks a running turn as still generating", () => {
    const [, assistant] = messagesFromTurns(
      [
        {
          user: { text: "go" },
          frames: [{ type: "message_delta", content: "So far" }],
          status: "running",
        },
      ],
      t,
    );
    expect(assistant.contentBlocks?.at(-1)).toEqual({
      type: "status",
      turnStatus: "running",
      message: "aiAssistant.turnRunning",
    });
  });

  it("words a running turn for a viewer, who cannot act on it", () => {
    const [, assistant] = messagesFromTurns(
      [{ user: { text: "go" }, frames: [], status: "running" }],
      t,
      "viewer",
    );
    expect(assistant.contentBlocks?.at(-1)?.message).toBe("aiAssistant.turnRunningViewer");
  });

  it("marks an interrupted turn after its partial answer, with the error code", () => {
    const [, assistant] = messagesFromTurns(
      [
        {
          user: { text: "go" },
          frames: [{ type: "message_delta", content: "Partial" }],
          status: "interrupted",
          error_code: "stream_interrupted",
        },
      ],
      t,
    );
    expect(assistant.contentBlocks?.map((b) => b.type)).toEqual(["text", "error"]);
    expect(assistant.contentBlocks?.[1]).toMatchObject({
      message: "aiAssistant.turnInterrupted",
      suggestion: "aiAssistant.turnErrorCode",
      recoverable: true,
    });
  });

  it("marks a failed turn without an error frame, but not one that has its own", () => {
    const withoutFrame = messagesFromTurns(
      [{ user: { text: "go" }, frames: [{ type: "complete" }], status: "failed" }],
      t,
    );
    expect(withoutFrame[1].contentBlocks).toEqual([
      { type: "error", message: "aiAssistant.turnFailed", suggestion: undefined },
    ]);
    const withFrame = messagesFromTurns(
      [{ user: { text: "go" }, frames: [{ type: "error", error: "bad model" }], status: "failed" }],
      t,
    );
    expect(withFrame[1].contentBlocks?.map((b) => b.type)).toEqual(["text"]);
  });

  it("shows a turn that stored nothing as a message that failed to send", () => {
    const messages = messagesFromTurns(
      [
        turn("hello", [{ type: "message_delta", content: "Hi" }]),
        { turn_id: "t2", status: "failed", error_code: "turn_limit", user: null, frames: [] },
      ],
      t,
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages[2].contentBlocks?.[0]).toMatchObject({
      type: "error",
      message: "aiAssistant.messageFailedToSend",
    });
  });

  it("shows a turn that stored nothing but carries the server's error frame as failed to send", () => {
    const errorFrame = {
      type: "error",
      error: "The response failed (upstream_error). Please try again.",
      error_code: "upstream_error",
      recoverable: false,
    };
    const messages = messagesFromTurns(
      [
        turn("hello", [{ type: "message_delta", content: "Hi" }]),
        {
          turn_id: "t2",
          status: "failed",
          error_code: "upstream_error",
          user: null,
          frames: [errorFrame],
        },
      ],
      t,
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages[1].content).toBe("Hi");
    expect(messages[2].contentBlocks).toEqual([
      {
        type: "error",
        message: "aiAssistant.messageFailedToSend",
        suggestion: "aiAssistant.turnErrorCode",
      },
    ]);
  });

  it("shows a partly stored failed turn with its prompt and its error", () => {
    const errorFrame = { type: "error", error: "boom", error_code: "x", recoverable: false };
    const messages = messagesFromTurns(
      [
        {
          user: { text: "go" },
          frames: [{ type: "message_delta", content: "Part" }, errorFrame],
          status: "failed",
        },
      ],
      t,
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("go");
    expect(messages[1].content).toContain("Part");
    expect(messages[1].content).toContain("boom");
  });

  it("renders no empty user bubble when the prompt event was not committed", () => {
    const messages = messagesFromTurns(
      [
        turn("hello", [{ type: "message_delta", content: "Hi" }]),
        {
          user: { text: "" },
          frames: [{ type: "error", error: "boom", recoverable: false }],
          status: "failed",
        },
      ],
      t,
    );
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages[1].content).toBe("Hi");
    expect(messages[2].content).toContain("boom");
  });

  it("adds the stop marker once for a cancelled turn without a cancelled frame", () => {
    const [, assistant] = messagesFromTurns(
      [
        {
          user: { text: "go" },
          frames: [{ type: "message_delta", content: "P" }],
          status: "cancelled",
        },
      ],
      t,
    );
    expect(assistant.contentBlocks?.filter((b) => b.turnStatus === "stopped")).toHaveLength(1);
    const [, stopped] = messagesFromTurns(
      [
        {
          user: { text: "go" },
          frames: [{ type: "message_delta", content: "P" }, { type: "cancelled" }],
          status: "cancelled",
        },
      ],
      t,
    );
    expect(stopped.contentBlocks?.filter((b) => b.turnStatus === "stopped")).toHaveLength(1);
  });
});

describe("mergeIncremental", () => {
  const seqTurn = (text: string, first: number, last: number): StoredTurn => ({
    ...turn(text, [{ type: "message_delta", content: `re ${text}` }]),
    first_seq: first,
    last_seq: last,
  });
  const failed = (id: string): StoredTurn => ({
    turn_id: id,
    status: "failed",
    user: null,
    frames: [],
  });

  it("keeps committed turns, replaces a grown turn and appends new ones", () => {
    const cached = foldTurns([seqTurn("a", 1, 2), seqTurn("b", 3, 4)], t);
    cached.messages[1].feedback = "thumbs_up";
    const merged = mergeIncremental(cached, 4, [seqTurn("b2", 3, 6), seqTurn("c", 7, 8)], t);
    expect(merged.messages.map((m) => m.content)).toEqual([
      "a",
      "re a",
      "b2",
      "re b2",
      "c",
      "re c",
    ]);
    expect(merged.messages[1].feedback).toBe("thumbs_up");
    expect(merged.spans.map((s) => s.first_seq)).toEqual([1, 3, 7]);
  });

  it("keeps a cached failed turn in place and new turns in the server's order", () => {
    const cached = foldTurns([seqTurn("a", 1, 2), failed("f1")], t);
    const merged = mergeIncremental(cached, 2, [seqTurn("b", 3, 4), failed("f1"), failed("f2")], t);
    expect(merged.spans.map((s) => s.first_seq ?? s.turn_id)).toEqual([1, "f1", 3, "f2"]);
    expect(merged.messages).toHaveLength(6);
  });

  it("orders a failed turn that started between stored turns as the server lists it", () => {
    const cached = foldTurns([seqTurn("a", 1, 2)], t);
    const merged = mergeIncremental(cached, 2, [failed("f1"), seqTurn("b", 3, 4)], t);
    expect(merged.spans.map((s) => s.first_seq ?? s.turn_id)).toEqual([1, "f1", 3]);
  });

  it("replaces a grown turn in place, ahead of a failed turn cached after it", () => {
    const cached = foldTurns([seqTurn("a", 1, 2), seqTurn("b", 3, 4), failed("f1")], t);
    const merged = mergeIncremental(cached, 4, [seqTurn("b2", 3, 6)], t);
    expect(merged.spans.map((s) => s.first_seq ?? s.turn_id)).toEqual([1, 3, "f1"]);
    expect(merged.messages[2].content).toBe("b2");
  });
});

describe("foldTurns: replay phase", () => {
  const replay = (turns: StoredTurn[]) => messagesFromTurns(turns, t, "owner", "replay");

  it("renders a stored step without a result interrupted, never running (HT-05 AC 5)", () => {
    const [, answer] = replay([
      turn("q", [
        { type: "tool_call", tool: "SearchSQL", call_id: "c1", message: "Querying", context: {} },
        { type: "message_delta", content: "so far" },
      ]),
    ]);
    expect(answer.contentBlocks?.[0]).toMatchObject({ call_id: "c1", stepState: "interrupted" });
  });

  it("ends a stored turn that never finished with the stream_dropped outcome (HT-01 AC 7)", () => {
    const unfinished: StoredTurn = {
      user: { text: "q" },
      frames: [{ type: "message_delta", content: "partial" }],
    };
    for (const status of [undefined, "interrupted"] as const) {
      const [, answer] = replay([{ ...unfinished, ...(status && { status }) }]);
      expect(answer.contentBlocks?.at(-1)).toEqual({ type: "error", errorType: "stream_dropped" });
    }
  });

  it("never marks a turn the server still runs as dropped", () => {
    const [, answer] = replay([
      {
        user: { text: "q" },
        frames: [{ type: "message_delta", content: "partial" }],
        status: "running",
      },
    ]);
    expect(answer.contentBlocks?.some((block) => block.type === "error")).toBe(false);
    const [, empty] = replay([{ user: { text: "q" }, frames: [], status: "running" }]);
    expect(empty?.contentBlocks?.some((block) => block.type === "error") ?? false).toBe(false);
  });

  it("names a stored failure without an error frame by its stored code", () => {
    const failed: StoredTurn = {
      user: { text: "q" },
      frames: [],
      status: "failed",
      error_code: "agent_unreachable",
    };
    const [, answer] = replay([failed]);
    expect(answer.contentBlocks).toEqual([{ type: "error", errorType: "agent_unavailable" }]);
  });

  it("adds no marker to a completed turn and no live status to any turn", () => {
    const [, answer] = replay([
      turn("q", [{ type: "message_delta", content: "done" }, { type: "complete" }], {
        status: "completed",
      }),
    ]);
    // The footer block is the turn's own data (trace, usage), not an outcome marker.
    expect(answer.contentBlocks).toEqual([
      { type: "text", text: "done" },
      { type: "footer", footer: {} },
    ]);
    const running = replay([
      turn("q", [{ type: "message_delta", content: "x" }], { status: "running" }),
    ]);
    expect(
      running.flatMap((m) => m.contentBlocks ?? []).some((b) => b.turnStatus === "running"),
    ).toBe(false);
  });

  it("replays a stored stopped turn whose frames end with cancelled as stopped", () => {
    const stopped: StoredTurn = {
      user: { text: "q" },
      frames: [
        { type: "tool_call", tool: "SearchSQL", call_id: "c1", context: {} },
        { type: "message_delta", content: "partial" },
        { type: "cancelled" },
      ],
      status: "cancelled",
    };
    for (const status of ["cancelled", undefined] as const) {
      const [, answer] = replay([{ ...stopped, status }]);
      const blocks = answer.contentBlocks ?? [];
      expect(blocks.at(-1)).toEqual({ type: "status", turnStatus: "stopped" });
      expect(blocks.filter((b) => b.turnStatus === "stopped")).toHaveLength(1);
      expect(blocks[0].stepState).toBe("interrupted");
    }
  });

  it.each([
    ["signed_out", "signed_out"],
    ["server", "cancelled_elsewhere"],
  ])("replays cancelled{by:%s} as live reads it, not as the reader's Stop", (by, errorType) => {
    const [, answer] = replay([
      {
        user: { text: "q" },
        frames: [
          { type: "message_delta", content: "partial" },
          { type: "cancelled", by },
        ],
        status: "cancelled",
      },
    ]);
    const blocks = answer.contentBlocks ?? [];
    expect(blocks.at(-1)).toEqual({ type: "error", errorType });
    expect(blocks.some((b) => b.turnStatus === "stopped")).toBe(false);
  });

  it("replays cancelled{by:user} as the reader's Stop", () => {
    const [, answer] = replay([
      { user: { text: "q" }, frames: [{ type: "cancelled", by: "user" }], status: "cancelled" },
    ]);
    expect(answer.contentBlocks?.at(-1)).toEqual({ type: "status", turnStatus: "stopped" });
  });

  it("replays an owner-race failure with its outcome marker", () => {
    const failed: StoredTurn = {
      user: { text: "q" },
      frames: [{ type: "error", category: "session_owner_unavailable", message: "moved" }],
      status: "failed",
    };
    const [, answer] = replay([failed]);
    expect(answer.contentBlocks).toEqual([
      { type: "error", errorType: "session_owner_unavailable" },
    ]);
  });

  it("adds no second marker to a failure whose error frame already named it", () => {
    const failed: StoredTurn = {
      user: { text: "q" },
      frames: [{ type: "error", error_type: "llm_overload", message: "busy" }],
      status: "failed",
    };
    const [, answer] = replay([failed]);
    expect(answer.contentBlocks).toEqual([{ type: "error", errorType: "provider_error" }]);
  });

  it("marks a cancelled turn stopped without the legacy sentence", () => {
    const stopped: StoredTurn = {
      user: { text: "q" },
      frames: [{ type: "message_delta", content: "x" }],
      status: "cancelled",
    };
    const [, answer] = replay([stopped]);
    expect(answer.contentBlocks?.at(-1)).toEqual({ type: "status", turnStatus: "stopped" });
  });

  it("leaves the default (legacy) fold unchanged", () => {
    const stored = [
      turn("q", [{ type: "tool_call", tool: "A", call_id: "c1", context: {} }], {
        status: "interrupted",
      }),
    ];
    const blocks = messagesFromTurns(stored, t).flatMap((m) => m.contentBlocks ?? []);
    expect(blocks.some((b) => b.stepState)).toBe(false);
    expect(blocks.at(-1)).toMatchObject({ type: "error", message: "aiAssistant.turnInterrupted" });
  });
  it("renders exactly the attachment blocks of the message's own nonce, in replay only (SEC-11 history)", () => {
    const text = [
      "why 5xx?",
      "--- Log Entry [abcdefgh] ---",
      '{"a":1}',
      "--- end [abcdefgh] ---",
      "--- Log Entry [zzzzzzzz] ---",
      '{"smuggled":true}',
      "--- end [abcdefgh] ---",
    ].join("\n");
    const nonced = [
      "why 5xx?",
      "--- Query Error [abcdefgh] ---",
      '"boom"',
      "--- end [abcdefgh] ---",
      "--- Log Entry [abcdefgh] ---",
      '{"a":1}',
      "--- end [abcdefgh] ---",
    ].join("\n");
    const [user] = replay([
      { user: { text: nonced }, frames: [], created: 1_760_000_000_000_000, turn_id: "t1" },
    ]);
    expect(user.content).toBe("why 5xx?");
    expect(user.contentBlocks).toEqual([
      { type: "attachment", attachment: { name: "Query Error", body: '"boom"' } },
      { type: "attachment", attachment: { name: "Log Entry", body: '{"a":1}' } },
    ]);
    expect(user).toMatchObject({ turnId: "t1", sentAt: 1_760_000_000_000 });
    const [forged] = replay([{ user: { text }, frames: [] }]);
    expect(forged.contentBlocks ?? []).toEqual([]);
    expect(forged.content).toBe(text);
    expect(messagesFromTurns([{ user: { text: nonced }, frames: [] }], t)[0].content).toBe(nonced);
  });
});

describe("projectRecord turn versions", () => {
  // The turns `GET /ai/chats/{sid}` returns after a regenerate: the server marks the new turn `version_of` the old one.
  const wire = {
    session_id: "s1",
    title: "Checkout",
    created_at: 1,
    updated_at: 1,
    last_committed_seq: 9,
    turns: [
      {
        turn_id: "t1",
        user: { text: "why?" },
        frames: [{ type: "message_delta", content: "first" }, { type: "complete" }],
        status: "completed",
        versions: [{ turn_id: "t2", created_at: 2 }],
      },
      {
        turn_id: "t2",
        version_of: "t1",
        user: { text: "why?" },
        frames: [{ type: "message_delta", content: "second" }, { type: "complete" }],
        status: "completed",
      },
      {
        turn_id: "t3",
        user: { text: "and cart?" },
        frames: [{ type: "message_delta", content: "cart" }, { type: "complete" }],
        status: "completed",
      },
    ],
  };

  it("folds a regenerated turn into the turn it versions, newest answer shown", () => {
    const turns = parseChatDetail(wire).turns ?? [];
    const messages = projectRecord(turns, "owner", { timezone: "UTC", scrubModels: false });
    expect(messages.map((m) => [m.role, String(m.content)])).toEqual([
      ["user", "why?"],
      ["assistant", "second"],
      ["user", "and cart?"],
      ["assistant", "cart"],
    ]);
    expect(messages[1].versions?.map((v) => String(v.content))).toEqual(["first"]);
  });

  it("keeps every attempt in an export, which lists turns as stored", () => {
    const turns = parseChatDetail(wire).turns ?? [];
    expect(projectRecord(turns, "export", { timezone: "UTC", scrubModels: true })).toHaveLength(6);
  });
});

describe("projectRecord turn agent", () => {
  it("keeps the agent of a reloaded turn that has no turn_started frame", () => {
    const detail = parseChatDetail(
      JSON.parse(readFileSync(join(__dirname, "__fixtures__/history.json"), "utf8"))[
        "door-followup"
      ],
    );
    const followUp = detail.turns!.at(-1)!;
    expect(followUp.frames.some((frame: any) => frame?.type === "turn_started")).toBe(false);
    const messages = projectRecord(detail.turns!, "owner", { timezone: "UTC" });
    const prompts = messages.filter((m) => m.role === "user");
    expect(prompts.map((m) => m.agentId)).toEqual(["generate-query", "generate-query"]);
  });

  it("keeps the agent a handed-off turn came from", () => {
    const detail = parseChatDetail({
      session_id: "s1",
      turns: [
        {
          turn_id: "t1",
          user: { text: "why?" },
          agent_type: "sre",
          handoff_from: "o2-ai",
          frames: [{ type: "message_delta", content: "a" }, { type: "complete" }],
          status: "completed",
        },
      ],
    });
    const [prompt] = projectRecord(detail.turns!, "owner", { timezone: "UTC" });
    expect(prompt).toMatchObject({ agentId: "sre", handoffFrom: "o2-ai" });
  });
});

describe("projectRecord", () => {
  const t = ((key: string) =>
    key === "assistant.record.theModel" ? "the model" : key) as TranslateFn;

  const turn = (frames: any[], extra: Partial<StoredTurn> = {}): StoredTurn => ({
    turn_id: "t1",
    created: Date.UTC(2026, 2, 2, 2, 14, 37) * 1000,
    user: { text: "delete it" },
    frames,
    status: "completed",
    ...extra,
  });

  const card = {
    type: "confirmation_required",
    id: "c1",
    tool: "o2_update",
    kind: "update",
    operation: "Update 1 alert",
    targets: [{ type: "alert", id: "a1", name: "checkout" }],
    before: { threshold: 1 },
    after: { threshold: 2 },
    args: { threshold: 2 },
  };

  const blocks = (messages: ReturnType<typeof projectRecord>) =>
    messages.flatMap((message) => message.contentBlocks ?? []);

  it("knows every frame type the parser does", () => {
    const parsed = assistantFrameSchema.options.map((option) => option.shape.type.value);
    expect([...KNOWN_FRAME_TYPES].sort()).toEqual([...parsed].sort());
  });

  it("renders a card with no decision as a record, never as pending", () => {
    const out = projectRecord([turn([card], { status: "running" })], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    const approval = blocks(out).find((block) => block.type === "approval");
    expect(approval?.approval?.noDecision).toBe(true);
    expect(blocks(out).some((block) => block.pendingConfirmation)).toBe(false);
  });

  it("keeps a resolved card's decision and leaves noDecision off", () => {
    const resolved = { type: "confirmation_resolved", id: "c1", approved: false, at: 1_000_123 };
    const out = projectRecord([turn([card, resolved, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      t,
    });
    expect(blocks(out).find((b) => b.type === "approval")?.approval?.noDecision).toBeUndefined();
    expect(blocks(out).find((b) => b.type === "approval_result")?.resolved?.at).toBe(960_000);
  });

  it("reads how a card without a resolution frame was answered from the chat's approvals", () => {
    const project = (approvals: any[]) =>
      blocks(
        projectRecord([turn([card, { type: "complete" }])], "owner", {
          timezone: "UTC",
          scrubModels: false,
          t,
          approvals,
        }),
      ).find((block) => block.type === "approval")?.approval;
    expect(project([{ id: "c1", status: "approved", at: 1_000_123 }])).toMatchObject({
      recorded: { status: "approved", at: 960_000 },
    });
    expect(project([{ id: "c1", status: "denied" }])?.recorded).toEqual({ status: "denied" });
    expect(project([{ id: "c1", status: "expired" }])?.recorded).toEqual({ status: "expired" });
    expect(project([{ id: "c1", status: "withdrawn" }])?.recorded).toEqual({ status: "withdrawn" });
    expect(project([{ id: "c1", status: "pending" }])?.noDecision).toBe(true);
    expect(project([{ id: "c1", status: "approved" }])?.noDecision).toBe(true);
    expect(project([{ id: "other", status: "denied" }])?.noDecision).toBe(true);
    expect(project([])?.recorded).toBeUndefined();
  });

  it("redacts a link to its kind and action, and a navigation action to the fixed label", () => {
    const nav = {
      type: "navigation_action",
      resource_type: "logs",
      action: "load_query",
      label: "payments errors",
      target: { stream: "payments", sql: "SELECT * FROM payments", from: 1, to: 2 },
    };
    const out = projectRecord([turn([nav, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      redacted: true,
      t,
    });
    const link = blocks(out).find((block) => block.type === "link")?.link;
    expect(link).toEqual({
      resourceType: "logs",
      action: "load_query",
      target: {},
      redacted: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/payments|SELECT/);
  });

  it("keeps only what a redacted card was, its count and its answer, naming no resource", () => {
    const resolved = {
      type: "confirmation_resolved",
      id: "c1",
      approved: true,
      by: "Priya",
      at: 1_000_123,
    };
    const out = projectRecord([turn([card, resolved, { type: "complete" }])], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      redacted: true,
      t,
    });
    expect(blocks(out).find((b) => b.type === "approval")?.approval).toEqual({
      id: "c1",
      kind: "update",
      total: 1,
    });
    expect(blocks(out).find((b) => b.type === "approval_result")?.resolved).toEqual({
      id: "c1",
      approved: true,
      at: 960_000,
    });
    expect(JSON.stringify(out)).not.toMatch(/checkout|a1|Update 1 alert/);
  });

  it("never names the stream of a hidden step on a redacted link", () => {
    const frames = [
      { type: "tool_call", tool: "SearchSQL", call_id: "q1", context: {} },
      { type: "tool_result", tool: "SearchSQL", call_id: "q1", summary: { rows: 4 } },
      { type: "complete" },
    ];
    const hidden = { q1: { reason: "stream_forbidden" as const, stream: "payments_audit" } };
    const step = (redacted: boolean) =>
      blocks(
        projectRecord([turn(frames)], "viewer", {
          timezone: "UTC",
          scrubModels: true,
          redacted,
          hidden,
          t,
        }),
      ).find((b) => b.call_id === "q1")?.hidden;
    expect(step(false)).toEqual({ reason: "stream_forbidden", stream: "payments_audit" });
    expect(step(true)).toEqual({ reason: "stream_forbidden", stream: "" });
  });

  it("drops the prompt's images when attachments are hidden, by default on public links", () => {
    const image = {
      filename: "a.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgo=",
    };
    const withImage = turn([{ type: "complete" }], { user: { text: "see", images: [image] } });
    const shown = projectRecord([withImage], "viewer", { timezone: "UTC", scrubModels: true, t });
    const hiddenOut = projectRecord([withImage], "viewer", {
      timezone: "UTC",
      scrubModels: true,
      hideAttachments: true,
      t,
    });
    expect(shown[0].images).toHaveLength(1);
    expect(hiddenOut[0].images).toBeUndefined();
    expect(hidesAttachments({ visibility: "public" })).toBe(true);
    expect(hidesAttachments({ visibility: "org" })).toBe(false);
    expect(hidesAttachments({ visibility: "public", hide_attachments: false })).toBe(false);
    expect(hidesAttachments({ visibility: "org", hide_attachments: true })).toBe(true);
  });

  it("scrubs model names for viewers and exports and keeps them for the owner unless asked", () => {
    const frames = [{ type: "message_delta", content: "Using gpt-4o today" }, { type: "complete" }];
    const owner = projectRecord([turn(frames)], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    const ownerScrubbed = projectRecord([turn(frames)], "owner", {
      timezone: "UTC",
      scrubModels: true,
      t,
    });
    const exported = projectRecord([turn(frames)], "export", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    expect(String(owner[1].content)).toContain("gpt-4o");
    expect(String(ownerScrubbed[1].content)).toBe("Using the model today");
    expect(String(exported[1].content)).toBe("Using the model today");
  });

  it("ignores unknown kinds with one warning per kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = projectRecord(
      [turn([{ type: "future" }, { type: "future" }, { type: "message_delta", content: "ok" }])],
      "owner",
      { timezone: "UTC", scrubModels: false, t },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(out[1].content)).toBe("ok");
    warn.mockRestore();
  });

  it("floors times to the minute and labels them in the org zone", () => {
    const out = projectRecord([turn([{ type: "complete" }])], "owner", {
      timezone: "UTC",
      scrubModels: false,
      t,
    });
    expect(out[0].sentAt).toBe(Date.UTC(2026, 2, 2, 2, 14));
    expect(minuteLabel(Date.UTC(2026, 2, 2, 2, 14), "Asia/Kolkata")).toBe("07:44");
    expect(minuteLabel(Date.UTC(2026, 2, 2, 2, 14), "Not/AZone")).toMatch(/^\d\d:\d\d$/);
  });
});

describe("record goldens", () => {
  const ROOT = join(__dirname, "__fixtures__", "record");
  const LOCALE = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "locales", "languages", "en-US.json"), "utf8"),
  );
  // `O2_UPDATE_GOLDEN=1` rewrites the expected files from the current projection.
  const UPDATE = process.env.O2_UPDATE_GOLDEN === "1";

  const AUDIENCES = [
    { file: "owner.json", audience: "owner", redacted: false, scrubModels: false },
    { file: "viewer.json", audience: "viewer", redacted: false, scrubModels: true },
    { file: "viewer-redacted.json", audience: "viewer", redacted: true, scrubModels: true },
    { file: "export.json", audience: "export", redacted: false, scrubModels: true },
  ] as const;

  interface RecordCase {
    schema: string;
    timezone: string;
    hidden?: ProjectRecordOptions["hidden"];
    turns: StoredTurn[];
  }

  const cases = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const rustSnapshot = JSON.parse(readFileSync(join(ROOT, "rust-snapshot.json"), "utf8")) as {
    cases: Record<string, unknown>;
  };

  const t = ((key: string, params?: Record<string, unknown>) => {
    const value = key.split(".").reduce<any>((node, part) => node?.[part], LOCALE);
    const text = typeof value === "string" ? value.split(" | ").at(-1)! : key;
    const linked = text.replace(/@:\{'([\w.]+)'\}/g, (_, link) =>
      link.split(".").reduce<any>((node: any, part: string) => node?.[part], LOCALE),
    );
    return linked.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
  }) as unknown as TranslateFn;

  // Who spoke and which block kinds, in order; a turn's closing line comes from the engine live, not the reducer.
  const shapeOf = (messages: any[]) =>
    messages.map((message) => ({
      role: message.role,
      blocks: (message.contentBlocks ?? [])
        .map((block: any) => block.type)
        .filter((type: string) => type !== "status" && type !== "error"),
    }));

  // The frames as the live reducer folds them while they stream, one turn at a time.
  const liveFold = (turns: StoredTurn[]) => {
    const ctx: ReducerCtx = {
      isActive: true,
      phase: "live",
      t,
      generateNavigation: (tool, args, body) =>
        generateNavigationFromToolResult(tool, args, body, t),
    };
    return turns.flatMap((turn) => {
      const state: StreamState = {
        messages: turn.user ? [{ role: "user", content: turn.user.text } as any] : [],
        activeToolCall: null,
        textSegment: "",
        streamingMsg: "",
        title: undefined,
        lastTraceId: null,
        ownerUnavailable: false,
        pendingConfirmation: null,
        messageComplete: false,
        halted: false,
      };
      for (const frame of turn.frames) if (!state.halted) reduce(state, frame, ctx);
      return state.messages;
    });
  };

  // The fixtures are shared with the server tests, so they keep the old wording; the product name is swapped in here.
  const read = (name: string, file: string) =>
    JSON.parse(
      readFileSync(join(ROOT, name, file), "utf8").replaceAll(
        "summarised by the assistant at",
        `summarised by ${LOCALE.brand.autobot} at`,
      ),
    );

  const project = (input: RecordCase, entry: (typeof AUDIENCES)[number]) =>
    JSON.parse(
      JSON.stringify(
        projectRecord(structuredClone(input.turns), entry.audience, {
          timezone: input.timezone,
          scrubModels: entry.scrubModels,
          redacted: entry.redacted,
          ...(input.hidden && entry.audience === "viewer" && { hidden: input.hidden }),
          t,
        }),
      ),
    );

  it("has every case the server tests read", () => {
    expect(cases).toEqual(
      expect.arrayContaining([
        "approved-delete",
        "denied-update",
        "stopped",
        "navigation",
        "pending-confirmation",
        "unknown-frame",
        "model-scrub",
        "compacted",
        "tool-redaction",
      ]),
    );
  });

  describe.each(cases)("%s", (name) => {
    const input = read(name, "frames.json") as RecordCase;

    it.each(AUDIENCES.map((entry) => [entry.file, entry] as const))(
      "projects %s",
      (file, entry) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const output = project(input, entry);
        warn.mockRestore();
        const path = join(ROOT, name, file);
        if (UPDATE) writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
        expect(existsSync(path), `${name}/${file} is missing; O2_UPDATE_GOLDEN=1 writes it`).toBe(
          true,
        );
        expect(output).toEqual(read(name, file));
      },
    );

    it("shows the same blocks in the same places live, on reload and in the export", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const live = shapeOf(liveFold(structuredClone(input.turns)));
      const reload = shapeOf(project(input, AUDIENCES[0]));
      const exported = shapeOf(project(input, AUDIENCES[3]));
      warn.mockRestore();
      expect(reload).toEqual(live);
      expect(exported).toEqual(reload);
    });

    const server = rustSnapshot.cases[name];
    if (server === undefined) it.todo("matches the server projection once B-10 captures it");
    else
      it("matches the server projection", () => {
        const viewer = project(input, AUDIENCES[1]);
        expect(viewer, "projection drift: see B-10").toEqual(server);
      });
  });

  it("never leaves a replayed card pending in any audience", () => {
    for (const name of cases) {
      const input = read(name, "frames.json") as RecordCase;
      for (const entry of AUDIENCES) {
        const blocks = project(input, entry).flatMap((m: any) => m.contentBlocks ?? []);
        for (const block of blocks.filter((b: any) => b.type === "approval"))
          expect(
            block.approval.noDecision === true ||
              blocks.some((b: any) => b.resolved?.id === block.approval.id),
          ).toBe(true);
        expect(blocks.some((b: any) => b.pendingConfirmation)).toBe(false);
      }
    }
  });

  it("keeps model names out of every scrubbed audience", () => {
    const input = read("model-scrub", "frames.json") as RecordCase;
    for (const entry of AUDIENCES.filter((a) => a.scrubModels)) {
      const text = JSON.stringify(project(input, entry));
      expect(text).not.toMatch(/gpt-4o|claude-3|gemini-1/i);
      expect(text).toContain("the model");
    }
  });

  it("warns once per unknown kind and drops it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = project(read("unknown-frame", "frames.json"), AUDIENCES[0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("hologram");
    expect(JSON.stringify(output)).not.toContain("hologram");
    warn.mockRestore();
  });

  it("drops tool inputs and outputs when redacted but keeps names and counts", () => {
    const input = read("tool-redaction", "frames.json") as RecordCase;
    const text = JSON.stringify(project(input, AUDIENCES[2]));
    expect(text).not.toContain("SELECT count(*)");
    expect(text).not.toContain("card 4111");
    expect(text).toContain("SearchSQL");
    expect(text).toContain("1287");
  });
});
