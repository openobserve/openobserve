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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import O2AIChatTranscript from "./O2AIChatTranscript.vue";

const messages: any[] = [
  { role: "user", content: "Show errors" },
  {
    role: "assistant",
    content: "Here they are",
    contentBlocks: [
      {
        type: "tool_call",
        tool: "SearchSQL",
        message: "Searching",
        success: true,
        summary: { count: 1 },
        navigationAction: { label: "Open", resource_type: "logs", action: "navigate_direct" },
      },
      {
        type: "navigation",
        navigationAction: { label: "Go", resource_type: "logs", action: "navigate_direct" },
      },
      { type: "text", text: "```sql\nSELECT 1\n```" },
    ],
  },
];

describe("O2AIChatTranscript", () => {
  it("renders every message read-only: no feedback, retry or navigation actions", () => {
    const w = mount(O2AIChatTranscript, { props: { messages } });
    expect(w.findAll(".message")).toHaveLength(2);
    expect(w.find(".tool-call-item").exists()).toBe(true);
    expect(w.find('[data-test="o2-ai-chat-thumbs-up-btn"]').exists()).toBe(false);
    expect(w.find(".retry-button").exists()).toBe(false);
    expect(w.find(".navigation-block").exists()).toBe(false);
    expect(w.find(".navigation-icon").exists()).toBe(false);
  });

  it("expands a tool call in place", async () => {
    const w = mount(O2AIChatTranscript, { props: { messages } });
    expect(w.find(".tool-call-details").exists()).toBe(false);
    await w.find(".tool-call-item").trigger("click");
    expect(w.find(".tool-call-details").exists()).toBe(true);
  });
});
