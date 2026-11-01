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
    track.mockClear();
  });

  const mountFindings = (block: ContentBlock, extra: ContentBlock[] = []) => {
    const evidence = fakeEvidence();
    const base = message(block);
    const wrapper = mount(AssistantFindings, {
      props: {
        block,
        blockId: "t1:0",
        message: { ...base, contentBlocks: [...base.contentBlocks!, ...extra] },
        turn: evidence.turn(),
      },
      attachTo: document.body,
      global: { provide: evidence.provide },
    });
    return wrapper;
  };

  it("reads as prose: the conclusion, then evidence, Inferred, Ruled out and Next, no card", () => {
    const wrapper = mountFindings(findings);
    expect(wrapper.find('[data-test="o-card"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-findings-cause"]').text()).toBe(
      "payments pool exhausted",
    );
    expect(wrapper.get('[data-test="assistant-answer-confidence"]').text()).toBe(
      "Medium confidence",
    );
    expect(wrapper.get('[data-test="assistant-findings-evidence"]').text()).toContain(
      "92% of errors are resets",
    );
    expect(wrapper.get('[data-test="assistant-findings-inferred"]').text()).toBe(
      "Inferred: matches the pool ceiling",
    );
    expect(wrapper.get('[data-test="assistant-findings-ruled-out"]').text()).toBe(
      "Ruled out: recent deploy",
    );
    expect(wrapper.get('[data-test="assistant-findings-next-steps"]').text()).toBe(
      "Next: check max-connections",
    );
  });

  it("drops Next when the turn has follow-ups, which are the next step", () => {
    const wrapper = mountFindings(findings, [{ type: "follow_ups", followUps: ["Show more"] }]);
    expect(wrapper.find('[data-test="assistant-findings-next-steps"]').exists()).toBe(false);
  });

  it("says Not established for what the findings could not settle", () => {
    const wrapper = mountFindings({
      type: "findings",
      findings: { ...findings.findings!, unknowns: ["what triggered it"] },
    });
    expect(wrapper.get('[data-test="assistant-findings-unknown"]').text()).toBe(
      "Not established: what triggered it",
    );
  });

  it("leads the line with Inconclusive and keeps the plain text", () => {
    const wrapper = mountFindings({
      type: "findings",
      findings: { ...findings.findings!, confidence: "inconclusive" },
    });
    expect(wrapper.get('[data-test="assistant-answer-confidence"]').text()).toBe("Inconclusive");
  });

  it("says it couldn't show findings, keeps them behind a closed disclosure, and counts it once", async () => {
    const wrapper = mountFindings({ type: "findings", findings: null });
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-findings-invalid"]').text()).toContain(
      "Couldn't show findings.",
    );
    expect(wrapper.text()).toContain("Show raw findings");
    expect(track).toHaveBeenCalledWith("ai_block_invalid", { block_kind: "findings" });
  });
});
