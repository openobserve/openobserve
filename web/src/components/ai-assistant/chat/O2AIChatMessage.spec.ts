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

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

import O2AIChatMessage from "./O2AIChatMessage.vue";

const assistant = (extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: "Answer",
  blocks: [],
  contentBlocks: [
    {
      type: "tool_call",
      tool: "SearchSQL",
      message: "Searching",
      success: true,
      summary: { count: 1 },
      navigationAction: { label: "Open", page: "logs", params: {} },
    },
    { type: "log_entry", preview: "preview", content: '{"a":1}' },
    { type: "navigation", navigationAction: { label: "Go", page: "logs", params: {} } },
    { type: "text", text: "```sql\nSELECT 1\n```" },
  ],
  ...extra,
});

function mountMessage(message: any, extra: Record<string, unknown> = {}) {
  return mount(O2AIChatMessage, {
    global: { plugins: [i18n] },
    props: {
      message,
      index: 7,
      isLoading: false,
      currentAnalyzingMessage: "Thinking",
      expandedToolCalls: new Set<string>(),
      expandedLogEntries: new Set<string>(),
      ...extra,
    },
  });
}

describe("O2AIChatMessage", () => {
  it("forwards toggle events with the block index, never the message index", async () => {
    const w = mountMessage(assistant());
    await w.find(".tool-call-item").trigger("click");
    await w.find(".log-entry-item").trigger("click");
    expect(w.emitted("toggle-tool-call")).toEqual([[0]]);
    expect(w.emitted("toggle-log-entry")).toEqual([[1]]);
  });

  it("uses the message-scoped positional keys for expansion", () => {
    const hit = mountMessage(assistant(), {
      expandedToolCalls: new Set(["7-0"]),
      expandedLogEntries: new Set(["7-1"]),
    });
    expect(hit.find(".tool-call-details").exists()).toBe(true);
    expect(hit.find(".log-entry-details").exists()).toBe(true);

    const miss = mountMessage(assistant(), {
      expandedToolCalls: new Set(["0-7"]),
      expandedLogEntries: new Set(["1-7"]),
    });
    expect(miss.find(".tool-call-details").exists()).toBe(false);
    expect(miss.find(".log-entry-details").exists()).toBe(false);
  });

  it("emits navigate from both the tool-call icon and the navigation block", async () => {
    const w = mountMessage(assistant());
    await w.find(".navigation-icon").trigger("click");
    await w.find(".navigation-block-btn").trigger("click");
    expect(w.emitted("navigate")).toEqual([
      [{ label: "Open", page: "logs", params: {} }],
      [{ label: "Go", page: "logs", params: {} }],
    ]);
  });

  it("emits retry with the message and like/dislike without arguments", async () => {
    const message = assistant();
    const w = mountMessage(message);
    await w.find(".retry-button").trigger("click");
    await w.find('[data-test="o2-ai-chat-thumbs-up-btn"]').trigger("click");
    await w.find('[data-test="o2-ai-chat-thumbs-down-btn"]').trigger("click");
    expect(w.emitted("retry")?.[0][0]).toStrictEqual(message);
    expect(w.emitted("like")).toEqual([[]]);
    expect(w.emitted("dislike")).toEqual([[]]);
  });

  it("shows the inline loader only for an empty assistant message while loading", () => {
    const empty = { role: "assistant", content: "", blocks: [], contentBlocks: [] };
    expect(mountMessage(empty, { isLoading: true }).find(".inline-loading").text()).toBe("Thinking");
    expect(mountMessage(empty).find(".inline-loading").exists()).toBe(false);
  });

  it("emits preview-image for user images and marks error messages", async () => {
    const img = { filename: "a.png", mimeType: "image/png", data: "AAAA", size: 1 };
    const w = mountMessage({
      role: "user",
      content: "Error: bad",
      images: [img],
      blocks: [{ type: "text", content: "Error: bad" }],
      contentBlocks: [],
    });
    expect(w.classes()).toEqual(expect.arrayContaining(["message", "user", "error-message"]));
    await w.find(".message-image-item img").trigger("click");
    expect(w.emitted("preview-image")).toEqual([[img]]);
  });
});
