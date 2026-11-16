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

import AssistantMark from "./AssistantMark.vue";
import { ASSISTANT_MOTION } from "./assistantMotion";
import { agentGlyph } from "./glyphs";

const agent = { glyph: agentGlyph.sre };

describe("AssistantMark", () => {
  it("draws the product as the logo, light and dark, with no tile", () => {
    for (const props of [{}, { glyph: agentGlyph["o2-ai"] }]) {
      const mark = mount(AssistantMark, { props }).get('[data-test="assistant-mark"]');
      expect(mark.attributes("data-logo")).toBe("");
      expect(mark.attributes("aria-hidden")).toBe("true");
      expect(mark.findAll("img").map((img) => img.attributes("alt"))).toEqual(["", ""]);
      expect(mark.classes()).not.toContain("bg-assistant-mark-bg");
      expect(mark.find("svg, [data-test=o-icon]").exists()).toBe(false);
    }
  });

  it("draws another agent as a decorative rounded square, never a circle", () => {
    const mark = mount(AssistantMark, { props: agent }).get('[data-test="assistant-mark"]');
    expect(mark.attributes("data-logo")).toBeUndefined();
    expect(mark.attributes("aria-hidden")).toBe("true");
    expect(mark.classes()).toContain("rounded-default");
    expect(mark.classes()).not.toContain("rounded-full");
    expect(mark.classes()).toContain("bg-assistant-mark-bg");
    expect(mark.classes()).toContain("text-assistant-mark-fg");
  });

  it.each([
    ["sm", "size-6"],
    ["md", "size-9"],
    ["lg", "size-12"],
  ] as const)("size %s renders a %s chip", (size, cls) => {
    const mark = mount(AssistantMark, { props: { size, ...agent } }).get(
      '[data-test="assistant-mark"]',
    );
    expect(mark.classes()).toContain(cls);
    expect(mark.attributes("data-size")).toBe(size);
  });

  it("mutes the glyph for gate states and never uses the accent", () => {
    const mark = mount(AssistantMark, { props: { muted: true } }).get(
      '[data-test="assistant-mark"]',
    );
    expect(mark.classes()).toContain("text-text-muted");
    expect(mark.html()).not.toContain("ai-accent");
  });

  it("is not interactive", () => {
    const wrapper = mount(AssistantMark);
    expect(wrapper.find("button, a, [tabindex]").exists()).toBe(false);
  });
  it("is a tinted tile with its inner ring, and sparkles only when asked", () => {
    const mark = mount(AssistantMark, { props: agent }).get('[data-test="assistant-mark"]');
    expect(mark.classes()).toContain("shadow-assistant-mark");
    expect(mark.classes()).not.toContain(ASSISTANT_MOTION.sparkle);
    const sparkling = mount(AssistantMark, { props: { sparkle: true } }).get(
      '[data-test="assistant-mark"]',
    );
    expect(sparkling.classes()).toContain(ASSISTANT_MOTION.sparkle);
  });
});
