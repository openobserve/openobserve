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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantFindings from "./AssistantFindings.vue";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: (...args: unknown[]) => track(...args),
}));

const findings: ContentBlock = {
  type: "findings",
  findings: {
    likelyCause: "payments pool exhausted",
    confidence: "medium",
    evidence: [
      { text: "92% of errors are resets", callId: "call_3", kind: "verified" },
      { text: "matches the pool ceiling", kind: "inferred" },
    ],
    ruledOut: ["recent deploy"],
    unknowns: [],
    nextSteps: ["check max-connections"],
  },
};

const message = (block: ContentBlock): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: [
    {
      type: "tool_call",
      tool: "SearchSQL",
      call_id: "call_3",
      stepState: "done",
      context: { stream_name: "default" },
    },
    block,
  ],
});

describe("AssistantFindings", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    track.mockReset();
  });

  const mountCard = (block: ContentBlock, turn: Record<string, unknown> = {}, readonly = false) => {
    const evidence = fakeEvidence();
    const wrapper = mount(AssistantFindings, {
      props: {
        block,
        blockId: `b-${Math.random()}`,
        message: message(block),
        readonly,
        turn: evidence.turn(turn),
      },
      attachTo: document.body,
      global: { provide: readonly ? {} : evidence.provide },
    });
    return { wrapper, ...evidence };
  };

  it("is a section named Findings with its sections in order and empty ones omitted", () => {
    const { wrapper } = mountCard(findings);
    const section = wrapper.get('[data-test="assistant-findings"]');
    expect(section.element.tagName).toBe("SECTION");
    expect(section.find(`#${section.attributes("aria-labelledby")}`).text()).toBe("Findings");
    expect(wrapper.get('[data-test="assistant-findings-cause"]').text()).toBe(
      "payments pool exhausted",
    );
    expect(wrapper.text()).toContain("Confidence: medium");
    expect(wrapper.find('[data-test="assistant-findings-unknown"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-findings-ruled-out"]').exists()).toBe(true);
  });

  it("keeps every sub-section in one body, so stacked sections never squeeze each other", () => {
    const { wrapper } = mountCard(findings);
    const card = wrapper.get('[data-test="assistant-findings"]').element;
    const bodies = Array.from(card.querySelectorAll("h4"), (heading) =>
      heading.closest(".min-h-0"),
    );
    expect(bodies.length).toBeGreaterThan(2);
    expect(bodies[0]).not.toBeNull();
    expect(new Set(bodies).size).toBe(1);
  });

  it("announces a failed outcome, clears the pick and retries it from Try again", async () => {
    const { wrapper, host, sid } = mountCard(findings);
    host.dispatch.mockResolvedValueOnce({ ok: false, reason: "failed" } as never);
    await wrapper.get('[data-test="assistant-findings-outcome-yes"]').trigger("click");
    await flushPromises();
    expect(host.announce).toHaveBeenCalledWith(sid, "Couldn't send that. Try again.");
    expect(
      wrapper.get('[data-test="assistant-findings-outcome-yes"]').attributes("data-state"),
    ).not.toBe("on");
    await wrapper.get('[data-test="assistant-findings-retry"]').trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenLastCalledWith(sid, {
      kind: "feedback",
      messageId: "t1",
      vote: "up",
      reason: "cause:yes",
    });
    expect(host.announce).toHaveBeenLastCalledWith(
      sid,
      "Thanks, that helps calibrate the assistant",
    );
  });

  it("tells verified from inferred in words, and only verified evidence gets a chip", () => {
    const { wrapper } = mountCard(findings);
    const items = wrapper.findAll('[data-test="assistant-findings-evidence"] li');
    expect(items[0].text()).toContain("Verified by query");
    expect(items[0].find('[data-test="assistant-claim-1"]').exists()).toBe(true);
    expect(items[1].text()).toContain("Inferred");
    expect(items[1].find('[data-test^="assistant-claim-"]').exists()).toBe(false);
  });

  it("states an inconclusive result and asserts no cause", () => {
    const inconclusive = {
      ...findings,
      findings: { ...findings.findings!, confidence: "inconclusive" as const },
    };
    const { wrapper } = mountCard(inconclusive);
    expect(wrapper.get('[data-test="assistant-findings-inconclusive"]').text()).toBe(
      "Inconclusive: the assistant couldn't confirm a cause",
    );
    expect(wrapper.find('[data-test="assistant-findings-cause"]').exists()).toBe(false);
  });

  it("falls back to a notice and counts an invalid payload once, with no content", () => {
    mountCard({ type: "findings", findings: null });
    expect(document.body.textContent).toContain("Findings could not be shown as a card");
    expect(track).toHaveBeenCalledWith("ai_block_invalid", { block_kind: "findings" });
  });

  it("asks Was this the cause? on done only, and No opens an optional comment before sending", async () => {
    const { wrapper, host } = mountCard(findings);
    await wrapper.get('[data-test="assistant-findings-outcome-no"]').trigger("click");
    expect(host.dispatch).not.toHaveBeenCalled();
    await wrapper.get('[data-test="assistant-findings-comment"] textarea').setValue("dns");
    await wrapper.get('[data-test="assistant-findings-send"]').trigger("click");
    await flushPromises();
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "feedback",
      messageId: "t1",
      vote: "down",
      reason: "cause:no",
      comment: "dns",
    });
    expect(
      mountCard(findings, { outcome: "stopped" })
        .wrapper.find('[data-test="assistant-findings-outcome"]')
        .exists(),
    ).toBe(false);
    expect(
      mountCard(findings, {}, true)
        .wrapper.find('[data-test="assistant-findings-outcome"]')
        .exists(),
    ).toBe(false);
  });
});
