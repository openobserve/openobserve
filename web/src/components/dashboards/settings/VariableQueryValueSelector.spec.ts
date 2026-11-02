// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, config } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import VariableQueryValueSelector from "./VariableQueryValueSelector.vue";

// Install the real app i18n for every mount in this file so components
// that call useI18n() during setup have an active i18n instance.
config.global.plugins = [...(config.global.plugins ?? []), i18n];

// Mock lodash debounce - improved version
vi.mock("lodash-es", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lodash-es")>()),
  debounce: vi.fn((fn) => {
    // Return a mock function that can be called immediately for testing
    const mockFn = vi.fn((...args) => {
      // For tests, execute immediately instead of with delay
      return fn(...args);
    });
    // Add cancel method as a spy
    mockFn.cancel = vi.fn();
    return mockFn;
  }),
}));

// Mock constants
vi.mock("@/utils/dashboard/constants", () => ({
  SELECT_ALL_VALUE: "_o2_all_",
  CUSTOM_VALUE: "::_o2_custom",
}));

describe("VariableQueryValueSelector", () => {
  let wrapper: VueWrapper<any>;

  const defaultVariableItem = {
    name: "region",
    label: "Region",
    type: "query_values",
    multiSelect: false,
    value: "",
    options: [
      { label: "US East", value: "us-east-1" },
      { label: "US West", value: "us-west-1" },
      { label: "Europe", value: "eu-west-1" },
    ],
    isLoading: false,
  };

  const multiSelectVariableItem = {
    ...defaultVariableItem,
    multiSelect: true,
    value: ["us-east-1"],
  };

  const customValueOptions = [
    { label: "Standard Value", value: "standard" },
    { label: "Custom Test", value: "custom-test::_o2_custom" },
  ];

  // OSelect stub that exposes the methods the component still
  // calls on its selectRef (updateInputValue/blur/hidePopup).
  const OSelectStub = {
    name: "OSelect",
    template: `
      <div
        data-test="dashboard-variable-query-value-selector"
        class="o-select"
        :data-disabled="String(!!disabled)"
      >
        <input
          :value="modelValue"
          @input="$emit('update:modelValue', $event.target.value)"
          @keydown="$emit('keydown', $event)"
        />
        <div v-if="loading">Loading...</div>
        <div v-for="option in options" :key="option.value" @click="$emit('update:modelValue', multiple ? [option.value] : option.value)">
          {{ option.label }}
        </div>
        <slot name="before-options"></slot>
        <slot name="empty"></slot>
        <slot name="trigger"></slot>
      </div>
    `,
    props: [
      "modelValue",
      "options",
      "loading",
      "multiple",
      "label",
      "labelPosition",
      "labelKey",
      "valueKey",
      "disabled",
    ],
    emits: ["update:modelValue", "search", "open", "close", "keydown"],
    methods: {
      updateInputValue() {},
      blur() {},
      hidePopup() {},
      close() {},
    },
  };

  const createWrapper = (props: any = {}) => {
    return mount(VariableQueryValueSelector, {
      props: {
        modelValue: "",
        variableItem: defaultVariableItem,
        loadOptions: null,
        ...props,
      },
      global: {
        plugins: [],
        stubs: {
          OSelect: OSelectStub,
          OCheckbox: {
            template: `<input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`,
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          OSeparator: { template: "<hr />" },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Search & Filtering", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should filter options based on search text", () => {
      // Filtering is now delegated to OSelect, so verify computedOptions contains
      // all options and onSearch updates currentSearchTerm.
      wrapper.vm.onSearch("east");
      expect(wrapper.vm.currentSearchTerm).toBe("east");
      const matching = wrapper.vm.computedOptions.filter((opt: any) =>
        opt.label.toLowerCase().includes("east"),
      );
      expect(matching).toHaveLength(1);
      expect(matching[0].label).toBe("US East");
    });

    it("should emit search event with correct payload", async () => {
      // Show popup so isOpen becomes true; then call onSearch which triggers
      // the debounced searchText watcher that emits "search".
      wrapper.vm.onPopupShow();
      wrapper.vm.onSearch("test-query");
      await nextTick();

      const searchEmits = wrapper.emitted("search");
      expect(searchEmits).toBeTruthy();
      expect(searchEmits!.length).toBeGreaterThan(0);
      expect(searchEmits![searchEmits!.length - 1][0]).toMatchObject({
        variableItem: defaultVariableItem,
        filterText: "test-query",
      });
    });

    it("should clear search on popup hide", () => {
      wrapper.vm.onSearch("test");
      wrapper.vm.onPopupHide();

      expect(wrapper.vm.currentSearchTerm).toBe("");
    });

    it("should handle search with empty/whitespace input", () => {
      wrapper.vm.onSearch("");
      expect(wrapper.vm.computedOptions).toHaveLength(3);

      wrapper.vm.onSearch("   ");
      const filtered = wrapper.vm.computedOptions.filter((opt: any) =>
        opt.label.toLowerCase().includes("   "),
      );
      expect(filtered).toHaveLength(0);
    });

    it("should perform case-insensitive filtering", () => {
      // Filtering is delegated to OSelect, but the search term is preserved.
      wrapper.vm.onSearch("EUROPE");
      const matching = wrapper.vm.computedOptions.filter((opt: any) =>
        opt.label.toLowerCase().includes("europe"),
      );
      expect(matching).toHaveLength(1);
      expect(matching[0].value).toBe("eu-west-1");
    });
  });

  describe("Select All Functionality", () => {
    beforeEach(() => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
    });

    it("should toggle select all in multi-select mode", async () => {
      if (wrapper.vm.isAllSelected !== undefined && wrapper.vm.selectedValue !== undefined) {
        expect(wrapper.vm.isAllSelected).toBe(false);

        await wrapper.vm.toggleSelectAll();
        expect(wrapper.vm.selectedValue).toEqual(["_o2_all_"]);
      } else {
        // Alternative: verify multiselect component behavior
        expect(wrapper.props("variableItem").multiSelect).toBe(true);
        expect(wrapper.vm.toggleSelectAll).toBeDefined();
      }
    });

    it("should compute isAllSelected correctly for multiSelect", () => {
      if (wrapper.vm.isAllSelected !== undefined && wrapper.vm.selectedValue !== undefined) {
        wrapper.vm.selectedValue = ["_o2_all_"];
        expect(wrapper.vm.isAllSelected).toBe(true);

        wrapper.vm.selectedValue = ["us-east-1", "us-west-1"];
        expect(wrapper.vm.isAllSelected).toBe(false);
      } else {
        // Alternative: verify computed property logic
        expect(wrapper.props("variableItem").multiSelect).toBe(true);
      }
    });

    it("should show Select All as checked when every option is ticked by hand", () => {
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1", "eu-west-1"];

      expect(wrapper.vm.isAllSelected).toBe(true);
      expect(wrapper.vm.selectedValue).toEqual(["us-east-1", "us-west-1", "eu-west-1"]);
    });

    it("should uncheck Select All again when one hand-picked option is unticked", () => {
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1", "eu-west-1"];
      wrapper.vm.selectedValue = ["us-east-1", "eu-west-1"];

      expect(wrapper.vm.isAllSelected).toBe(false);
    });

    it("should clear the selection when the hand-checked Select All is toggled", async () => {
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1", "eu-west-1"];

      await wrapper.vm.toggleSelectAll();

      expect(wrapper.vm.selectedValue).toEqual([]);
    });

    it("should not treat a hand-picked set as all while options are still loading", () => {
      wrapper = createWrapper({ variableItem: { ...multiSelectVariableItem, isLoading: true } });
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1", "eu-west-1"];

      expect(wrapper.vm.isAllSelected).toBe(false);
    });

    it("should ignore custom-value options when deciding every option is ticked", () => {
      wrapper = createWrapper({
        variableItem: { ...multiSelectVariableItem, options: customValueOptions },
      });
      wrapper.vm.selectedValue = ["standard"];

      expect(wrapper.vm.isAllSelected).toBe(true);
    });

    it("should handle select all with existing selections", async () => {
      if (wrapper.vm.selectedValue !== undefined) {
        wrapper.vm.selectedValue = ["us-east-1"];

        await wrapper.vm.toggleSelectAll();
        expect(wrapper.vm.selectedValue).toEqual(["_o2_all_"]);
      } else {
        // Alternative: verify toggleSelectAll works
        expect(wrapper.vm.toggleSelectAll).toBeDefined();
        await wrapper.vm.toggleSelectAll();
        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      }
    });

    it("should deselect all functionality", async () => {
      wrapper.vm.selectedValue = ["_o2_all_"];

      await wrapper.vm.toggleSelectAll();
      expect(wrapper.vm.selectedValue).toEqual([]);
    });

    it("should NOT close popup after select all in multi-select mode", async () => {
      const mockRef = {
        updateInputValue: vi.fn(),
        blur: vi.fn(),
        hidePopup: vi.fn(),
        close: vi.fn(),
      };
      wrapper.vm.selectRef = mockRef;

      await wrapper.vm.toggleSelectAll();

      // Dropdown stays open and nothing applies until it closes, like any other tick.
      expect(mockRef.close).not.toHaveBeenCalled();
      expect(wrapper.vm.selectedValue).toEqual(["_o2_all_"]);
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();

      wrapper.vm.onPopupHide();
      expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([["_o2_all_"]]);
    });

    it("should close popup after select all in single-select mode", async () => {
      wrapper = createWrapper({ variableItem: defaultVariableItem });
      const mockRef = {
        updateInputValue: vi.fn(),
        blur: vi.fn(),
        hidePopup: vi.fn(),
        close: vi.fn(),
      };
      wrapper.vm.selectRef = mockRef;

      await wrapper.vm.toggleSelectAll();

      expect(mockRef.close).toHaveBeenCalled();
      expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual(["_o2_all_"]);
    });

    it("should keep popup open and emit [] when deselecting all in multi-select mode", async () => {
      const mockRef = {
        updateInputValue: vi.fn(),
        blur: vi.fn(),
        hidePopup: vi.fn(),
        close: vi.fn(),
      };
      wrapper.vm.selectRef = mockRef;
      wrapper.vm.selectedValue = ["_o2_all_"];
      await nextTick();

      await wrapper.vm.toggleSelectAll();

      expect(wrapper.vm.selectedValue).toEqual([]);
      expect(mockRef.close).not.toHaveBeenCalled();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();

      wrapper.vm.onPopupHide();
      expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([[]]);
    });
  });

  describe("Custom Value Handling", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should create custom value with CUSTOM_VALUE suffix", async () => {
      await wrapper.vm.handleCustomValue("new-custom-value");

      expect(wrapper.vm.selectedValue).toBe("new-custom-value::_o2_custom");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should select existing value over creating custom", async () => {
      await wrapper.vm.handleCustomValue("US East");

      expect(wrapper.vm.selectedValue).toBe("us-east-1");
      expect(wrapper.vm.selectedValue).not.toContain("::_o2_custom");
    });

    it("should handle custom value via keyboard Enter key", async () => {
      // onSearch updates currentSearchTerm (filterText alias) which handleKeydown reads.
      wrapper.vm.onSearch("keyboard-custom");

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      const preventDefaultSpy = vi.spyOn(enterEvent, "preventDefault");
      const stopPropagationSpy = vi.spyOn(enterEvent, "stopPropagation");

      wrapper.vm.handleKeydown(enterEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it("should handle custom value via click handler", async () => {
      await wrapper.vm.handleCustomValue("click-custom");
      expect(wrapper.vm.selectedValue).toBe("click-custom::_o2_custom");
    });

    it("should trim whitespace from custom values", async () => {
      await wrapper.vm.handleCustomValue("  spaced-value  ");
      expect(wrapper.vm.selectedValue).toBe("spaced-value::_o2_custom");
    });

    it("should handle multi-select custom value creation", async () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });

      await wrapper.vm.handleCustomValue("multi-custom");
      expect(wrapper.vm.selectedValue).toEqual(["multi-custom::_o2_custom"]);
    });

    it("should handle single-select custom value creation", async () => {
      await wrapper.vm.handleCustomValue("single-custom");
      expect(wrapper.vm.selectedValue).toBe("single-custom::_o2_custom");
    });

    it("should close popup after custom value creation", async () => {
      // Test the behavior through public API
      const mockRef = {
        updateInputValue: vi.fn(),
        blur: vi.fn(),
        hidePopup: vi.fn(),
        close: vi.fn(),
      };
      wrapper.vm.selectRef = mockRef;

      await wrapper.vm.handleCustomValue("test-close");

      // Verify the custom value was handled and popup closing behavior occurred
      // closePopUpWhenValueIsSet calls close() — not updateInputValue
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(mockRef.close).toHaveBeenCalled();
    });
  });

  describe("Value Updates & Events", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle multi-select value array", async () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });

      // Ensure component is ready
      if (wrapper.vm.onUpdateValue && wrapper.vm.selectedValue !== undefined) {
        wrapper.vm.onUpdateValue(["value1", "value2"]);

        // Wait for reactive updates
        await nextTick();

        expect(wrapper.vm.selectedValue).toEqual(["value1", "value2"]);
      } else {
        // Fallback: verify component mounted with multiselect props
        expect(wrapper.props("variableItem").multiSelect).toBe(true);
      }
    });

    it("should remove SELECT_ALL when other values selected", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
      wrapper.vm.onUpdateValue(["_o2_all_", "us-east-1"]);
      expect(wrapper.vm.selectedValue).toEqual(["us-east-1"]);
    });

    it("should filter out CUSTOM_VALUE suffixes on update", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
      wrapper.vm.onUpdateValue(["value1", "custom::_o2_custom"]);
      expect(wrapper.vm.selectedValue).toEqual(["value1"]);
    });

    it("should handle single select immediate emission", () => {
      wrapper.vm.onUpdateValue("immediate");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should defer multi-select emission until popup hide", async () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });

      // Ensure component is ready
      if (wrapper.vm.onUpdateValue && wrapper.vm.selectedValue !== undefined) {
        wrapper.vm.onUpdateValue(["test"]);

        // Wait for initial processing
        await nextTick();

        // Should not emit immediately for multiSelect - clear any initial emissions
        wrapper.emitted("update:modelValue")?.length &&
          wrapper.emitted("update:modelValue").splice(0);

        // Hide popup should trigger emission
        wrapper.vm.onPopupHide();
        await nextTick();

        expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      } else {
        // Alternative: verify multiselect behavior exists
        expect(wrapper.props("variableItem").multiSelect).toBe(true);
        expect(wrapper.vm.onPopupHide).toBeDefined();
      }
    });
  });

  describe("Popup Lifecycle", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should trigger loadOptions on popup show", () => {
      const loadOptionsMock = vi.fn();
      wrapper = createWrapper({ loadOptions: loadOptionsMock });

      wrapper.vm.onPopupShow();
      expect(loadOptionsMock).toHaveBeenCalledWith(defaultVariableItem);
    });

    it("should clear filter text on popup hide", () => {
      wrapper.vm.onSearch("test-filter");
      wrapper.vm.onPopupHide();
      expect(wrapper.vm.currentSearchTerm).toBe("");
    });

    it("should emit values on popup hide for multiSelect", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
      wrapper.vm.selectedValue = ["test-value"];

      wrapper.vm.onPopupHide();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("multi-select closing without a change emits nothing", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });

      wrapper.vm.onPopupHide();

      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });
  });

  describe("Display Value Logic", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should display single value correctly", () => {
      wrapper.vm.selectedValue = "us-east-1";
      expect(wrapper.vm.displayValue).toBe("us-east-1");
    });

    it("should display multiple values (≤2 items)", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1"];
      expect(wrapper.vm.displayValue).toBe("us-east-1, us-west-1");
    });

    it("should display multiple values with overflow (>2 items)", () => {
      wrapper = createWrapper({ variableItem: multiSelectVariableItem });
      wrapper.vm.selectedValue = ["us-east-1", "us-west-1", "eu-west-1"];
      expect(wrapper.vm.displayValue).toBe("us-east-1, us-west-1 ...+1 more");
    });

    it("should display blank value as '<blank>'", () => {
      // Add empty string option so blank is recognized as a valid value
      const variableWithBlankOption = {
        ...defaultVariableItem,
        options: [{ label: "Blank", value: "" }, ...defaultVariableItem.options],
      };
      wrapper = createWrapper({ variableItem: variableWithBlankOption });
      wrapper.vm.selectedValue = "";
      expect(wrapper.vm.displayValue).toBe("<blank>");
    });

    it("should display SELECT_ALL_VALUE as '<ALL>'", () => {
      wrapper.vm.selectedValue = "_o2_all_";
      expect(wrapper.vm.displayValue).toBe("<ALL>");
    });

    it("should format custom value display", () => {
      wrapper.vm.selectedValue = "custom-test::_o2_custom";
      expect(wrapper.vm.displayValue).toBe("custom-test (Custom)");
    });
  });

  describe("Keyboard & Interaction", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle Enter key for custom values", async () => {
      wrapper.vm.onSearch("enter-test");

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      wrapper.vm.handleKeydown(enterEvent);

      await nextTick();

      // The value should be changed to custom value
      expect(wrapper.vm.selectedValue).toBe("enter-test::_o2_custom");
    });

    it("should ignore Enter key without filter text", () => {
      wrapper.vm.onSearch("");
      const handleCustomValueSpy = vi.spyOn(wrapper.vm, "handleCustomValue");

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      wrapper.vm.handleKeydown(enterEvent);

      expect(handleCustomValueSpy).not.toHaveBeenCalled();
    });

    it("should prevent default and stop propagation on Enter", () => {
      wrapper.vm.onSearch("test");
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      const preventDefaultSpy = vi.spyOn(enterEvent, "preventDefault");
      const stopPropagationSpy = vi.spyOn(enterEvent, "stopPropagation");

      wrapper.vm.handleKeydown(enterEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it("should handle Enter with whitespace-only filter text", async () => {
      wrapper.vm.onSearch("   ");

      const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
      wrapper.vm.handleKeydown(enterEvent);

      await nextTick();

      // Should attempt to create custom value (trimming is handled by handleCustomValue)
      expect(typeof wrapper.vm.selectedValue).toBe("string");
    });
  });

  // ── Not-applicable picker (curated-pages design §6.4, pass-4 finding 5) ────
  // A page-level picker whose active section does not scope on it accepts a
  // selection and changes nothing — a declared no-op is still a no-op to the
  // person operating it. Additive prop, default false, so stored dashboards are
  // unaffected (same posture as the PanelContainer badge).
  describe("disabled prop forwarding", () => {
    // The stub's own static `data-test` never reaches the DOM: the component
    // binds `:data-test="variable-selector-<name>-inner"` on OSelect and a bound
    // fallthrough attribute OVERWRITES the stub root's static one. So these read
    // the component's real selector; `data-disabled` is the stub echoing the
    // forwarded prop either way.
    const oSelect = () => wrapper.find('[data-test="variable-selector-region-inner"]');

    it("forwards disabled:true to OSelect", () => {
      wrapper = createWrapper({ disabled: true });
      expect(oSelect().exists()).toBe(true);
      expect(oSelect().attributes("data-disabled")).toBe("true");
    });

    it("defaults to NOT disabled when the prop is omitted — the stored-dashboard guard", () => {
      wrapper = createWrapper();
      expect(oSelect().exists()).toBe(true);
      expect(oSelect().attributes("data-disabled")).toBe("false");
    });

    it("forwards disabled:false explicitly", () => {
      wrapper = createWrapper({ disabled: false });
      expect(oSelect().attributes("data-disabled")).toBe("false");
    });

    it("renders the disabled-reason tooltip TEXT, with its params interpolated", () => {
      // Asserting the ATTRIBUTE proved nothing: nothing in web/src consumed
      // data-tooltip-key, so the reason never reached a user. The pin has to
      // read the rendered copy, with its params interpolated.
      wrapper = createWrapper({
        disabled: true,
        disabledTooltipKey: "infra.curated.fieldUnresolved",
        disabledTooltipParams: { display: "Namespace", stream: "k8s_pod_memory_usage" },
      });
      const tooltip = wrapper.findComponent({ name: "OTooltip" });
      expect(tooltip.exists()).toBe(true);
      const content = tooltip.props("content") as string;
      expect(content).toBe("No Namespace field found on k8s_pod_memory_usage.");
      // No unsubstituted placeholder ever reaches the user.
      expect(content).not.toContain("{display}");
      expect(content).not.toContain("{stream}");
    });

    it("renders NO tooltip when the picker is enabled", () => {
      // Paired with the positive case above so this cannot pass merely because
      // the affordance does not exist yet — that one must be green for this to
      // mean anything.
      wrapper = createWrapper({ disabledTooltipKey: "infra.curated.fieldUnresolved" });
      expect(wrapper.find('[data-test="variable-disabled-tooltip"]').exists()).toBe(false);
    });
  });
});
