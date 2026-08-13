// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CompositeChildSelector from "./CompositeChildSelector.vue";
import i18n from "@/locales";

const child = (index: number, name = `Alert ${index}`) => ({
  alert_id: `child-${index}`,
  name,
  alert_type: index % 3 === 0 ? "slo" : "scheduled",
  folder_id: index % 2 === 0 ? "payments" : "default",
  folder_name: index % 2 === 0 ? "Payments" : "Default",
  enabled: index % 4 !== 0,
  level: index % 2 === 0 ? "critical" : "ok",
  level_at: 1_786_500_000_000_000 + index,
  stale: false,
  accessible: true,
});

const mountSelector = (
  modelValue: string[] = [],
  options = Array.from({ length: 12 }, (_, i) => child(i + 1)),
) =>
  mount(CompositeChildSelector, {
    props: { modelValue, options, max: 10 },
    global: { plugins: [i18n] },
  });

describe("CompositeChildSelector", () => {
  it("renders each selected child as a lettered slot in selection order", () => {
    const wrapper = mountSelector(["child-2", "child-1"], [child(1), child(2)]);

    expect(wrapper.find('[data-test="alerts-composite-selected-child-child-2"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="alerts-composite-selected-child-child-1"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
    expect(wrapper.text()).toContain("Alert 2");
    expect(wrapper.text()).toContain("Alert 1");
  });

  it("adds the first unselected child when Add alert is clicked", async () => {
    const wrapper = mountSelector(["child-1"], [child(1), child(2), child(3)]);

    await wrapper.find('[data-test="alerts-composite-child-add"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(["child-1", "child-2"]);
  });

  it("removes a child by slot", async () => {
    const wrapper = mountSelector(
      ["child-1", "child-2", "child-3"],
      [child(1), child(2), child(3)],
    );

    await wrapper.find('[data-test="alerts-composite-child-remove-child-1"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(["child-2", "child-3"]);
  });

  it("caps at ten children and shows the count", () => {
    const selected = Array.from({ length: 10 }, (_, index) => `child-${index + 1}`);
    const wrapper = mountSelector(selected);

    expect(wrapper.find('[data-test="alerts-composite-child-cap"]').text()).toContain("10");
    expect(
      wrapper.find('[data-test="alerts-composite-child-add"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("keeps an inaccessible child removable by its ID without revealing a name or level", () => {
    const wrapper = mountSelector(["secret-id"], [child(1)]);

    const slot = wrapper.find('[data-test="alerts-composite-selected-child-secret-id"]');
    expect(slot.text()).toContain("secret-id");
    expect(slot.text()).not.toContain("Alert 1");
    expect(wrapper.find('[data-test="alerts-composite-child-remove-secret-id"]').exists()).toBe(
      true,
    );
  });
});
