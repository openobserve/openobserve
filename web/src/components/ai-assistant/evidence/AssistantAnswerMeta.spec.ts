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
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import AssistantAnswerMeta from "./AssistantAnswerMeta.vue";

const message: ChatMessage = { role: "assistant", content: raw("") };

const mountMeta = (confidence: "high" | "medium" | "low" | "inconclusive" | null) =>
  mount(AssistantAnswerMeta, { props: { message, confidence } });

const filled = (wrapper: ReturnType<typeof mountMeta>) =>
  [1, 2, 3].map((step) =>
    wrapper
      .get(`[data-test="o-segmented-bar-segment-${step}"]`)
      .classes()
      .includes("bg-text-secondary"),
  );

describe("AssistantAnswerMeta", () => {
  it.each([
    ["inconclusive", 0, "Inconclusive"],
    ["low", 1, "Low confidence"],
    ["medium", 2, "Medium confidence"],
    ["high", 3, "High confidence"],
  ] as const)("fills %s as %i of three steps and keeps its text", (level, count, text) => {
    const wrapper = mountMeta(level);
    const meta = wrapper.get('[data-test="assistant-answer-confidence"]');
    expect(meta.attributes("data-level")).toBe(String(count));
    expect(wrapper.get('[data-test="assistant-answer-confidence-label"]').text()).toBe(text);
    expect(filled(wrapper)).toEqual([1, 2, 3].map((step) => step <= count));
    const empty = wrapper.get('[data-test="o-segmented-bar-segment-3"]');
    expect(empty.classes()).toContain(count === 3 ? "bg-text-secondary" : "bg-border-strong");
  });

  it("hides the meter from assistive tech, since the text beside it says the level", () => {
    const wrapper = mountMeta("medium");
    const meter = wrapper.get('[data-test="assistant-answer-confidence-meter"]');
    expect(meter.find('[aria-hidden="true"]').exists()).toBe(true);
    expect(meter.find('[role="img"]').exists()).toBe(false);
  });

  it("renders nothing without a confidence or a stale answer", () => {
    expect(mountMeta(null).find('[data-test="assistant-answer-meta"]').exists()).toBe(false);
  });
});
