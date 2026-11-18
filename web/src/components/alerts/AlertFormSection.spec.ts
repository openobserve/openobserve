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

  it.each([
    [1, true, null, "condition"],
    [2, true, "watch", "notify"],
    [2, false, null, "notify"],
    [5, true, "schedule", null],
  ] as const)(
    "section %i's footer (back allowed: %s) steps to its neighbours by name",
    async (index, canGoBack, back, next) => {
      const wrapper = mount(AlertFormSection, {
        props: {
          id: ALERT_SECTIONS[index - 1].id,
          index,
          title: raw("T"),
          help: raw("H"),
          canGoBack,
        },
        global: { plugins: [i18n] },
      });
      const nav = (id: AlertSectionId) =>
        i18n.global.t(ALERT_SECTIONS.find((section) => section.id === id)!.navKey);
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
