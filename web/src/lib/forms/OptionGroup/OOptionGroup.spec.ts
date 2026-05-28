// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OOptionGroup from "./OOptionGroup.vue";

const fruits = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

describe("OOptionGroup — radio", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one radio per option", () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "radio" },
    });
    expect(wrapper.findAll("[role='radio']").length).toBe(3);
  });

  it("renders the group label", () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "radio", label: "Pick one" },
    });
    expect(wrapper.text()).toContain("Pick one");
  });

  it("emits update:modelValue with the selected radio value", async () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "radio", modelValue: "apple" },
    });
    const radios = wrapper.findAll("[role='radio']");
    await radios[1].trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("banana");
  });

  it("renders an error message", () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "radio", errorMessage: "Required" },
    });
    expect(wrapper.text()).toContain("Required");
  });
});

describe("OOptionGroup — checkbox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one checkbox per option", () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "checkbox", modelValue: [] },
    });
    expect(wrapper.findAll("[role='checkbox']").length).toBe(3);
  });

  it("emits update:modelValue with toggled value array", async () => {
    wrapper = mount(OOptionGroup, {
      props: { options: fruits, type: "checkbox", modelValue: [] },
    });
    const boxes = wrapper.findAll("[role='checkbox']");
    await boxes[0].trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(["apple"]);
  });

  it("supports horizontal orientation", () => {
    wrapper = mount(OOptionGroup, {
      props: {
        options: fruits,
        type: "checkbox",
        orientation: "horizontal",
        modelValue: [],
      },
    });
    const layoutDiv = wrapper.findAll("div").find((d) =>
      d.classes().includes("tw:flex-row"),
    );
    expect(layoutDiv).toBeDefined();
  });

  it("respects per-option disabled", () => {
    wrapper = mount(OOptionGroup, {
      props: {
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
        ],
        type: "checkbox",
        modelValue: [],
      },
    });
    const boxes = wrapper.findAll("[role='checkbox']");
    expect(boxes[1].attributes("disabled")).toBeDefined();
  });

  it("disables every option when group disabled is true", () => {
    wrapper = mount(OOptionGroup, {
      props: {
        options: fruits,
        type: "checkbox",
        modelValue: [],
        disabled: true,
      },
    });
    for (const box of wrapper.findAll("[role='checkbox']")) {
      expect(box.attributes("disabled")).toBeDefined();
    }
  });
});
