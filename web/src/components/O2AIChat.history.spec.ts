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
  foldTurns,
  mergeIncremental,
  messagesFromTurns,
  type StoredTurn,
} from "./O2AIChat.history";

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
    const note = "_[aiAssistant.responseStoppedByUser]_";
    expect(assistant.content).toBe(`Partial\n\n${note}`);
    expect(assistant.contentBlocks).toEqual([
      { type: "text", text: "Partial" },
      { type: "text", text: note },
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
    expect(messages[1].contentBlocks?.map((b) => b.type)).toEqual(["tool_call", "text"]);
    expect(messages[1].content).toBe("_[aiAssistant.responseStoppedByUser]_");
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
    expect(assistant.content).toBe("P\n\n_[aiAssistant.responseStoppedByUser]_");
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
    expect(stopped.content).toBe("P\n\n_[aiAssistant.responseStoppedByUser]_");
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

  it("keeps never-stored failed turns after the stored ones, deduplicated by turn id", () => {
    const cached = foldTurns([seqTurn("a", 1, 2), failed("f1")], t);
    const merged = mergeIncremental(cached, 2, [seqTurn("b", 3, 4), failed("f1"), failed("f2")], t);
    expect(merged.spans.map((s) => s.first_seq ?? s.turn_id)).toEqual([1, 3, "f1", "f2"]);
    expect(merged.messages).toHaveLength(6);
  });
});
