// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import CompositeReferencesDrawer from "./CompositeReferencesDrawer.vue";
import i18n from "@/locales";

const references = [
  { alert_id: "parent-1", name: "Checkout degraded", folder_id: "default" },
  { alert_id: "parent-2", name: "Payments unavailable", folder_id: "payments" },
];

const mountDrawer = (props: Record<string, unknown> = {}) =>
  mount(CompositeReferencesDrawer, {
    props: {
      open: false,
      referenceCount: references.length,
      references,
      hiddenReferenceCount: 0,
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("CompositeReferencesDrawer", () => {
  it("renders the readable-parent count chip and opens the same reference list", async () => {
    const wrapper = mountDrawer();
    expect(wrapper.find('[data-test="alerts-composite-reference-chip"]').text()).toContain("2");

    await wrapper.find('[data-test="alerts-composite-reference-chip"]').trigger("click");
    expect(wrapper.emitted("update:open")?.[0]).toEqual([true]);
  });

  it("offers navigation to each visible parent after a child-referenced conflict", async () => {
    const wrapper = mountDrawer({ open: true, conflictCode: "child_referenced" });
    await wrapper.find('[data-test="alerts-composite-reference-parent-parent-2"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("navigate")?.[0]?.[0]).toEqual(references[1]);
    expect(wrapper.find('[data-test="alerts-composite-reference-conflict"]').exists()).toBe(true);
  });

  it("reports an opaque hidden count without rendering hidden identities", () => {
    const wrapper = mountDrawer({ open: true, hiddenReferenceCount: 3 });

    expect(wrapper.find('[data-test="alerts-composite-reference-hidden-count"]').text()).toContain(
      "3",
    );
    expect(wrapper.findAll('[data-test^="alerts-composite-reference-parent-"]')).toHaveLength(2);
  });

  it("has labelled close and navigation controls with predictable initial focus", () => {
    const wrapper = mountDrawer({ open: true });
    const close = wrapper.find('[data-test="alerts-composite-reference-close"]');

    expect(close.attributes("aria-label")).toBeTruthy();
    expect(
      wrapper.find('[data-test="alerts-composite-reference-drawer"]').attributes("aria-labelledby"),
    ).toBeTruthy();
    expect(
      wrapper
        .find('[data-test="alerts-composite-reference-parent-parent-1"]')
        .attributes("aria-label"),
    ).toContain("Checkout degraded");
  });
});
