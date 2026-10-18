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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackAssistant } from "@/services/assistantAnalytics";

import AssistantComposerHints from "./AssistantComposerHints.vue";

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

enableAutoUnmount(afterEach);

describe("AssistantComposerHints", () => {
  it("is a named icon button that opens the three registry rows through OShortcut (CT-09 AC 8)", async () => {
    const wrapper = mount(AssistantComposerHints, { attachTo: document.body });
    const trigger = wrapper.get('[data-test="assistant-composer-hints"]');
    expect(trigger.attributes("aria-label")).toBe("Keyboard shortcuts");
    await trigger.trigger("click");
    await flushPromises();
    const rows = [...document.body.querySelectorAll('[data-test^="assistant-composer-hint-"]')].map(
      (row) => [row.getAttribute("data-test"), row.textContent?.replace(/\s+/g, " ").trim()],
    );
    expect(rows).toEqual([
      ["assistant-composer-hint-assistantComposerSend", expect.stringContaining("Send message")],
      ["assistant-composer-hint-assistantComposerNewline", expect.stringContaining("New line")],
      [
        "assistant-composer-hint-assistantComposerRecall",
        expect.stringContaining("Recall previous prompt"),
      ],
    ]);
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_inspected", { target: "hints" });
  });

  it("shows the label Keys in the roomy full view", () => {
    const wrapper = mount(AssistantComposerHints, { props: { labelled: true } });
    expect(wrapper.get('[data-test="assistant-composer-hints"]').text()).toBe("Keys");
  });
});
