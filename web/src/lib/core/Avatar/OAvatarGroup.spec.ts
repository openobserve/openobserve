// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OAvatarGroup from "@/lib/core/Avatar/OAvatarGroup.vue";

const tipStub = { OTooltip: { template: "<span data-test='tip'><slot name='content' /></span>" } };

const people = ["a", "b", "c", "d", "e"].map((x) => ({
  value: `${x}@o2.ai`,
  name: `${x.toUpperCase()} Person`,
}));

describe("OAvatarGroup", () => {
  it("draws at most `max` faces and counts the rest", () => {
    const wrapper = mount(OAvatarGroup, { props: { people, max: 3 }, global: { stubs: tipStub } });
    expect(wrapper.findAllComponents({ name: "OAvatar" })).toHaveLength(3);
    expect(wrapper.find('[data-test="o-avatar-group-more"]').text()).toContain("+2");
  });

  // The chip is the only place the hidden people are named, with their address since names repeat.
  it("lists every hidden person by name and email on the chip", () => {
    const wrapper = mount(OAvatarGroup, { props: { people, max: 3 }, global: { stubs: tipStub } });
    const chipTip = wrapper.find('[data-test="o-avatar-group-more"] [data-test="tip"]').text();
    expect(chipTip).toContain("D Person");
    expect(chipTip).toContain("d@o2.ai");
    expect(chipTip).toContain("E Person");
    expect(chipTip).not.toContain("A Person");
  });

  // Every badge carries a border, and a tooltip reachable only by pointer names nobody to a keyboard or screen reader.
  it("draws the chip as a bordered, focusable badge that names the hidden people", () => {
    const wrapper = mount(OAvatarGroup, { props: { people, max: 3 } });
    const chip = wrapper.findComponent({ name: "OBadge" });
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).toContain("ring-1");
    expect(chip.attributes("tabindex")).toBe("0");
    expect(chip.attributes("aria-label")).toBe("+2: D Person (d@o2.ai), E Person (e@o2.ai)");
  });

  it("draws no chip when everyone fits", () => {
    const wrapper = mount(OAvatarGroup, { props: { people: people.slice(0, 2) } });
    expect(wrapper.find('[data-test="o-avatar-group-more"]').exists()).toBe(false);
  });
});
