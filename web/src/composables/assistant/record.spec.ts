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

import { foldTurns, mergeIncremental, messagesFromTurns, type StoredTurn } from "./record";

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
    for (const status of [undefined, "interrupted", "running"] as const) {
      const [, answer] = replay([{ ...unfinished, ...(status && { status }) }]);
      expect(answer.contentBlocks?.at(-1)).toEqual({ type: "error", errorType: "stream_dropped" });
    }
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
