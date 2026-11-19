// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import AlertFormSection from "./AlertFormSection.vue";
import AlertStepNav from "./AlertStepNav.vue";
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

  it.each([
    ["watch", null, "condition"],
    ["condition", "watch", "notify"],
    ["notify", "condition", null],
  ] as const)(
    "the bar's Back and Next step from %s to its neighbours by name",
    async (id, back, next) => {
      const wrapper = mount(AlertStepNav, {
        props: { sections: ALERT_SECTIONS, active: id },
        global: { plugins: [i18n] },
      });
      const nav = (target: AlertSectionId) =>
        i18n.global.t(ALERT_SECTIONS.find((section) => section.id === target)!.navKey);
      for (const [dir, target] of [
        ["back", back],
        ["next", next],
      ] as const) {
        const button = wrapper.get(`[data-test="add-alert-step-${dir}"]`);
        expect(button.attributes("disabled") !== undefined).toBe(target === null);
        if (target === null) continue;
        expect(button.text()).toContain(nav(target));
        await button.trigger("click");
        expect(wrapper.emitted("step")?.at(-1)).toEqual([target]);
      }
    },
  );
});
