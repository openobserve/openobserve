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
import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantTurnFooter from "./AssistantTurnFooter.vue";

const answer = (footer: ContentBlock["footer"] = {}): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: [
    { type: "text", text: "x" },
    { type: "footer", footer },
  ],
});

describe("AssistantTurnFooter", () => {
  afterEach(() => (document.body.innerHTML = ""));

  const mountFooter = (
    message: ChatMessage,
    turn: Record<string, unknown> = {},
    creditMode?: "free" | "exhausted" | "pay_as_you_go",
  ) => {
    const evidence = fakeEvidence(creditMode ? { creditMode } : {});
    return mount(AssistantTurnFooter, {
      props: { message, turn: evidence.turn(turn) },
      global: { provide: evidence.provide },
    });
  };

  it("draws nothing on an ordinary finished answer: the answer's own lines say it all", () => {
    expect(mountFooter(answer()).find('[data-test="assistant-turn-footer"]').exists()).toBe(false);
  });

  it("states the credit on Cloud", () => {
    const wrapper = mountFooter(answer(), {}, "pay_as_you_go");
    expect(wrapper.get('[data-test="assistant-turn-footer-credits"]').text()).toBe("1 credit");
  });

  it("says a refund only on a stopped turn the server counted as 0", () => {
    const wrapper = mountFooter(
      answer({ usage: { credits: 0 } }),
      { outcome: "stopped" },
      "pay_as_you_go",
    );
    expect(wrapper.text()).toContain("0 credits · refunded");
  });

  it("says an answer was not saved", () => {
    const wrapper = mountFooter(answer(), { outcome: "done_not_saved" });
    expect(wrapper.get('[data-test="assistant-turn-footer-not-saved"]').text()).toBe("not saved");
  });

  it("is absent while the turn runs", () => {
    const wrapper = mountFooter(answer(), { outcome: "live" }, "pay_as_you_go");
    expect(wrapper.find('[data-test="assistant-turn-footer"]').exists()).toBe(false);
  });
});
