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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import { shownTurns } from "@/composables/assistant/historyRecords";
import { projectRecord, type StoredTurn } from "@/composables/assistant/record";
import { parseChatDetail } from "@/services/assistant";
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

// The app's entity routes as the real router nests them, under the `/web` base.
function entityRouter() {
  const blank = { render: () => null };
  return createRouter({
    history: createMemoryHistory("/web"),
    routes: [
      {
        path: "/",
        component: blank,
        children: [
          { path: "logs", name: "logs", component: blank },
          { path: "traces", name: "traces", component: blank },
          { path: "alerts/detail/:alert_id", name: "alertDetail", component: blank },
          { path: "/dashboards/view", name: "viewDashboard", component: blank },
          { path: "settings", name: "settings", component: blank },
        ],
      },
    ],
  });
}

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

  it("shows a legacy answer that has only message content and no blocks", async () => {
    const wrapper = mountMessage({
      role: "assistant",
      content: raw("The gateway ran out of connections."),
    });
    await flushPromises();
    expect(wrapper.text()).toContain("The gateway ran out of connections.");
    const typed = mountMessage(
      answer([{ type: "text", text: "Typed answer." }], { content: raw("Typed answer.") }),
    );
    await flushPromises();
    expect(typed.text().split("Typed answer.")).toHaveLength(2);
  });

  it("heads an answer with its agent only when that is not the default one", () => {
    const message = { role: "assistant", content: raw("hi") } as const;
    const handed = mount(AssistantMessage, {
      props: { message, turnId: "t1", agent: "sre", live: true },
    });
    expect(handed.get('[data-test="assistant-agent-identity"]').attributes("data-agent")).toBe(
      "sre",
    );
    const plain = mount(AssistantMessage, { props: { message, turnId: "t1", live: true } });
    expect(plain.find('[data-test="assistant-agent-identity"]').exists()).toBe(false);
  });

  it("says to whom only on the prompt that handed over", () => {
    const prompt = { role: "user", content: raw("q") } as const;
    const handed = mount(AssistantMessage, {
      props: { message: { ...prompt, agentId: "sre", handoffFrom: "o2-ai" }, turnId: "t1" },
    });
    expect(handed.get('[data-test="assistant-message-meta"]').text()).toContain(
      "· to Investigator",
    );
    const later = mount(AssistantMessage, {
      props: { message: { ...prompt, agentId: "sre" }, turnId: "t1" },
    });
    expect(later.find('[data-test="assistant-message-meta"]').exists()).toBe(false);
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

  it("keeps the range on the last turn's question line only, under a right-aligned tinted bubble", () => {
    const last = mountMessage(user());
    expect(last.find('[data-test="assistant-message-range"]').exists()).toBe(false);
    expect(last.classes()).toContain("items-end");
    const bubble = last.get('[data-test="assistant-message-text"]');
    expect(bubble.classes()).toEqual(
      expect.arrayContaining([
        "bg-assistant-user-bg",
        "rounded-[1.125rem]",
        "rounded-ee-default",
        "max-w-[80%]",
        "text-text-body",
      ]),
    );
    const wrapper = mount(AssistantMessage, {
      props: { message: user(), turnId: "t1", rangeLabel: raw("Last 1 h") },
    });
    expect(wrapper.get('[data-test="assistant-message-range"]').text()).toContain("Last 1 h");
    expect(wrapper.get('[data-test="assistant-message-meta"]').classes()).toContain("text-end");
  });

  it("keeps a sent message's action row at a fixed height, its time shown on hover or focus", () => {
    const wrapper = mount(AssistantMessage, {
      props: { message: user(), turnId: "t1" },
      slots: { actions: '<div data-test="prompt-actions" />' },
    });
    const line = wrapper.get('[data-test="assistant-message-user-line"]');
    expect(line.classes()).toContain("min-h-6");
    expect(line.find('[data-test="prompt-actions"]').exists()).toBe(true);
    expect(line.get('[data-test="assistant-message-user-time"]').classes()).toEqual(
      expect.arrayContaining(["opacity-0", "group-hover/message:opacity-100"]),
    );
  });

  it("heads an answer with the mark and agent name only when it is the first of its run", () => {
    const answer: ChatMessage = { role: "assistant", content: raw("Hi"), contentBlocks: [] };
    const first = mount(AssistantMessage, { props: { message: answer, turnId: "a", head: true } });
    expect(first.get('[data-test="assistant-agent-identity"]').attributes("data-agent")).toBe(
      "o2-ai",
    );
    const next = mount(AssistantMessage, { props: { message: answer, turnId: "b" } });
    expect(next.find('[data-test="assistant-message-head"]').exists()).toBe(false);
  });

  it("places the range line and then the sent-context line below the bubble", () => {
    const wrapper = mount(AssistantMessage, {
      props: {
        message: user({
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
        turnId: "t1",
        rangeLabel: raw("Last 1 h"),
      },
    });
    const order = ["text", "meta", "chips"].map(
      (id) => wrapper.get(`[data-test="assistant-message-${id}"]`).element,
    );
    expect(
      order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(order[0].contains(order[1])).toBe(false);
    expect(wrapper.get('[data-test="assistant-message-meta"]').text()).toBe(
      "Last 1 h · ada@example.com",
    );
    expect(wrapper.get('[data-test="assistant-message-chips"]').classes()).toContain("justify-end");
  });

  it("shows the user's text as plain text, never Markdown, with its time on the answer line (`30` §2.1)", () => {
    const wrapper = mountMessage(user());
    const body = wrapper.get('[data-test="assistant-message-text"]');
    expect(body.text()).toBe("**not bold** <img src=x onerror=alert(1)>");
    expect(body.element.querySelector("strong, img")).toBeNull();
    expect(body.classes()).toContain("whitespace-pre-wrap");
    expect(wrapper.find('[data-test="assistant-message-meta"]').exists()).toBe(false);
    expect(wrapper.attributes("data-test")).toBe("assistant-message-user");
    const reply = mountMessage(answer([{ type: "text", text: "a" }]), {
      turn: { prompt: user() } as never,
    });
    expect(reply.get('[data-test="assistant-answer-time"]').text()).toMatch(/\d{2}:\d{2}$/);
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
    expect(wrapper.get('[data-test="assistant-message-meta"]').text()).toBe("ada@example.com");
    expect(wrapper.get('[data-test="assistant-message-chips"]').text()).toBe("Log row · cart");
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
    expect(wrapper.get("h2").text()).toBe("Checkout 5xx spike");
    expect(wrapper.element.querySelector("img")).toBeNull();
    // A closed SQL fence is a runnable query block, never a code block with a Retry.
    const block = wrapper.get('[data-test="assistant-query-block"]');
    expect(block.attributes("role")).toBe("group");
    expect(block.get('[data-test="assistant-query-text-lang"]').text()).toBe("SQL");
    expect(wrapper.find('[data-test="assistant-code-block"]').exists()).toBe(false);
  });

  it("keeps a closed non-query fence as a copyable code block", () => {
    const wrapper = mountMessage(answer([{ type: "text", text: "```bash\nls\n```" }]));
    expect(wrapper.get('[data-test="assistant-code-block"]').attributes("aria-label")).toBe(
      "Code, Bash",
    );
  });

  it("gives a JSON fence the padded chrome and upper-case label the query cards have", () => {
    const wrapper = mountMessage(answer([{ type: "text", text: '```json\n{"a": 1}\n```' }]));
    const block = wrapper.get('[data-test="assistant-code-block"]');
    expect(block.text()).toContain("JSON");
    expect(block.find("pre").classes().join(" ")).toMatch(/\bp[xs]?-/);
  });

  it("sets only the opening paragraph as the lead, not the prose after a code fence", () => {
    const wrapper = mountMessage(
      answer([{ type: "text", text: "Lead line.\n\n```json\n{}\n```\n\nClosing paragraph." }]),
    );
    const parts = wrapper.findAll(
      '[data-test="assistant-block-text"] > :not([data-test="assistant-code-block"])',
    );
    const html = parts.map((part) => part.html());
    expect(html.filter((h) => h.includes("font-semibold"))).toHaveLength(1);
    expect(html.find((h) => h.includes("Closing paragraph."))).not.toContain("font-semibold");
  });

  it("B-conversation-17: sets only the lead sentence semibold, never a callout's paragraph or the rest of the lead paragraph", () => {
    const text = [
      "Checkout fails because **inventory** resets connections. The db pool is full at **5xx** peaks.",
      "",
      "> **Root cause:** the db pool is exhausted.",
      "",
      "> **Next step:** raise the pool size.",
    ].join("\n");
    const wrapper = mountMessage(answer([{ type: "text", text }]));
    const leads = wrapper.findAll('[data-test="assistant-lead"]');
    expect(leads).toHaveLength(1);
    expect(leads[0].text()).toBe("Checkout fails because inventory resets connections.");
    expect(leads[0].classes()).toEqual(expect.arrayContaining(["font-semibold"]));
    const html = wrapper.get('[data-test="assistant-block-text"]').html();
    expect(html).not.toMatch(/p:first-child\]:font-semibold/);
    const callouts = wrapper.findAll("blockquote, [class*='assistant-callout']");
    for (const callout of callouts)
      expect(callout.find('[data-test="assistant-lead"]').exists()).toBe(false);
  });

  it("B-conversation-19: renders same-origin app links as entity links with their type glyph, first mention only", () => {
    const o = window.location.origin;
    const text = [
      `Errors start in [checkout](${o}/web/traces?org_identifier=default&tab=services-catalog&service=checkout), `,
      `logged to [ta_logs](/web/logs?org_identifier=default&stream_type=logs&stream=ta_logs). `,
      `See [Checkout board](/web/dashboards/view?org_identifier=default&dashboard=d1) and `,
      `[checkout_5xx](/web/alerts/detail/a1?org_identifier=default). [checkout](${o}/web/traces?org_identifier=default&tab=services-catalog&service=checkout) again; `,
      `[settings](/web/settings) is no entity.`,
    ].join("");
    const wrapper = mount(AssistantMessage, {
      props: {
        message: answer([{ type: "text", text }]),
        turnId: "t1",
        turn: { prompt: user(), org: "chat-org" } as never,
      },
      global: { plugins: [entityRouter()] },
      attachTo: document.body,
    });
    const links = wrapper.findAll("a[data-entity]");
    expect(links.map((a) => [a.text(), a.attributes("data-entity")])).toEqual([
      ["checkout", "service"],
      ["ta_logs", "stream"],
      ["Checkout board", "dashboard"],
      ["checkout_5xx", "alert"],
    ]);
    expect(links[1].attributes("href")).toBe(
      "/web/logs?stream=ta_logs&stream_type=logs&period=15m&type=ai_chat_query&org_identifier=chat-org",
    );
    expect(links[0].attributes("target")).toBeUndefined();
    for (const link of links) expect(link.find("span").classes()).toContain("bg-current");
    expect(wrapper.findAll("a").map((a) => a.text())).not.toContain("settings");
  });

  it.each([
    ["a chat of another org", { org: "other-org" }],
    ["a page whose evidence cannot open", { openable: false }],
  ])("SR-03: renders entity links as text in %s", (_, patch) => {
    const evidence = fakeEvidence();
    const text = `Errors start in [ta_logs](/web/logs?stream=ta_logs&stream_type=logs).`;
    const wrapper = mount(AssistantMessage, {
      props: {
        message: answer([{ type: "text", text }]),
        turnId: "t1",
        turn: evidence.turn(patch),
      },
      global: { plugins: [entityRouter()], provide: evidence.provide },
      attachTo: document.body,
    });
    expect(wrapper.findAll("a")).toHaveLength(0);
    expect(wrapper.text()).toContain("Errors start in ta_logs.");
  });

  it("SR-03: keeps entity links in a chat of the current org", () => {
    const evidence = fakeEvidence();
    const text = `Errors start in [ta_logs](/web/logs?stream=ta_logs&stream_type=logs).`;
    const wrapper = mount(AssistantMessage, {
      props: { message: answer([{ type: "text", text }]), turnId: "t1", turn: evidence.turn() },
      global: { plugins: [entityRouter()], provide: evidence.provide },
      attachTo: document.body,
    });
    expect(wrapper.get("a[data-entity]").attributes("href")).toContain("org_identifier=default");
  });

  it("drops the navigation link line for a query the answer already shows as a card", () => {
    const sql = "SELECT service FROM logs WHERE code >= 500 ORDER BY service";
    const wrapper = mountMessage(
      answer([
        {
          type: "link",
          link: {
            resourceType: "logs",
            action: "load_query",
            label: "Open in Logs",
            target: { query: sql, sql_mode: true, stream: "logs", from: 1, to: 2 },
          },
        } as never,
        {
          type: "text",
          text: "```sql\nSELECT service\nFROM logs\nWHERE code >= 500\nORDER BY service\n```",
        },
      ]),
    );
    expect(wrapper.find('[data-test="assistant-query-block"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-link-card"]').exists()).toBe(false);
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

  it('B-approvals-rca-16: the decided record follows the model\'s "I proposed …" text, as a reloaded chat stores it', () => {
    const detail = parseChatDetail(
      JSON.parse(
        readFileSync(
          join(
            __dirname,
            "../../../composables/assistant/__fixtures__/history/decided-approval.json",
          ),
          "utf8",
        ),
      ),
    );
    const messages = projectRecord(shownTurns(detail, detail.turns as StoredTurn[]), "owner", {
      timezone: "UTC",
      approvals: detail.approvals,
    });
    registerBlockRenderer(
      "approval_result",
      defineComponent({ setup: () => () => h("p", { "data-test": "record-stub" }, "record") }),
    );
    const wrapper = mountMessage(messages.find((m) => m.role === "assistant")!);
    const html = wrapper.html();
    expect(html.indexOf("I proposed")).toBeGreaterThan(-1);
    expect(html.indexOf('data-test="record-stub"')).toBeGreaterThan(html.indexOf("I proposed"));
    expect(wrapper.text()).toContain('tester description v6".');
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
      { path: "/incidents", name: "incidentList", component: { render: () => null } },
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

    it("B-shell3-6: a reloaded door follow-up's stored query card keeps the window its step ran on", async () => {
      const detail = parseChatDetail(
        JSON.parse(
          readFileSync(
            join(
              __dirname,
              "../../../composables/assistant/__fixtures__/history/door-followup.json",
            ),
            "utf8",
          ),
        ),
      );
      const messages = projectRecord(shownTurns(detail, detail.turns as StoredTurn[]), "owner", {
        timezone: "UTC",
      });
      const prompt = messages.findLast((m) => m.role === "user")!;
      const reply = messages.at(-1)!;
      expect(prompt.sentWindow).toEqual({ from: 1_794_240_205_000, to: 1_794_241_105_000 });
      const evidence = fakeEvidence();
      const wrapper = mount(AssistantMessage, {
        props: { message: reply, turnId: "t1", turn: evidence.turn({ prompt }) },
        attachTo: document.body,
        global: { plugins: [fakeRouter(routes)], provide: evidence.provide },
      });
      await flushPromises();
      const cards = wrapper.findAll('[data-test="assistant-query-block"]');
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(card.text()).not.toContain("range: unknown");
        expect(card.attributes("aria-label")).not.toContain("range: unknown");
      }
    });

    it("runs no trail: the steps are rows of the queries line, after the text", () => {
      const wrapper = mountLive([
        { type: "text", text: "before" },
        ...steps,
        { type: "text", text: "after" },
      ]);
      expect(wrapper.find('[data-test="assistant-steps"]').exists()).toBe(false);
      const group = wrapper.get('[data-test="assistant-queries-group"]').element;
      const texts = wrapper.findAll('[data-test="assistant-block-text"]');
      expect(
        texts.at(-1)!.element.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
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
        ["assistant-claim-2", "call_3"],
        ["assistant-claim-2", "call_3"],
        ["assistant-claim-1", "call_1"],
      ]);
      expect(chips.every((chip) => chip.closest("p span[data-claim]"))).toBe(true);
      expect(root.querySelector("p")?.textContent?.replace(/\s+/g, " ")).toBe(
        "Reset by peer2 and2, see1.",
      );
    });

    it("never counts a cited write behind its card as a citation an admin must unlock", async () => {
      const wrapper = mountLive([
        ...steps,
        { type: "tool_call", tool: "o2_alert_mute", call_id: "call_9", pendingConfirmation: true },
        { type: "text", text: "Paused it [^call_9], checked [^call_1], lost [^call_7]." },
      ]);
      await flushPromises();
      expect(wrapper.get('[data-test="assistant-queries-no-access"]').text()).toMatch(
        /^1 citation unavailable/,
      );
      const plain = mountLive([
        ...steps,
        { type: "tool_call", tool: "o2_alert_mute", call_id: "call_9", pendingConfirmation: true },
        { type: "text", text: "Paused it [^call_9], checked [^call_1]." },
      ]);
      await flushPromises();
      expect(plain.find('[data-test="assistant-queries-no-access"]').exists()).toBe(false);
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
        { type: "text", text: "See [it](/incidents) and [out](/logout)." },
      ]);
      const card = wrapper.get('[data-test="assistant-link-card"]');
      expect(card.attributes("data-source")).toBe("markdown");
      expect(card.text()).toContain("Link in the answer");
      expect(wrapper.findAll('[data-test="assistant-link-card"]')).toHaveLength(1);
      expect(wrapper.find('a[href*="logout"]').exists()).toBe(false);
    });

    it("gives the first text the conclusion's weight, and leaves it to the findings when they exist", () => {
      const plain = mountLive([{ type: "text", text: "Checkout returned 121 errors." }]);
      expect(plain.get('[data-test="assistant-block-text"]').html()).toContain("text-text-heading");
      const withFindings = mountLive([
        { type: "text", text: "Some context." },
        {
          type: "findings",
          findings: {
            likelyCause: "Redis pool",
            confidence: "low",
            evidence: [],
            ruledOut: [],
            unknowns: [],
            nextSteps: [],
          },
        },
      ]);
      expect(withFindings.get('[data-test="assistant-block-text"]').html()).not.toContain(
        "text-text-heading",
      );
      const order = Array.from(
        withFindings.element.querySelectorAll(
          '[data-test="assistant-findings"], [data-test="assistant-block-text"]',
        ),
      ).map((el) => el.getAttribute("data-test"));
      expect(order).toEqual(["assistant-findings", "assistant-block-text"]);
    });

    it("drops the bare Findings label the cut-out findings fence leaves behind, never a sentence", () => {
      const card = {
        type: "findings" as const,
        findings: {
          likelyCause: "Redis pool",
          confidence: "low" as const,
          evidence: [],
          ruledOut: [],
          unknowns: [],
          nextSteps: [],
        },
      };
      const texts = (blocks: Parameters<typeof mountLive>[0]) =>
        mountLive(blocks)
          .findAll('[data-test="assistant-block-text"]')
          .map((el) => el.text().trim());
      expect(
        texts([{ type: "text", text: "Rests on 41 requests.\n\nFindings\n\n\n\n" }, card]),
      ).toEqual(["Rests on 41 requests."]);
      for (const label of ["**Findings**", "## Findings", "Findings:"])
        expect(texts([{ type: "text", text: `Flat.\n\n${label}\n` }, card])).toEqual(["Flat."]);
      expect(texts([card, { type: "text", text: "Findings" }])).toEqual([]);
      const kept = "Findings show the error rate is flat.";
      expect(texts([{ type: "text", text: kept }, card])).toEqual([kept]);
      expect(texts([{ type: "text", text: "Our findings" }, card])).toEqual(["Our findings"]);
      expect(texts([{ type: "text", text: "Done.\n\nFindings" }])[0]).toContain("Findings");
    });

    it("puts the live line above the text, under the question", () => {
      const wrapper = mount(AssistantMessage, {
        props: {
          message: answer([{ type: "text", text: "partial" }]),
          turnId: "t1",
          live: true,
        },
        slots: { status: '<p data-test="status">live</p>' },
      });
      const status = wrapper.get('[data-test="status"]').element;
      const text = wrapper.get('[data-test="assistant-block-text"]').element;
      expect(status.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("adds the answer line only once the turn is done, never with feedback", () => {
      const blocks = [
        ...steps,
        { type: "text" as const, text: "x" },
        { type: "footer" as const, footer: { traceId: "t" } },
      ];
      const done = mount(AssistantMessage, {
        props: { message: answer(blocks, { sentAt: 0 }), turnId: "t1" },
        slots: { actions: '<button data-test="actions">a</button>' },
      });
      const line = done.get('[data-test="assistant-answer-line"]');
      expect(line.find('[data-test="actions"]').exists()).toBe(true);
      expect(line.find('[data-test="assistant-answer-time"]').exists()).toBe(true);
      const trigger = done.get('[data-test="assistant-queries-line"]').element;
      expect(trigger.parentElement?.contains(line.element)).toBe(true);
      expect(done.find('[data-test="assistant-feedback"]').exists()).toBe(false);
      const live = mount(AssistantMessage, {
        props: { message: answer(blocks, { sentAt: 0 }), turnId: "t1", live: true },
      });
      expect(live.find('[data-test="assistant-answer-line"]').exists()).toBe(false);
    });
  });
});
