// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw } from "@/types/i18n";

import OFormSection from "./OFormSection.vue";

describe("OFormSection", () => {
  it.each([
    { props: {}, heading: "SPAN", description: false, warning: false },
    {
      props: { description: raw("Applies to every stream") },
      heading: "SPAN",
      description: true,
      warning: false,
    },
    {
      props: { tone: "danger" },
      heading: "SPAN",
      description: false,
      warning: false,
    },
    {
      props: { variant: "plain" },
      heading: "H2",
      description: false,
      warning: false,
    },
    {
      props: { variant: "plain", tone: "danger", description: raw("Applies to every stream") },
      heading: "H2",
      description: true,
      warning: true,
    },
  ] as const)(
    "renders the description and danger warning when asked, and the plain heading as an h2 ($props)",
    ({ props, heading, description, warning }) => {
      const wrapper = mount(OFormSection, {
        props: { title: raw("Retention"), dataTest: "section", ...props },
        slots: { default: '<input data-test="control" />', actions: '<button data-test="add" />' },
        global: { stubs: { OTooltip: true } },
      });

      const title = wrapper.findAll("h2, span").find((el) => el.text() === "Retention");
      expect(title?.element.tagName).toBe(heading);
      expect(wrapper.find('[data-test="section-description"]').exists()).toBe(description);
      if (description) expect(wrapper.text()).toContain("Applies to every stream");
      const icons = wrapper.findAllComponents(OIcon).map((icon) => icon.props("name"));
      expect(icons.includes("warning")).toBe(warning);
      expect(wrapper.find('[data-test="control"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add"]').exists()).toBe(true);
    },
  );
});
