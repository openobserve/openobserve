// Copyright 2026 OpenObserve Inc.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import O2Select from "./O2Select.vue";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIMPLE_OPTIONS = ["Alpha", "Beta", "Gamma", "Delta"];

const OBJECT_OPTIONS = [
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
  { label: "Alerts", value: "alerts" },
];

const DISABLED_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled", disable: true },
  { label: "Also active", value: "also-active" },
];

function mountSelect(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  return mount(O2Select, {
    props,
    slots,
    attachTo: document.body,
  });
}

const openDropdown = async (wrapper: VueWrapper) => {
  await wrapper.find(".o2-select__control").trigger("click");
  await flushPromises();
};

const getDropdown = () => document.querySelector(".o2-select__dropdown");
const getOptions = () => document.querySelectorAll(".o2-select__option");
const getOptionAt = (i: number) =>
  document.querySelectorAll(".o2-select__option")[i] as HTMLElement;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("O2Select", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    // Clean up any teleported dropdowns
    document
      .querySelectorAll(".o2-select__dropdown")
      .forEach((el) => el.remove());
  });

  // ─── Pattern D: Simple dropdown ───────────────────────────────────────────

  describe("Pattern D — simple dropdown", () => {
    it("should render without errors", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      expect(wrapper.find(".o2-select").exists()).toBe(true);
      expect(wrapper.find(".o2-select__control").exists()).toBe(true);
    });

    it("should render label when provided", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, label: "Stream type" });
      expect(wrapper.find(".o2-select__label").text()).toBe("Stream type");
    });

    it("should show placeholder when no value selected", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        placeholder: "Pick one",
      });
      expect(wrapper.find(".o2-select__placeholder").text()).toBe("Pick one");
    });

    it("should not show dropdown initially", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      expect(getDropdown()).toBeNull();
    });

    it("should open dropdown on control click", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(getDropdown()).not.toBeNull();
    });

    it("should render all options in dropdown", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(getOptions()).toHaveLength(4);
      expect(getOptionAt(0).textContent?.trim()).toBe("Alpha");
      expect(getOptionAt(3).textContent?.trim()).toBe("Delta");
    });

    it("should close dropdown after selecting an option", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      getOptionAt(0).click();
      await flushPromises();
      expect(getDropdown()).toBeNull();
    });

    it("should emit update:modelValue with selected value (string options)", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, modelValue: null });
      await openDropdown(wrapper);
      getOptionAt(1).click();
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["Beta"]);
    });

    it("should close dropdown on Escape key", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "Escape" });
      await flushPromises();
      expect(getDropdown()).toBeNull();
    });

    it("should apply data-test to root element", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        "data-test": "my-select",
      });
      expect(wrapper.find('[data-test="my-select"]').exists()).toBe(true);
      expect(wrapper.find(".o2-select__control[data-test]").exists()).toBe(
        false,
      );
    });

    it("should apply outlined variant by default", () => {
      wrapper = mountSelect();
      expect(wrapper.find(".o2-select--outlined").exists()).toBe(true);
    });

    it("should apply borderless variant", () => {
      wrapper = mountSelect({ variant: "borderless" });
      expect(wrapper.find(".o2-select--borderless").exists()).toBe(true);
    });

    it("should apply filled variant", () => {
      wrapper = mountSelect({ variant: "filled" });
      expect(wrapper.find(".o2-select--filled").exists()).toBe(true);
    });

    it("should show selected value text when modelValue is set", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, modelValue: "Beta" });
      expect(wrapper.find(".o2-select__value").text()).toBe("Beta");
    });

    it("should toggle dropdown: click again closes it", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(getDropdown()).not.toBeNull();
      await wrapper.find(".o2-select__control").trigger("click");
      await flushPromises();
      expect(getDropdown()).toBeNull();
    });
  });

  // ─── emit-value + map-options (Pattern D advanced) ────────────────────────

  describe("emit-value + map-options", () => {
    it("should emit the option-value primitive when emit-value is true", async () => {
      wrapper = mountSelect({
        options: OBJECT_OPTIONS,
        emitValue: true,
        mapOptions: true,
        modelValue: null,
      });
      await openDropdown(wrapper);
      getOptionAt(0).click();
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["logs"]);
    });

    it("should display the option label when model value is a primitive (mapOptions)", () => {
      wrapper = mountSelect({
        options: OBJECT_OPTIONS,
        emitValue: true,
        mapOptions: true,
        modelValue: "metrics",
      });
      expect(wrapper.find(".o2-select__value").text()).toBe("Metrics");
    });

    it("should mark the matching option as selected", async () => {
      wrapper = mountSelect({
        options: OBJECT_OPTIONS,
        emitValue: true,
        mapOptions: true,
        modelValue: "traces",
      });
      await openDropdown(wrapper);
      expect(
        getOptionAt(2).classList.contains("o2-select__option--selected"),
      ).toBe(true);
      expect(
        getOptionAt(0).classList.contains("o2-select__option--selected"),
      ).toBe(false);
    });

    it("should use custom option-label property", () => {
      const opts = [
        { name: "Option One", id: 1 },
        { name: "Option Two", id: 2 },
      ];
      wrapper = mountSelect({
        options: opts,
        optionLabel: "name",
        optionValue: "id",
        emitValue: true,
        modelValue: 1,
      });
      expect(wrapper.find(".o2-select__value").text()).toBe("Option One");
    });

    it("should use option-label as a function", () => {
      const opts = [{ code: "US", country: "United States" }];
      wrapper = mountSelect({
        options: opts,
        optionLabel: (o: unknown) => (o as { country: string }).country,
        modelValue: opts[0],
      });
      expect(wrapper.find(".o2-select__value").text()).toBe("United States");
    });
  });

  // ─── Pattern B: Multiple selection ───────────────────────────────────────

  describe("Pattern B — multiple selection", () => {
    it("should not close dropdown after selecting when multiple", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: [],
      });
      await openDropdown(wrapper);
      getOptionAt(0).click();
      await flushPromises();
      expect(getDropdown()).not.toBeNull();
    });

    it("should add to array on first selection", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: [],
      });
      await openDropdown(wrapper);
      getOptionAt(0).click();
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["Alpha"]]);
    });

    it("should remove from array when selecting an already-selected option", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: ["Alpha", "Beta"],
      });
      await openDropdown(wrapper);
      getOptionAt(0).click(); // deselect Alpha
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["Beta"]]);
    });

    it("should mark multiple selected options", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: ["Alpha", "Gamma"],
      });
      await openDropdown(wrapper);
      expect(
        getOptionAt(0).classList.contains("o2-select__option--selected"),
      ).toBe(true);
      expect(
        getOptionAt(1).classList.contains("o2-select__option--selected"),
      ).toBe(false);
      expect(
        getOptionAt(2).classList.contains("o2-select__option--selected"),
      ).toBe(true);
    });

    it("should emit multiple with emit-value", async () => {
      wrapper = mountSelect({
        options: OBJECT_OPTIONS,
        multiple: true,
        emitValue: true,
        mapOptions: true,
        modelValue: [],
      });
      await openDropdown(wrapper);
      getOptionAt(0).click();
      await flushPromises();
      getOptionAt(2).click();
      await flushPromises();
      const emits = wrapper.emitted("update:modelValue")!;
      expect(emits[0]).toEqual([["logs"]]);
      expect(emits[1]).toEqual([["logs", "traces"]]);
    });

    it("should respect maxValues limit", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: ["Alpha", "Beta"],
        maxValues: 2,
      });
      await openDropdown(wrapper);
      getOptionAt(2).click(); // try to add Gamma
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  // ─── Pattern B: Chips ────────────────────────────────────────────────────

  describe("Pattern B — chips display", () => {
    it("should render chips for selected values when useChips", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        useChips: true,
        modelValue: ["Alpha", "Beta"],
      });
      const chips = wrapper.findAll(".o2-select__chip");
      expect(chips).toHaveLength(2);
      expect(chips[0].find(".o2-select__chip-label").text()).toBe("Alpha");
      expect(chips[1].find(".o2-select__chip-label").text()).toBe("Beta");
    });

    it("should remove a chip on click of its remove button", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        useChips: true,
        modelValue: ["Alpha", "Beta"],
      });
      await wrapper.findAll(".o2-select__chip-remove")[0].trigger("click");
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["Beta"]]);
    });

    it("should remove last chip on Backspace with empty input", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        useChips: true,
        useInput: true,
        modelValue: ["Alpha", "Beta"],
      });
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "Backspace" });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["Alpha"]]);
    });
  });

  // ─── Pattern A: Search / filter ───────────────────────────────────────────

  describe("Pattern A — search and filter", () => {
    it("should show search input in trigger when useInput", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, useInput: true });
      await openDropdown(wrapper);
      expect(wrapper.find(".o2-select__input").exists()).toBe(true);
    });

    it("should do internal filtering when no @filter listener", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, useInput: true });
      await openDropdown(wrapper);
      const input = wrapper.find(".o2-select__input");
      await input.setValue("al");
      await input.trigger("input");
      await flushPromises();
      // Only 'Alpha' matches 'al'
      expect(getOptions()).toHaveLength(1);
      expect(getOptionAt(0).textContent?.trim()).toBe("Alpha");
    });

    it("should show all options when filter cleared", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, useInput: true });
      await openDropdown(wrapper);
      const input = wrapper.find(".o2-select__input");
      await input.setValue("al");
      await input.trigger("input");
      await input.setValue("");
      await input.trigger("input");
      await flushPromises();
      expect(getOptions()).toHaveLength(4);
    });

    it("should emit @filter event with input value and update callback", async () => {
      const filterHandler = vi.fn(
        (val: string, update: (fn: () => void) => void) => {
          update(() => {}); // no-op: consumer would filter their own options ref
        },
      );
      wrapper = mount(O2Select, {
        props: { options: SIMPLE_OPTIONS, useInput: true },
        attrs: { onFilter: filterHandler },
        attachTo: document.body,
      });
      await openDropdown(wrapper);
      const input = wrapper.find(".o2-select__input");
      await input.setValue("alp");
      await input.trigger("input");
      await flushPromises();
      expect(filterHandler).toHaveBeenCalledWith(
        "alp",
        expect.any(Function),
        expect.any(Function),
      );
    });

    it("should emit @filter with empty string on open (Quasar-compatible)", async () => {
      const filterHandler = vi.fn(
        (_val: string, update: (fn: () => void) => void) => {
          update(() => {});
        },
      );
      wrapper = mount(O2Select, {
        props: { options: SIMPLE_OPTIONS, useInput: true },
        attrs: { onFilter: filterHandler },
        attachTo: document.body,
      });
      await openDropdown(wrapper);
      expect(filterHandler).toHaveBeenCalledWith(
        "",
        expect.any(Function),
        expect.any(Function),
      );
    });

    it("should show selected label in input when fillInput and closed", () => {
      wrapper = mountSelect({
        options: OBJECT_OPTIONS,
        useInput: true,
        fillInput: true,
        hideSelected: true,
        emitValue: true,
        mapOptions: true,
        modelValue: "logs",
      });
      const input = wrapper.find(".o2-select__input");
      expect((input.element as HTMLInputElement).value).toBe("Logs");
    });

    it("should emit @input-value on each keystroke", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, useInput: true });
      await openDropdown(wrapper);
      const input = wrapper.find(".o2-select__input");
      await input.setValue("te");
      await input.trigger("input");
      await flushPromises();
      expect(wrapper.emitted("input-value")).toBeTruthy();
      expect(wrapper.emitted("input-value")![0]).toEqual(["te"]);
    });
  });

  // ─── Debounce ─────────────────────────────────────────────────────────────

  describe("input debounce", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("should debounce @filter emission", async () => {
      const filterHandler = vi.fn(
        (_val: string, update: (fn: () => void) => void) => {
          update(() => {});
        },
      );
      wrapper = mount(O2Select, {
        props: { options: SIMPLE_OPTIONS, useInput: true, inputDebounce: 300 },
        attrs: { onFilter: filterHandler },
        attachTo: document.body,
      });
      await openDropdown(wrapper);
      filterHandler.mockClear();

      const input = wrapper.find(".o2-select__input");
      await input.setValue("a");
      await input.trigger("input");
      await input.setValue("al");
      await input.trigger("input");

      expect(filterHandler).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      await flushPromises();
      expect(filterHandler).toHaveBeenCalledTimes(1);
      expect(filterHandler).toHaveBeenCalledWith(
        "al",
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  // ─── Pattern C: Tagging / new value ──────────────────────────────────────

  describe("Pattern C — tagging and new value creation", () => {
    it("should emit @new-value when Enter pressed with no matching option", async () => {
      const newValueHandler = vi.fn();
      wrapper = mount(O2Select, {
        props: {
          options: SIMPLE_OPTIONS,
          useInput: true,
          newValueMode: "add-unique",
        },
        attrs: { onNewValue: newValueHandler },
        attachTo: document.body,
      });
      await openDropdown(wrapper);
      const input = wrapper.find(".o2-select__input");
      await input.setValue("NewTag");
      await input.trigger("input");
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(newValueHandler).toHaveBeenCalledWith(
        "NewTag",
        expect.any(Function),
      );
    });
  });

  // ─── Pattern F: Validation ────────────────────────────────────────────────

  describe("Pattern F — validation", () => {
    const required = (v: unknown) =>
      (Array.isArray(v) ? v.length > 0 : !!v) || "Required";

    it("should not show error before interaction", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, rules: [required] });
      expect(wrapper.find(".o2-select--error").exists()).toBe(false);
    });

    it("should show error after validate() called with no value", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        rules: [required],
        modelValue: null,
      });
      const exposed = wrapper.vm as unknown as { validate: () => boolean };
      exposed.validate();
      await flushPromises();
      expect(wrapper.find(".o2-select--error").exists()).toBe(true);
      expect(wrapper.find(".o2-select__error-text").text()).toContain(
        "Required",
      );
    });

    it("should return true from validate() when value is valid", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        rules: [required],
        modelValue: "Alpha",
      });
      const exposed = wrapper.vm as unknown as { validate: () => boolean };
      expect(exposed.validate()).toBe(true);
    });

    it("should clear error after resetValidation()", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        rules: [required],
        modelValue: null,
      });
      const exposed = wrapper.vm as unknown as {
        validate: () => boolean;
        resetValidation: () => void;
      };
      exposed.validate();
      await flushPromises();
      expect(wrapper.find(".o2-select--error").exists()).toBe(true);
      exposed.resetValidation();
      await flushPromises();
      expect(wrapper.find(".o2-select--error").exists()).toBe(false);
    });

    it("should show external error when error=true", () => {
      wrapper = mountSelect({ error: true, errorMessage: "Server error" });
      expect(wrapper.find(".o2-select--error").exists()).toBe(true);
      expect(wrapper.find('[role="alert"]').text()).toContain("Server error");
    });

    it("should validate on close when lazyRules=true", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        rules: [required],
        modelValue: null,
        lazyRules: true,
      });
      await openDropdown(wrapper);
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "Escape" });
      await flushPromises();
      expect(wrapper.find(".o2-select--error").exists()).toBe(true);
    });

    it("should hide bottom space when hideBottomSpace and no error", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, hideBottomSpace: true });
      expect(wrapper.find(".o2-select__bottom").exists()).toBe(false);
    });

    it("should show bottom space when hideBottomSpace but there is an error", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        rules: [required],
        modelValue: null,
        hideBottomSpace: true,
      });
      const exposed = wrapper.vm as unknown as { validate: () => boolean };
      exposed.validate();
      await flushPromises();
      expect(wrapper.find(".o2-select__bottom").exists()).toBe(true);
    });
  });

  // ─── Clearable ────────────────────────────────────────────────────────────

  describe("clearable", () => {
    it("should show clear button when value present and clearable", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        modelValue: "Alpha",
        clearable: true,
      });
      expect(wrapper.find(".o2-select__clear").exists()).toBe(true);
    });

    it("should hide clear button when no value", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        modelValue: null,
        clearable: true,
      });
      expect(wrapper.find(".o2-select__clear").exists()).toBe(false);
    });

    it("should emit null on clear (single)", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        modelValue: "Alpha",
        clearable: true,
      });
      await wrapper.find(".o2-select__clear").trigger("click");
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([null]);
    });

    it("should emit empty array on clear (multiple)", async () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        modelValue: ["Alpha"],
        clearable: true,
      });
      await wrapper.find(".o2-select__clear").trigger("click");
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([[]]);
    });
  });

  // ─── Disabled / Loading ───────────────────────────────────────────────────

  describe("disabled and loading states", () => {
    it("should apply disabled class and prevent opening", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, disable: true });
      expect(wrapper.find(".o2-select--disabled").exists()).toBe(true);
      await openDropdown(wrapper);
      expect(getDropdown()).toBeNull();
    });

    it("should show spinner when loading", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, loading: true });
      expect(wrapper.find(".o2-select__spinner").exists()).toBe(true);
    });

    it("spinner should have aria-hidden", () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, loading: true });
      expect(
        wrapper.find(".o2-select__spinner").attributes("aria-hidden"),
      ).toBe("true");
    });
  });

  // ─── Disabled options ─────────────────────────────────────────────────────

  describe("option-disable", () => {
    it("should apply disabled class to disabled options", async () => {
      wrapper = mountSelect({
        options: DISABLED_OPTIONS,
        emitValue: true,
        mapOptions: true,
      });
      await openDropdown(wrapper);
      expect(
        getOptionAt(1).classList.contains("o2-select__option--disabled"),
      ).toBe(true);
      expect(
        getOptionAt(0).classList.contains("o2-select__option--disabled"),
      ).toBe(false);
    });

    it("should not emit when a disabled option is clicked", async () => {
      wrapper = mountSelect({
        options: DISABLED_OPTIONS,
        emitValue: true,
        mapOptions: true,
      });
      await openDropdown(wrapper);
      getOptionAt(1).click();
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  // ─── Pattern E: Custom slots ──────────────────────────────────────────────

  describe("Pattern E — custom slots", () => {
    it("should render #option slot when provided", async () => {
      wrapper = mountSelect(
        { options: SIMPLE_OPTIONS },
        { option: '<div data-test="custom-opt">custom</div>' },
      );
      await openDropdown(wrapper);
      expect(document.querySelector('[data-test="custom-opt"]')).not.toBeNull();
    });

    it("should render #no-option slot when options list is empty", async () => {
      wrapper = mountSelect(
        { options: [], useInput: true },
        { "no-option": '<div data-test="no-opt">Nothing here</div>' },
      );
      await openDropdown(wrapper);
      expect(document.querySelector('[data-test="no-opt"]')).not.toBeNull();
    });

    it("should render default no-option text when options empty and no slot", async () => {
      wrapper = mountSelect({ options: [] });
      await openDropdown(wrapper);
      expect(
        document.querySelector(".o2-select__no-option")?.textContent?.trim(),
      ).toBe("No options");
    });

    it("should render #hint slot", () => {
      wrapper = mountSelect(
        {},
        { hint: '<span data-test="hint">Helper text</span>' },
      );
      expect(wrapper.find('[data-test="hint"]').exists()).toBe(true);
    });
  });

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  describe("keyboard navigation", () => {
    it("should open dropdown on ArrowDown key", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      await flushPromises();
      expect(getDropdown()).not.toBeNull();
    });

    it("should navigate options with ArrowDown", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      await flushPromises();
      expect(
        getOptionAt(0).classList.contains("o2-select__option--focused"),
      ).toBe(true);
    });

    it("should select focused option on Enter", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS, modelValue: null });
      await openDropdown(wrapper);
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["Alpha"]);
    });

    it("should wrap navigation from last to first option", async () => {
      wrapper = mountSelect({ options: ["A", "B"] });
      await openDropdown(wrapper);
      // Go to last
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      // Wrap to first
      await wrapper
        .find(".o2-select__control")
        .trigger("keydown", { key: "ArrowDown" });
      await flushPromises();
      expect(
        getOptionAt(0).classList.contains("o2-select__option--focused"),
      ).toBe(true);
    });
  });

  // ─── Dropdown arrow icon ──────────────────────────────────────────────────

  describe("dropdown arrow", () => {
    it("should show arrow by default", () => {
      wrapper = mountSelect();
      expect(wrapper.find(".o2-select__arrow").exists()).toBe(true);
    });

    it("should hide arrow when hideDropdownIcon", () => {
      wrapper = mountSelect({ hideDropdownIcon: true });
      expect(wrapper.find(".o2-select__arrow").exists()).toBe(false);
    });

    it("should rotate arrow when dropdown is open", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(wrapper.find(".o2-select__arrow--open").exists()).toBe(true);
    });
  });

  // ─── Events ───────────────────────────────────────────────────────────────

  describe("events", () => {
    it("should emit popup-show on open", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(wrapper.emitted("popup-show")).toBeTruthy();
    });

    it("should emit popup-hide on close", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      await wrapper.find(".o2-select__control").trigger("click");
      await flushPromises();
      expect(wrapper.emitted("popup-hide")).toBeTruthy();
    });

    it("should emit focus event", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await wrapper.find(".o2-select__control").trigger("focus");
      expect(wrapper.emitted("focus")).toBeTruthy();
    });

    it("should emit blur event", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await wrapper.find(".o2-select__control").trigger("blur");
      expect(wrapper.emitted("blur")).toBeTruthy();
    });
  });

  // ─── Exposed API ──────────────────────────────────────────────────────────

  describe("exposed API", () => {
    it("should expose validate()", () => {
      wrapper = mountSelect();
      expect(
        typeof (wrapper.vm as unknown as { validate: () => boolean }).validate,
      ).toBe("function");
    });

    it("should expose resetValidation()", () => {
      wrapper = mountSelect();
      expect(
        typeof (wrapper.vm as unknown as { resetValidation: () => void })
          .resetValidation,
      ).toBe("function");
    });

    it("should expose focus()", () => {
      wrapper = mountSelect();
      expect(
        typeof (wrapper.vm as unknown as { focus: () => void }).focus,
      ).toBe("function");
    });
  });

  // ─── Accessibility ────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("should have role=combobox on control", () => {
      wrapper = mountSelect();
      expect(wrapper.find(".o2-select__control").attributes("role")).toBe(
        "combobox",
      );
    });

    it("should have aria-expanded=false when closed", () => {
      wrapper = mountSelect();
      expect(
        wrapper.find(".o2-select__control").attributes("aria-expanded"),
      ).toBe("false");
    });

    it("should have aria-expanded=true when open", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(
        wrapper.find(".o2-select__control").attributes("aria-expanded"),
      ).toBe("true");
    });

    it("dropdown should have role=listbox", async () => {
      wrapper = mountSelect({ options: SIMPLE_OPTIONS });
      await openDropdown(wrapper);
      expect(getDropdown()?.getAttribute("role")).toBe("listbox");
    });

    it("error message should have role=alert", async () => {
      wrapper = mountSelect({ error: true, errorMessage: "Required" });
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it("chip remove button should have aria-label", () => {
      wrapper = mountSelect({
        options: SIMPLE_OPTIONS,
        multiple: true,
        useChips: true,
        modelValue: ["Alpha"],
      });
      const removeBtn = wrapper.find(".o2-select__chip-remove");
      expect(removeBtn.attributes("aria-label")).toContain("Alpha");
    });
  });
});
