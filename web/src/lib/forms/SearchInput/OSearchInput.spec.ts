// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSearchInput from "./OSearchInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

describe("OSearchInput", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should render without errors", () => {
    wrapper = mount(OSearchInput);
    expect(wrapper.exists()).toBe(true);
  });

  it("should render a search icon", () => {
    wrapper = mount(OSearchInput);
    // OIcon renders an SVG for the search icon
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("should render an input element", () => {
    wrapper = mount(OSearchInput);
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("should bind modelValue to the underlying input", () => {
    wrapper = mount(OSearchInput, { props: { modelValue: "hello" } });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("hello");
  });

  it("should emit update:modelValue on input", async () => {
    wrapper = mount(OSearchInput, { props: { modelValue: "" } });
    await wrapper.find("input").setValue("test query");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("test query");
  });

  it("should set placeholder on the input", () => {
    wrapper = mount(OSearchInput, { props: { placeholder: "Search items..." } });
    expect(wrapper.find("input").attributes("placeholder")).toBe("Search items...");
  });

  it("should use default placeholder when none is provided", () => {
    wrapper = mount(OSearchInput);
    expect(wrapper.find("input").attributes("placeholder")).toBe("Search...");
  });

  it("should show clear button by default when modelValue is non-empty", () => {
    wrapper = mount(OSearchInput, {
      props: { modelValue: "query" },
    });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(true);
  });

  it("should not show clear button when modelValue is empty", () => {
    wrapper = mount(OSearchInput, {
      props: { modelValue: "" },
    });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it("should not show clear button when clearable is explicitly false", () => {
    wrapper = mount(OSearchInput, {
      props: { clearable: false, modelValue: "query" },
    });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it("should emit clear and reset modelValue when clear button is clicked", async () => {
    wrapper = mount(OSearchInput, {
      props: { modelValue: "query" },
    });
    await wrapper.find('button[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
  });

  it("should disable the input when disabled=true", () => {
    wrapper = mount(OSearchInput, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("should forward data-test attribute to the root wrapper", () => {
    wrapper = mount(OSearchInput, {
      attrs: { "data-test": "my-search-input" },
    });
    expect(wrapper.find('[data-test="my-search-input"]').exists()).toBe(true);
  });

  it("should expose native input as data-test -field for E2E selectors", () => {
    wrapper = mount(OSearchInput, {
      attrs: { "data-test": "streams-search-stream-input" },
    });
    const fieldEl = wrapper.find('[data-test="streams-search-stream-input-field"]');
    expect(fieldEl.exists()).toBe(true);
    expect(fieldEl.element.tagName.toLowerCase()).toBe("input");
  });

  it("renders an icon-right slot inside the field", () => {
    // So a search can carry a control within its own border — the scope toggle the
    // dashboard list and the metrics explorer both put in their search box.
    wrapper = mount(OSearchInput, {
      props: { modelValue: "" },
      slots: { "icon-right": '<button data-test="scope">All</button>' },
    });

    expect(wrapper.find('[data-test="scope"]').exists()).toBe(true);
  });

  it("hands OInput no icon-right slot at all when the caller passes none", () => {
    // The forwarding is under a `v-if` for a reason: OInput renders its right-hand
    // box on `v-if="$slots['icon-right']"`, and an always-present-but-empty
    // template still counts as present — which would give EVERY plain search input
    // in the app an invisible, padded box on its right.
    wrapper = mount(OSearchInput, { props: { modelValue: "" } });

    expect(wrapper.findComponent(OInput).vm.$slots["icon-right"]).toBeUndefined();
  });

  it("should debounce update:modelValue when debounce is set", async () => {
    vi.useFakeTimers();
    wrapper = mount(OSearchInput, { props: { modelValue: "", debounce: 300 } });
    await wrapper.find("input").setValue("debounced");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    vi.advanceTimersByTime(300);
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("debounced");
    vi.useRealTimers();
  });
});
