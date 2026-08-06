// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
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
    // searchable: false forces the native SelectRoot branch where reka-ui's
    // SelectValue renders the placeholder prop correctly in JSDOM. The listbox
    // (PopoverRoot) branch renders "false" as text in JSDOM due to a reka-ui
    // JSDOM limitation — test the non-listbox path to verify the placeholder prop.
    wrapper = mount(OSelect, {
      props: { placeholder: "Pick one", searchable: false },
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
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(true);
  });

  it("does not show clear button when value is undefined", () => {
    wrapper = mount(OSelect, {
      props: { clearable: true, modelValue: undefined },
    });
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(false);
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
    // The component requires both `error: true` AND `errorMessage` to render
    // the error span. `error` is the gating flag; `errorMessage` is the text.
    wrapper = mount(OSelect, {
      props: { error: true, errorMessage: "Selection required" },
    });
    expect(wrapper.find('[role="alert"]').text()).toContain("Selection required");
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

  it("lets pointerdown inside the open popover propagate to document", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        multiple: true,
        searchable: true,
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ],
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    const input = document.body.querySelector(
      'input[placeholder="Search..."]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const docSpy = vi.fn();
    document.addEventListener("pointerdown", docSpy);
    input!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.removeEventListener("pointerdown", docSpy);

    // With @pointerdown.stop present this would be 0 (stopped at the content).
    expect(docSpy).toHaveBeenCalled();
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
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("create")).toBeFalsy();
  });

  describe("trigger keyboard focus behavior", () => {
    // The listbox-mode trigger must expose role="combobox" so the global
    // shortcut manager's isInputFocused() guard treats a focused select as a
    // text-entry widget — otherwise single-letter page shortcuts (logs "s",
    // "r", "h") fire while the select has focus inside a dialog.
    it("should expose role=combobox on the listbox trigger", () => {
      wrapper = mount(OSelect, {
        props: {
          searchable: true,
          options: [{ label: "Option A", value: "a" }],
        },
      });
      const trigger = wrapper.find("button");
      expect(trigger.attributes("role")).toBe("combobox");
      expect(trigger.attributes("aria-expanded")).toBe("false");
    });

    it("should open the dropdown and seed the filter when a printable key is pressed on the closed trigger", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [
            { label: "sample", value: "s1" },
            { label: "other", value: "o1" },
          ],
        },
      });
      await wrapper.find("button").trigger("keydown", { key: "s" });
      await flushPromises();

      const input = document.body.querySelector(
        'input[placeholder="Search..."]',
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.value).toBe("s");
    });

    it("should not open the dropdown when a modifier combo is pressed on the trigger", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      await wrapper.find("button").trigger("keydown", { key: "s", ctrlKey: true });
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).toBeNull();
    });

    it("should stop propagation of printable keys so page-level shortcuts never fire", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      const docSpy = vi.fn();
      document.addEventListener("keydown", docSpy);
      (wrapper.find("button").element as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
      document.removeEventListener("keydown", docSpy);
      expect(docSpy).not.toHaveBeenCalled();
    });
  });
});
