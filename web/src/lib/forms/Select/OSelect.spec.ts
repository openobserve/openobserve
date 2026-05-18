// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";

describe("OSelect", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OSelect);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a label when prop is provided", () => {
    wrapper = mount(OSelect, { props: { label: "Country" } });
    expect(wrapper.find("label").text()).toBe("Country");
  });

  it("renders a trigger button", () => {
    wrapper = mount(OSelect);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("shows placeholder text when no value is selected", () => {
    wrapper = mount(OSelect, {
      props: { placeholder: "Pick one" },
    });
    expect(wrapper.text()).toContain("Pick one");
  });

  it("shows clear button when clearable and a value is set", () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        modelValue: "a",
        options: [{ label: "Option A", value: "a" }],
      },
    });
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(
      true,
    );
  });

  it("does not show clear button when value is undefined", () => {
    wrapper = mount(OSelect, {
      props: { clearable: true, modelValue: undefined },
    });
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(
      false,
    );
  });

  it("emits clear event when clear button is clicked", async () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        modelValue: "a",
        options: [{ label: "Option A", value: "a" }],
      },
    });
    await wrapper.find('button[aria-label="Clear selection"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toBeUndefined();
  });

  it("shows error message when provided", () => {
    wrapper = mount(OSelect, {
      props: { errorMessage: "Selection required" },
    });
    expect(wrapper.text()).toContain("Selection required");
  });

  it("renders mapped option labels for object options", () => {
    wrapper = mount(OSelect, {
      props: {
        modelValue: 2,
        options: [
          { id: 1, title: "One" },
          { id: 2, title: "Two" },
        ] as any,
        valueKey: "id",
        labelKey: "title",
      },
    });
    expect(wrapper.text()).toContain("Two");
  });

  it("emits empty array when clear is clicked in multiple mode", async () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        multiple: true,
        modelValue: ["a", "b"],
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ],
      },
    });
    await wrapper.find('button[aria-label="Clear selection"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toEqual([]);
  });

  it("does not emit create on Enter when creatable is false", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        searchable: true,
        creatable: false,
        options: [{ label: "Existing", value: "ex" }],
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    const input = document.body.querySelector(
      'input[placeholder="Search..."]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "brand-new-term";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.emitted("create")).toBeFalsy();
  });
});
