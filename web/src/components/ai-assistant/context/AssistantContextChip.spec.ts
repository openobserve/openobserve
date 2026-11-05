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

import type { ContextChip } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import AssistantContextChip from "./AssistantContextChip.vue";

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  secondary: raw("default"),
  sizeBytes: 280,
  provenance: "door",
  sent: "serialized",
};

const mountChip = (props: Record<string, unknown> = {}) =>
  mount(AssistantContextChip, { props: { chip: ROW, ...props }, attachTo: document.body });

describe("AssistantContextChip", () => {
  it("is an OTag of the assistantContext group keyed by state, named label and secondary (CT-02 AC 12)", () => {
    const wrapper = mountChip();
    const root = wrapper.get('[data-test="assistant-context-chip-log_row"]');
    expect(root.attributes("data-state")).toBe("sent");
    const button = wrapper.get('[data-test="assistant-context-chip-button"]');
    expect(button.element.tagName).toBe("SPAN");
    expect(button.attributes("role")).toBe("button");
    expect(button.attributes("tabindex")).toBe("0");
    expect(button.attributes("aria-label")).toBe("Log row · cart · 13:57, default");
    expect(button.classes()).toContain("rounded-default");
  });

  it("has a named remove button inside the pill (CT-02 AC 12)", async () => {
    const wrapper = mountChip();
    const remove = wrapper.get('[data-test="assistant-context-chip-remove"]');
    expect(remove.attributes("aria-label")).toBe("Remove Log row · cart · 13:57 from context");
    expect(
      wrapper.get('[data-test="assistant-context-chip-button"]').element.contains(remove.element),
    ).toBe(true);
    await remove.trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("removes, not opens, on Enter or Space on the remove button", async () => {
    const wrapper = mountChip();
    const remove = wrapper.get('[data-test="assistant-context-chip-remove"]');
    await remove.trigger("keydown", { key: "Enter" });
    await remove.trigger("keydown", { key: " " });
    expect(wrapper.emitted("remove")).toHaveLength(2);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("shows an image chip's thumbnail in place of the kind icon", () => {
    const wrapper = mountChip({
      chip: { ...ROW, kind: "image", label: raw("shot.png") },
      imageSrc: "data:image/png;base64,AAAA",
    });
    const thumb = wrapper.get('[data-test="assistant-context-chip-thumb"]');
    expect(thumb.attributes("src")).toBe("data:image/png;base64,AAAA");
    expect(thumb.classes()).toContain("size-4");
  });

  it("removes on Delete and Backspace and moves on the arrows (CT-01 AC 11, CT-08 AC 4)", async () => {
    const wrapper = mountChip();
    const button = wrapper.get('[data-test="assistant-context-chip-button"]');
    await button.trigger("keydown", { key: "Delete" });
    await button.trigger("keydown", { key: "Backspace" });
    await button.trigger("keydown", { key: "ArrowRight" });
    await button.trigger("keydown", { key: "ArrowLeft" });
    await button.trigger("keydown", { key: "Delete", isComposing: true });
    expect(wrapper.emitted("remove")).toHaveLength(2);
    expect(wrapper.emitted("move")).toEqual([[1], [-1]]);
  });

  it("opens its popover on click and on Enter", async () => {
    const wrapper = mountChip();
    const button = wrapper.get('[data-test="assistant-context-chip-button"]');
    await button.trigger("click");
    await button.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("open")).toHaveLength(2);
  });

  it("says not read yet and uses the dotted state for a field the agent drops (CT-01 AC 6)", () => {
    const wrapper = mountChip({
      chip: { ...ROW, kind: "query", sent: "not_read", label: raw("Trace query") },
    });
    expect(wrapper.get('[data-test="assistant-context-chip-query"]').attributes("data-state")).toBe(
      "not_read",
    );
    expect(wrapper.text()).toContain("not read yet");
    expect(wrapper.get('[data-test="assistant-context-chip-button"]').classes()).toContain(
      "border-dotted",
    );
  });

  it("is an Add back chip with no remove as a ghost (CT-01 AC 7)", () => {
    const wrapper = mountChip({ state: "ghost" });
    expect(wrapper.text()).toContain("Log row · cart · 13:57 · Add back");
    expect(wrapper.find('[data-test="assistant-context-chip-remove"]').exists()).toBe(false);
  });

  it("has no remove when read-only, and the time chip is never removable", () => {
    expect(
      mountChip({ readonly: true }).find('[data-test="assistant-context-chip-remove"]').exists(),
    ).toBe(false);
    const time = mountChip({
      chip: { ...ROW, kind: "time", provenance: "page", sent: "whitelist" },
    });
    expect(time.find('[data-test="assistant-context-chip-remove"]').exists()).toBe(false);
  });

  it("cuts a long label with OTruncatedText, never a title (CT-02 AC 13)", () => {
    const wrapper = mountChip();
    expect(wrapper.find("[title]").exists()).toBe(false);
    expect(wrapper.html()).toContain("truncate");
  });
});
