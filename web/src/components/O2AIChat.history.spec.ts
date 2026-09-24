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

import { messagesFromTurns, type StoredTurn } from "./O2AIChat.history";

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
          { type: "tool_call", tool: "StreamList", message: "Listing streams", call_id: "c1", context: {} },
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
});
