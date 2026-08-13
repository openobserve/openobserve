// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { flushPromises, mount } from "@vue/test-utils";
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

const mountSelector = (modelValue: string[] = [], options = Array.from({ length: 12 }, (_, i) => child(i + 1))) =>
  mount(CompositeChildSelector, {
    props: { modelValue, options, max: 10 },
    global: { plugins: [i18n] },
  });

describe("CompositeChildSelector", () => {
  it("searches readable eligible children by name, type, and folder", async () => {
    const wrapper = mountSelector([], [
      child(1, "Checkout latency"),
      child(2, "Database unavailable"),
      child(3, "SLO burn rate"),
    ]);

    await wrapper
      .find('[data-test="alerts-composite-child-search-field"]')
      .setValue("checkout");
    await flushPromises();

    expect(wrapper.text()).toContain("Checkout latency");
    expect(wrapper.text()).not.toContain("Database unavailable");
    expect(wrapper.find('[data-test="alerts-composite-child-option-child-1"]').text()).toContain(
      "Default",
    );
  });

  it("stops at ten unique children and explains why the eleventh is disabled", () => {
    const selected = Array.from({ length: 10 }, (_, index) => `child-${index + 1}`);
    const wrapper = mountSelector(selected);

    const eleventh = wrapper.find('[data-test="alerts-composite-child-option-child-11"]');
    expect(eleventh.attributes("aria-disabled")).toBe("true");
    expect(wrapper.find('[data-test="alerts-composite-child-cap"]').text()).toContain("10");
  });

  it("emits stable IDs in selection order and never uses a duplicate name as identity", async () => {
    const wrapper = mountSelector([], [child(1, "Duplicate"), child(2, "Duplicate")]);

    await wrapper.find('[data-test="alerts-composite-child-option-child-1"]').trigger("click");
    await wrapper.setProps({ modelValue: ["child-1"] });
    await wrapper.find('[data-test="alerts-composite-child-option-child-2"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(["child-1", "child-2"]);
  });

  it("supports keyboard selection and exposes a label for every result", async () => {
    const wrapper = mountSelector([], [child(1, "Checkout latency")]);
    const option = wrapper.find('[data-test="alerts-composite-child-option-child-1"]');

    expect(option.attributes("aria-label")).toContain("Checkout latency");
    await option.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(["child-1"]);
  });

  it("keeps a very long child name available without making the ID ambiguous", () => {
    const longName = `Checkout ${"regional-database-failover-".repeat(12)}`;
    const wrapper = mountSelector(["child-1"], [child(1, longName)]);

    const selected = wrapper.find('[data-test="alerts-composite-selected-child-child-1"]');
    expect(selected.attributes("title")).toBe(longName);
    expect(selected.attributes("data-child-id")).toBe("child-1");
  });
});
