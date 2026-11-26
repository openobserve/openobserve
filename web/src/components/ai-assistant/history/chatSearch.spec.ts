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

import { raw } from "@/types/i18n";

import {
  highlightParts,
  messageSnippet,
  SNIPPET_LEAD,
  snippetOf,
  TITLE_FIT,
  titleWindow,
  turnTexts,
} from "./chatSearch";

describe("chatSearch", () => {
  it("marks every case-insensitive match and keeps the text between them", () => {
    expect(highlightParts("Streams and more streams", "stream")).toEqual([
      { text: "Stream", hit: true },
      { text: "s and more ", hit: false },
      { text: "stream", hit: true },
      { text: "s", hit: false },
    ]);
    expect(highlightParts("Alpha", "  ")).toEqual([{ text: "Alpha", hit: false }]);
  });

  it("starts a long title a few words before a match the row would truncate, and leaves the rest whole", () => {
    const title = "Say in one short sentence what you will do, then list my streams";
    expect(titleWindow(title, "stream")).toBe("…do, then list my streams");
    expect(titleWindow(title, "short")).toBe(title);
    expect(titleWindow(title, "nothing")).toBe(title);
    expect(titleWindow(title, "")).toBe(title);
    const solid = `${"x".repeat(TITLE_FIT)}nginx`;
    expect(titleWindow(solid, "nginx")).toBe(`…${"x".repeat(16)}nginx`);
  });

  it("reads a stored chat's prompts and answer text, skipping tool frames and empty turns", () => {
    const turns = [
      {
        user: { text: "list my streams" },
        frames: [
          { type: "message_delta", content: "You have " },
          { type: "tool_call", content: "ignored" },
          { type: "message_delta", content: "47 streams." },
        ],
      },
      { user: null, frames: [] },
    ];
    expect(turnTexts(turns as never)).toEqual(["list my streams", "You have 47 streams."]);
  });

  it("cuts one line around the first match, with an ellipsis on each cut side", () => {
    const text = `${"x".repeat(80)} the nginx\n  error ${"y".repeat(200)}`;
    const snippet = snippetOf(text, "NGINX")!;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("the nginx error");
    expect(snippet.indexOf("nginx")).toBe(SNIPPET_LEAD + 1);
    expect(snippetOf("short text", "text")).toBe("short text");
    expect(snippetOf("short text", "absent")).toBeNull();
  });

  it("takes the first message that holds the needle, from either side", () => {
    const messages = [
      { role: "user" as const, content: raw("list my streams") },
      { role: "assistant" as const, content: raw("You have 47 streams") },
    ];
    expect(messageSnippet(messages, "47")).toBe("You have 47 streams");
    expect(messageSnippet(messages, "streams")).toBe("list my streams");
    expect(messageSnippet(messages, "dashboards")).toBeNull();
  });
});
