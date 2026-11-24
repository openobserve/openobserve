// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import i18n from "@/locales";
import OForm from "../Form/OForm.vue";
import OFormTagInput from "./OFormTagInput.vue";

const mountField = (props: Record<string, unknown>, value: string[] = []) =>
  mount(OForm, {
    props: { defaultValues: { roles: value } },
    slots: { default: () => h(OFormTagInput, { name: "roles", ...props }) },
    global: { plugins: [i18n] },
  });

describe("OFormTagInput", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("puts the label above the field, never over its placeholder or chips", () => {
    wrapper = mountField({ label: "Roles with use", placeholder: "Add a role" }, ["editor"]);
    const label = wrapper.find("[data-test='form-tag-input-label']");
    expect(label.text()).toBe("Roles with use");
    expect(wrapper.find("[data-test='tag-input-wrapper']").element.contains(label.element)).toBe(
      false,
    );
    expect(wrapper.find("[data-test='tag-input-label']").exists()).toBe(false);
    const input = wrapper.find("[data-test='tag-input-field']");
    expect(input.attributes("aria-labelledby")).toBe(label.attributes("id"));
  });

  it("shows help text and the required mark", () => {
    wrapper = mountField({
      label: "Allowed path prefixes",
      helpText: "One per line",
      required: true,
    });
    expect(wrapper.find("[data-test='form-tag-input-label']").text()).toContain("*");
    expect(wrapper.find("[data-test='form-tag-input-help']").text()).toBe("One per line");
  });

  it("renders the bare tag input when there is no label", () => {
    wrapper = mountField({ placeholder: "Add a tag" });
    expect(wrapper.find("[data-test='form-tag-input-label']").exists()).toBe(false);
    expect(wrapper.find("[data-test='tag-input-label']").exists()).toBe(false);
  });
});
