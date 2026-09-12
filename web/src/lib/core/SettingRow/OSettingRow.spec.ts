// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import OSettingRow from "./OSettingRow.vue";

describe("OSettingRow", () => {
  it("renders the label and the description", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Minimum length"), description: raw("Shortest password accepted") },
    });

    expect(wrapper.text()).toContain("Minimum length");
    expect(wrapper.text()).toContain("Shortest password accepted");
  });

  it("omits the description element when there is none", () => {
    const wrapper = mount(OSettingRow, { props: { label: raw("Require digit") } });

    expect(wrapper.text()).toContain("Require digit");
    expect(wrapper.find(".text-text-secondary").exists()).toBe(false);
  });

  it("renders the control in the default slot", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Require digit") },
      slots: { default: '<button data-test="control">toggle</button>' },
    });

    expect(wrapper.find('[data-test="control"]').exists()).toBe(true);
  });

  it("drops its own rule on the last row, so a card needs no per-row conditionals", () => {
    const wrapper = mount(OSettingRow, { props: { label: raw("Require digit") } });

    expect(wrapper.classes()).toContain("border-b");
    expect(wrapper.classes()).toContain("last:border-b-0");
  });

  it("forwards data-test for addressing the row in page tests", () => {
    const wrapper = mount(OSettingRow, {
      props: { label: raw("Require digit"), dataTest: "settings-password-policy-require-digit" },
    });

    expect(wrapper.attributes("data-test")).toBe("settings-password-policy-require-digit");
  });
});
