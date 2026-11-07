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
import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h } from "vue";

import i18n from "@/locales";
import { raw } from "@/types/i18n";

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => computed(() => ({ isAdmin: false })),
}));
vi.mock("@/components/ai-assistant/transcript/AssistantMessage.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "AssistantMessage",
    props: { message: { type: Object, required: true }, turnId: String, readonly: Boolean },
    setup: (props) => () =>
      h("div", { "data-test": "message", "data-readonly": String(props.readonly) }, [
        String((props.message as { content: string }).content),
      ]),
  }),
}));

import AssistantAgentOutput from "./AssistantAgentOutput.vue";

const mountOutput = (props: Record<string, unknown>, slots = {}) =>
  mount(AssistantAgentOutput, {
    props: { title: raw("On-call verdict"), ...props },
    slots,
    global: { plugins: [i18n] },
  });

describe("AssistantAgentOutput", () => {
  it("shows the sentence verbatim, server notes in body text with their tag, and masks the block", () => {
    const wrapper = mountOutput({
      kind: "oncall_verdict",
      sentence: "Likely the failover.",
      notes: [
        { text: "severity promoted P3 → P1: x", tag: raw("Severity raised to P1") },
        { text: "Sent as a follow-up.", meta: true },
      ],
    });
    expect(wrapper.attributes("data-dd-privacy")).toBe("mask");
    expect(wrapper.attributes("data-kind")).toBe("oncall_verdict");
    expect(wrapper.get('[data-test="agent-output-verdict"]').text()).toBe("Likely the failover.");
    const notes = wrapper.findAll('[data-test="agent-output-note"]');
    expect(notes).toHaveLength(2);
    expect(notes[0].get('[data-test="agent-output-note-tag"]').text()).toBe(
      "Severity raised to P1",
    );
    expect(notes[1].find('[data-test="agent-output-note-tag"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-output-report"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-output-confidence"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-output-evidence"]').exists()).toBe(false);
  });

  it("renders a report through the assistant's message renderer, read-only", async () => {
    const wrapper = mountOutput({ kind: "oncall_report", report: "## Cause" });
    await flushPromises();
    const message = wrapper.get('[data-test="message"]');
    expect(message.attributes("data-readonly")).toBe("true");
    expect(message.text()).toBe("## Cause");
  });

  it("shows a refusal as a neutral untagged line, and renders the door slot", () => {
    const wrapper = mountOutput(
      {
        kind: "oncall_verdict",
        sentence: "No verdict: not enough data.",
        refusal: true,
        tag: raw("Needs OK"),
      },
      { door: '<button data-test="door">Continue</button>' },
    );
    expect(wrapper.get('[data-test="agent-output-refusal"]').text()).toBe(
      "No verdict: not enough data.",
    );
    expect(wrapper.find('[data-test="agent-output-verdict"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-output-tag"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="door"]').exists()).toBe(true);
  });

  it("shows confidence and evidence only when the server sent them", () => {
    const wrapper = mountOutput({
      kind: "incident_report",
      sentence: "Disk full.",
      confidence: "high",
      evidence: [{ text: "df shows 100%" }],
    });
    expect(wrapper.get('[data-test="agent-output-confidence"]').text()).toBe("Confidence: high");
    expect(wrapper.get('[data-test="agent-output-evidence"]').text()).toContain("df shows 100%");
  });
});
