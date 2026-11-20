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

  it("is always clearable once there is text", () => {
    wrapper = mount(OSearchInput, { props: { modelValue: "query" } });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(true);
  });

  it("clears on Escape and stops it reaching the overlay behind", async () => {
    wrapper = mount(OSearchInput, { props: { modelValue: "query" } });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    const stop = vi.spyOn(event, "stopPropagation");
    wrapper.find("input").element.dispatchEvent(event);
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("");
    expect(stop).toHaveBeenCalled();
  });

  it.each([
    ["md", "h-control-md"],
    ["sm", "h-control-sm"],
  ] as const)("takes its height from the %s control token", (size, expected) => {
    wrapper = mount(OSearchInput, { props: { size } });
    expect(wrapper.find(".rounded-default").classes()).toContain(expected);
  });

  it("caps a list search at 280 px and a scoped search at 360 px", () => {
    wrapper = mount(OSearchInput, { props: { width: "list" } });
    expect(wrapper.classes()).toContain("max-w-70");
    wrapper.unmount();
    wrapper = mount(OSearchInput, { props: { width: "scope" } });
    expect(wrapper.classes()).toContain("max-w-90");
  });

  it("filters a client-side list at once when no debounce is asked for", async () => {
    wrapper = mount(OSearchInput, { props: { modelValue: "" } });
    await wrapper.find("input").setValue("pay");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("pay");
  });

  it("shows the / key while empty and focuses on / from the page", async () => {
    wrapper = mount(OSearchInput, { attachTo: document.body, attrs: { "data-test": "q" } });
    expect(wrapper.find('[data-test="q-shortcut"]').exists()).toBe(true);
    // jsdom has no layout, so every rect is empty; pretend the field is on screen.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(document.activeElement).toBe(wrapper.find("input").element);
  });

  it("leaves / alone in a menu-sized search unless asked", () => {
    wrapper = mount(OSearchInput, { props: { size: "sm" }, attrs: { "data-test": "q" } });
    expect(wrapper.find('[data-test="q-shortcut"]').exists()).toBe(false);
  });

  it("swaps the glyph for a spinner while loading", () => {
    wrapper = mount(OSearchInput, { props: { loading: true }, attrs: { "data-test": "q" } });
    expect(wrapper.find('[data-test="q-loading"]').exists()).toBe(true);
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

  it("renders the in-field scope switch and emits the picked scope", async () => {
    wrapper = mount(OSearchInput, {
      props: {
        modelValue: "",
        scope: "this",
        scopeOptions: [
          { value: "this", label: "This folder" },
          { value: "all", label: "All folders", dataTest: "scope-all" },
        ],
      },
      attrs: { "data-test": "q" },
    });
    expect(wrapper.find('[data-test="q-scope-this"]').exists()).toBe(true);
    await wrapper.find('[data-test="scope-all"]').trigger("click");
    expect(wrapper.emitted("update:scope")?.[0]?.[0]).toBe("all");
  });

  it("hands OInput no end slot when there is nothing to show at the end", () => {
    // OInput pads an end box whenever the slot exists, so an empty one would add dead space.
    wrapper = mount(OSearchInput, { props: { modelValue: "x" } });
    expect(wrapper.findComponent(OInput).vm.$slots["icon-end"]).toBeUndefined();
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

  it("floors its phone width so a flex-1 search can share the toolbar row", () => {
    wrapper = mount(OSearchInput, { attrs: { class: "flex-1" } });
    expect(wrapper.classes()).toContain("max-md:min-w-32");
    expect(wrapper.classes()).toContain("flex-1");
  });

  it.each(["min-w-0 flex-1", "flex-1 max-md:min-w-40", "min-w-48"])(
    "keeps the caller's own width floor (%s)",
    (cls) => {
      wrapper = mount(OSearchInput, { attrs: { class: cls } });
      expect(wrapper.classes()).not.toContain("max-md:min-w-32");
    },
  );

  it("routes aria-label, aria-labelledby and aria-describedby to the input, not the wrapper", () => {
    wrapper = mount(OSearchInput, {
      attrs: { "aria-label": "Name", "aria-labelledby": "lbl", "aria-describedby": "hint" },
    });
    const input = wrapper.find("input");
    expect(input.attributes("aria-label")).toBe("Name");
    expect(input.attributes("aria-labelledby")).toBe("lbl");
    expect(input.attributes("aria-describedby")).toBe("hint");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
    expect(wrapper.attributes("aria-labelledby")).toBeUndefined();
    expect(wrapper.attributes("aria-describedby")).toBeUndefined();
  });
});
