// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import AlertFormSection from "./AlertFormSection.vue";

const OUT_OF_TAB_ORDER = /(^|:)(hidden|invisible)$/;

describe("AlertFormSection", () => {
  it("keeps a non-current section's step buttons in the Tab order", () => {
    const wrapper = mount(AlertFormSection, {
      props: { id: "condition", index: 2, title: raw("T"), help: raw("H"), current: false },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    for (const step of ["prev", "next"]) {
      const button = wrapper.get(`[data-test="add-alert-section-condition-${step}"]`)
        .element as HTMLButtonElement;
      let node: Element | null = button;
      while (node && node !== wrapper.element) {
        expect([...node.classList].filter((c) => OUT_OF_TAB_ORDER.test(c))).toEqual([]);
        node = node.parentElement;
      }
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    wrapper.unmount();
  });
});
