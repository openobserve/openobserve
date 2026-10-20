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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import AssistantMessage, {
  registerBlockRenderer,
  resetBlockRenderersForTests,
} from "./AssistantMessage.vue";
import {
  markdownParseCount,
  resetMarkdownForTests,
  setMarkdownParserForTests,
  syncMarkdownParserForTests,
} from "./markdown";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: (...args: unknown[]) => track(...args),
}));

const user = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "user",
  content: raw("**not bold** <img src=x onerror=alert(1)>"),
  sentAt: Date.UTC(2026, 9, 18, 8, 30),
  ...over,
});

const answer = (
  blocks: ChatMessage["contentBlocks"],
  over: Partial<ChatMessage> = {},
): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: blocks,
  ...over,
});

const mountMessage = (message: ChatMessage, props: Record<string, unknown> = {}) =>
  mount(AssistantMessage, { props: { message, turnId: "t1", ...props }, attachTo: document.body });

describe("AssistantMessage", () => {
  beforeEach(() => {
    setMarkdownParserForTests(syncMarkdownParserForTests);
    resetMarkdownForTests();
    resetBlockRenderersForTests();
    track.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("gives a long run break points with <wbr>, keeping the text exactly as sent", () => {
    setMarkdownParserForTests(null);
    const text = "token " + "a".repeat(200) + " end";
    const wrapper = mountMessage({
      role: "assistant",
      content: raw(""),
      contentBlocks: [{ type: "text", text }],
    });
    const plain = wrapper.get('[data-test="assistant-block-plain"]');
    expect(plain.element.textContent).toBe(text);
    expect(plain.findAll("wbr")).toHaveLength(3);
  });

  it("shows a block as one text node, never parsing it here, when no worker can parse it (X5, X9)", () => {
    setMarkdownParserForTests(null);
    const text = "Some **bold** <b>x</b>";
    const wrapper = mountMessage({
      role: "assistant",
      content: raw(""),
      contentBlocks: [{ type: "text", text }],
    });
    const plain = wrapper.get('[data-test="assistant-block-plain"]');
    expect(plain.element.childNodes).toHaveLength(1);
    expect(plain.element.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(plain.text()).toBe(text);
    expect(wrapper.find("strong").exists()).toBe(false);
  });

  it("shows the user's text as plain text, never Markdown, under You and the time (`30` §2.1)", () => {
    const wrapper = mountMessage(user());
    const body = wrapper.get('[data-test="assistant-message-text"]');
    expect(body.text()).toBe("**not bold** <img src=x onerror=alert(1)>");
    expect(body.element.querySelector("strong, img")).toBeNull();
    expect(body.classes()).toContain("whitespace-pre-wrap");
    expect(wrapper.get('[data-test="assistant-message-meta"]').text()).toMatch(
      /^You · .*\d{2}:\d{2}/,
    );
    expect(wrapper.attributes("data-test")).toBe("assistant-message-user");
  });

  it("names the author of a Slack-era record and lists sent chips read-only (CT-02 AC 10)", () => {
    const wrapper = mountMessage(
      user({
        author: "ada@example.com",
        chips: [
          {
            id: "c1",
            kind: "log_row",
            label: raw("Log row · cart"),
            sizeBytes: 3,
            provenance: "door",
            sent: "serialized",
          },
        ],
      }),
    );
    expect(wrapper.get('[data-test="assistant-message-meta"]').text()).toMatch(
      /^ada@example.com · /,
    );
    const chip = wrapper.get('[data-test="assistant-message-chip-log_row"]');
    expect(chip.text()).toContain("Log row · cart");
    expect(wrapper.find('[data-test="assistant-context-chip-remove"]').exists()).toBe(false);
  });

  it("renders a legacy record's delimiter blocks as attachment blocks, not text (CT-02 AC 9)", () => {
    const legacy: ChatMessage = {
      role: "user",
      content: raw('why?\n\n--- Log Entry ---\n{"a":1}\n--- end ---'),
    };
    const wrapper = mountMessage(legacy);
    expect(wrapper.get('[data-test="assistant-message-text"]').text()).toBe("why?");
    expect(wrapper.findAll('[data-test="assistant-attachment-block"]')).toHaveLength(1);
  });

  it("keeps a v2 message's typed text whole even when it looks like a block", () => {
    const typed = user({ content: raw("--- Log Entry ---\nx\n--- end ---") });
    expect(mountMessage(typed).findAll('[data-test="assistant-attachment-block"]')).toHaveLength(0);
  });

  it("shows the edited caption without B-12 (EB-09 AC 4) and image thumbnails with alt", () => {
    const wrapper = mountMessage(
      user({
        editedFrom: 3,
        images: [{ id: "i1", data: "AAAA", mimeType: "image/png", filename: "shot.png", size: 3 }],
      }),
    );
    expect(wrapper.get('[data-test="assistant-message-edited"]').text()).toBe(
      "Edited from message 3",
    );
    expect(wrapper.get('[data-test="assistant-message-image"] img').attributes("alt")).toBe(
      "shot.png",
    );
  });

  it("renders an answer flush under the mark, its text through the strict renderer", () => {
    const wrapper = mountMessage(
      answer([
        {
          type: "text",
          text: "## Checkout 5xx spike\n\n![x](https://evil.example/p.gif)\n\n```sql\nSELECT 1\n```",
        },
      ]),
    );
    expect(wrapper.attributes("data-test")).toBe("assistant-message-assistant");
    expect(wrapper.find('[data-test="assistant-mark"]').exists()).toBe(true);
    expect(wrapper.get("h2").text()).toBe("Checkout 5xx spike");
    expect(wrapper.element.querySelector("img")).toBeNull();
    const code = wrapper.get('[data-test="assistant-code-block"]');
    expect(code.attributes("aria-label")).toBe("Code, SQL");
    expect(code.attributes("data-query")).toBe("");
  });

  it("is aria-busy and streams only its last text block while live (HT-10 AC 3, EB-01 AC 4)", async () => {
    const blocks = [
      { type: "text" as const, text: "first part" },
      { type: "tool_call" as const, tool: "SearchSQL", call_id: "c1", stepState: "done" as const },
      { type: "text" as const, text: "stream" },
    ];
    const wrapper = mountMessage(answer(blocks), { live: true });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    const before = markdownParseCount();
    await wrapper.setProps({
      message: answer([...blocks.slice(0, 2), { type: "text", text: "streaming more" }]),
    });
    expect(markdownParseCount() - before).toBe(1);
    await wrapper.setProps({ live: false });
    expect(wrapper.attributes("aria-busy")).toBeUndefined();
  });

  it("says a policy refusal of a step in one quiet line (B-02 permission_denied)", () => {
    const wrapper = mountMessage(
      answer([
        {
          type: "tool_call",
          tool: "o2_UpdateAlert",
          stepState: "failed",
          errorType: "permission_denied_tool",
        },
      ]),
    );
    expect(wrapper.get('[data-test="assistant-block-policy"]').text()).toBe(
      "The assistant wasn't allowed to run o2_UpdateAlert.",
    );
  });

  it("renders a registered kind through its renderer, and counts an unregistered kind once", () => {
    const blocks = [{ type: "query" as const, text: "SELECT 1" }];
    mountMessage(answer(blocks));
    mountMessage(answer(blocks));
    expect(track.mock.calls.filter(([name]) => name === "ai_block_invalid")).toEqual([
      ["ai_block_invalid", { block_kind: "query" }],
    ]);
    registerBlockRenderer(
      "query",
      defineComponent({
        props: ["block"],
        setup: (props) => () => h("pre", { "data-test": "query-stub" }, props.block.text),
      }),
    );
    expect(mountMessage(answer(blocks)).get('[data-test="query-stub"]').text()).toBe("SELECT 1");
  });

  it("renders nothing for an outcome block; the transcript places it after the message", () => {
    const wrapper = mountMessage(answer([{ type: "turn_outcome", outcome: { kind: "stopped" } }]));
    expect(wrapper.find('[data-test="assistant-mark"]').exists()).toBe(false);
  });
});
