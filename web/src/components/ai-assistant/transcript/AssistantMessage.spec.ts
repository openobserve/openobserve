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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import { fakeRouter } from "../__tests__/fakeAssistant";
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
    // A closed SQL fence is a runnable query block, never a code block with a Retry.
    const block = wrapper.get('[data-test="assistant-query-block"]');
    expect(block.attributes("role")).toBe("group");
    expect(block.get('[data-test="assistant-query-language"]').text()).toBe("SQL");
    expect(wrapper.find('[data-test="assistant-code-block"]').exists()).toBe(false);
  });

  it("keeps a closed non-query fence as a copyable code block", () => {
    const wrapper = mountMessage(answer([{ type: "text", text: "```bash\nls\n```" }]));
    expect(wrapper.get('[data-test="assistant-code-block"]').attributes("aria-label")).toBe(
      "Code, Bash",
    );
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

  it("says a policy refusal of a step as a quiet notice with its detail", () => {
    const wrapper = mountMessage(
      answer([
        {
          type: "tool_call",
          tool: "o2_UpdateAlert",
          stepState: "failed",
          errorType: "permission_denied_tool",
          details: { detail: "Writes are off for this organization.", policy: "admin" },
        },
      ]),
    );
    const notice = wrapper.get('[data-test="assistant-permission-denied"]');
    expect(notice.text()).toContain(
      "Blocked by policy: o2_UpdateAlert. Writes are off for this organization.",
    );
    expect(notice.text()).toContain("An admin can allow it in Settings › Assistant › Permissions.");
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

  it("captions a Re-run prompt with the window it evaluates", () => {
    const from = Date.UTC(2026, 9, 14, 8, 40);
    const wrapper = mountMessage(user({ rerunFor: { from, to: from + 15 * 60_000 } }));
    expect(wrapper.get('[data-test="assistant-message-rerun"]').text()).toMatch(
      /^Re-run for \d\d:\d\d–\d\d:\d\d \S+$/,
    );
  });

  describe("evidence", () => {
    const routes = [
      { path: "/dashboards/view", name: "viewDashboard", component: { render: () => null } },
      { path: "/logout", name: "logout", component: { render: () => null } },
    ];
    const steps: NonNullable<ChatMessage["contentBlocks"]> = [
      { type: "tool_call", tool: "StreamList", call_id: "call_1", stepState: "done" },
      {
        type: "tool_call",
        tool: "SearchSQL",
        call_id: "call_3",
        stepState: "done",
        context: { stream_name: "default" },
      },
    ];
    const mountLive = (
      blocks: NonNullable<ChatMessage["contentBlocks"]>,
      turn: Record<string, unknown> = {},
    ) => {
      const evidence = fakeEvidence();
      return mount(AssistantMessage, {
        props: { message: answer(blocks), turnId: "t1", turn: evidence.turn(turn) },
        attachTo: document.body,
        global: { plugins: [fakeRouter(routes)], provide: evidence.provide },
      });
    };

    it("puts the trail first, before the text it explains", () => {
      const wrapper = mountLive([
        { type: "text", text: "before" },
        ...steps,
        { type: "text", text: "after" },
      ]);
      const order = Array.from(
        wrapper.element.querySelectorAll(
          '[data-test="assistant-steps"], [data-test="assistant-block-text"]',
        ),
      ).map((el) => el.getAttribute("data-test"));
      expect(order).toEqual(["assistant-steps", "assistant-block-text", "assistant-block-text"]);
    });

    it("renders claim markers as numbered chips inside the sentence, never the raw marker", async () => {
      const wrapper = mountLive([
        ...steps,
        { type: "text", text: "Reset by peer [^call_3] and [^call_3], see [^call_1]." },
      ]);
      await flushPromises();
      const root = wrapper.element as HTMLElement;
      expect(root.textContent).not.toContain("[^");
      const chips = Array.from(
        root.querySelectorAll<HTMLElement>('[data-test^="assistant-claim-"]'),
      );
      expect(chips.map((chip) => [chip.dataset.test, chip.dataset.callId])).toEqual([
        ["assistant-claim-1", "call_3"],
        ["assistant-claim-1", "call_3"],
        ["assistant-claim-2", "call_1"],
      ]);
      expect(chips.every((chip) => chip.closest("p span[data-claim]"))).toBe(true);
      expect(root.querySelector("p")?.textContent?.replace(/\s+/g, " ")).toBe(
        "Reset by peer1 and1, see2.",
      );
    });

    it("turns a navigation frame into one link card, deduped against the same Markdown link", () => {
      const wrapper = mountLive([
        {
          type: "link",
          link: {
            resourceType: "dashboard",
            action: "navigate_direct",
            target: { dashboard_id: "checkout", folder: "default" },
          },
        },
        {
          type: "text",
          text: "See [it](/dashboards/view?dashboard=checkout&folder=default) and [out](/logout).",
        },
      ]);
      const cards = wrapper.findAll('[data-test="assistant-link-card"]');
      expect(cards).toHaveLength(1);
      expect(cards[0].attributes("data-source")).toBe("navigation");
    });

    it("renders a redacted link with the fixed label and no query, stream, window or Open", () => {
      const wrapper = mountMessage(
        answer([
          {
            type: "link",
            link: { resourceType: "logs", action: "load_query", target: {}, redacted: true },
          },
        ]),
        { readonly: true },
      );
      const card = wrapper.get('[data-test="assistant-link-card"]');
      expect(card.attributes("data-kind")).toBe("redacted");
      expect(card.get('[data-test="assistant-link-card-title"]').text()).toBe(
        "A linked view (details hidden)",
      );
      expect(card.attributes("aria-label")).toBe("A linked view (details hidden)");
      expect(card.find('[data-test="assistant-link-card-details"]').exists()).toBe(false);
      expect(card.find("button, a").exists()).toBe(false);
    });

    it("offers an allowlisted Markdown link as a captioned card and the rest as text", () => {
      const wrapper = mountLive([
        { type: "text", text: "See [it](/dashboards/view?dashboard=checkout) and [out](/logout)." },
      ]);
      const card = wrapper.get('[data-test="assistant-link-card"]');
      expect(card.attributes("data-source")).toBe("markdown");
      expect(card.text()).toContain("Link in the answer");
      expect(wrapper.findAll('[data-test="assistant-link-card"]')).toHaveLength(1);
      expect(wrapper.find('a[href*="logout"]').exists()).toBe(false);
    });

    it("adds the footer and feedback only once the turn is done", () => {
      const blocks = [
        ...steps,
        { type: "text" as const, text: "x" },
        { type: "footer" as const, footer: { traceId: "t" } },
      ];
      const done = mountLive(blocks);
      expect(done.find('[data-test="assistant-feedback"]').exists()).toBe(true);
      expect(done.find('[data-test="assistant-turn-footer"]').exists()).toBe(true);
      const live = mountLive(blocks, { outcome: "live" });
      expect(live.find('[data-test="assistant-feedback"]').exists()).toBe(false);
      expect(live.find('[data-test="assistant-turn-footer"]').exists()).toBe(false);
    });
  });
});
