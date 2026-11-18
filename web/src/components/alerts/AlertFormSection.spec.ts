// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import AlertFormSection from "./AlertFormSection.vue";
import { ALERT_SECTIONS, type AlertSectionId } from "./alertFormSections";

const OUT_OF_TAB_ORDER = /(^|:)(hidden|invisible)$/;

describe("AlertFormSection", () => {
  it("keeps a non-current section's step buttons in the Tab order", () => {
    const wrapper = mount(AlertFormSection, {
      props: { id: "condition", title: raw("T"), help: raw("H"), current: false },
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

  const fourSteps = ALERT_SECTIONS.filter((section) => section.id !== "schedule");
  it.each([
    [5, "watch", null, "condition"],
    [5, "condition", "watch", "notify"],
    [5, "details", "schedule", null],
    [4, "notify", "condition", "details"],
    [4, "details", "notify", null],
  ] as const)(
    "in %i steps, %s's footer steps to its neighbours by name",
    async (steps, id, back, next) => {
      const sections = steps === 5 ? ALERT_SECTIONS : fourSteps;
      const index = sections.findIndex((section) => section.id === id) + 1;
      const wrapper = mount(AlertFormSection, {
        props: { id, sections, title: raw("T"), help: raw("H") },
        global: { plugins: [i18n] },
      });
      const nav = (target: AlertSectionId) =>
        i18n.global.t(ALERT_SECTIONS.find((section) => section.id === target)!.navKey);
      for (const [dir, target] of [
        ["back", back],
        ["next", next],
      ] as const) {
        const button = wrapper.find(`[data-test="add-alert-section-${index}-${dir}"]`);
        expect(button.exists()).toBe(target !== null);
        if (target === null) continue;
        expect(button.text()).toContain(nav(target));
        await button.trigger("click");
        expect(wrapper.emitted("step")?.at(-1)).toEqual([target]);
      }
    },
  );
});
