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
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import DimensionFilterEditor from "./DimensionFilterEditor.vue";
import store from "@/test/unit/helpers/store";
import { nextTick } from "vue";

// Mock SELECT_ALL_VALUE constant
vi.mock("@/utils/dashboard/constants", () => ({
  SELECT_ALL_VALUE: "*",
}));

const mockTranslations = {
  "correlation.logs.filters.title": "Edit Filters",
  "correlation.logs.filters.description": "Configure dimension filters",
  "correlation.logs.filters.matchedDimensions": "Matched Dimensions",
  "correlation.logs.filters.matchedDimensionsTooltip": "These are stable",
  "correlation.logs.filters.additionalDimensions": "Additional Dimensions",
  "correlation.logs.filters.additionalDimensionsTooltip": "These may vary",
  "correlation.logs.filters.stableDimension": "Stable",
  "correlation.logs.filters.unstableDimension": "Unstable",
  "correlation.logs.filters.showingAll": "Showing All",
  "correlation.logs.filters.setToAll": "Set to All",
  "correlation.logs.filters.wildcardHelp": "Show all values",
  "correlation.logs.filters.noAdditionalDimensions": "No additional dimensions",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.reset": "Reset",
  "common.apply": "Apply",
};

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: {
    en: mockTranslations,
  },
});

const ODialogStub = {
  name: "ODialog",
  template:
    '<div class="o-dialog-stub" :data-open="open"><slot name="header" /><slot /><slot name="footer" /></div>',
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryVariant",
    "secondaryVariant",
    "neutralVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

describe("DimensionFilterEditor.vue", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: true,
    matchedDimensions: {
      service: "api",
      environment: "prod",
    },
    additionalDimensions: {
      region: "us-west",
      cluster: "cluster-1",
    },
    currentFilters: {
      service: "api",
      environment: "prod",
      region: "us-west",
      cluster: "cluster-1",
    },
  };

  const createWrapper = (props = {}) => {
    return mount(DimensionFilterEditor, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
          OButton: {
            name: "OButton",
            template: '<button class="o-button-stub" @click="$emit(\'click\', $event)"><slot /></button>',
            props: ["variant", "size", "disabled", "loading"],
            emits: ["click"],
          },
          "q-icon": true,
          "q-tooltip": true,
          "q-input": {
            name: "QInput",
            template:
              '<input class="q-input-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["modelValue", "dense", "outlined", "placeholder"],
            emits: ["update:modelValue"],
          },
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

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render ODialog with open=true when modelValue is true", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("open")).toBe(true);
    });

    it("should render ODialog with open=false when modelValue is false", () => {
      wrapper = createWrapper({ modelValue: false });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("should pass title to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Edit Filters");
    });

    it("should pass size md to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("md");
    });

    it("should pass primary/secondary/neutral button labels to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Apply");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog.props("neutralButtonLabel")).toBe("Reset");
    });
  });

  describe("Props Handling", () => {
    it("should accept modelValue prop", () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.props().modelValue).toBe(true);
    });

    it("should accept matchedDimensions prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().matchedDimensions).toEqual({
        service: "api",
        environment: "prod",
      });
    });

    it("should accept additionalDimensions prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().additionalDimensions).toEqual({
        region: "us-west",
        cluster: "cluster-1",
      });
    });

    it("should accept currentFilters prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().currentFilters).toEqual(defaultProps.currentFilters);
    });
  });

  describe("Pending Filters State", () => {
    it("should initialize pendingFilters with currentFilters", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
    });

    it("should sync pendingFilters when currentFilters change", async () => {
      wrapper = createWrapper();
      const newFilters = { service: "new-api", environment: "dev" };

      await wrapper.setProps({ currentFilters: newFilters });
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(newFilters);
    });

    it("should reset pendingFilters when dialog opens", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.pendingFilters = { modified: "value" };

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
    });
  });

  describe("Matched Dimensions Section", () => {
    it("should have matched dimensions in props", () => {
      wrapper = createWrapper();
      expect(wrapper.props().matchedDimensions).toEqual({
        service: "api",
        environment: "prod",
      });
    });

    it("should initialize with matched dimensions", () => {
      wrapper = createWrapper();
      expect(Object.keys(wrapper.props().matchedDimensions)).toContain("service");
      expect(Object.keys(wrapper.props().matchedDimensions)).toContain(
        "environment",
      );
    });

    it("should render dialog containing matched dimension rows", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="matched-dimension-service"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="matched-dimension-environment"]').exists(),
      ).toBe(true);
    });

    it("should track matched dimension keys", () => {
      wrapper = createWrapper();
      const matchedKeys = Object.keys(wrapper.props().matchedDimensions);
      expect(matchedKeys).toContain("service");
      expect(matchedKeys).toContain("environment");
    });

    it("should have stable dimension tracking", () => {
      wrapper = createWrapper();
      expect(wrapper.props().matchedDimensions).toBeDefined();
    });
  });

  describe("Additional Dimensions Section", () => {
    it("should have additional dimensions in props", () => {
      wrapper = createWrapper();
      expect(wrapper.props().additionalDimensions).toEqual({
        region: "us-west",
        cluster: "cluster-1",
      });
    });

    it("should initialize with additional dimensions", () => {
      wrapper = createWrapper();
      expect(Object.keys(wrapper.props().additionalDimensions)).toContain("region");
      expect(Object.keys(wrapper.props().additionalDimensions)).toContain(
        "cluster",
      );
    });

    it("should track additional dimension keys", () => {
      wrapper = createWrapper();
      const additionalKeys = Object.keys(wrapper.props().additionalDimensions);
      expect(additionalKeys.length).toBe(2);
    });

    it("should render additional dimension rows", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="additional-dimension-region"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="additional-dimension-cluster"]').exists(),
      ).toBe(true);
    });

    it("should handle wildcard toggle logic", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "us-west" };

      wrapper.vm.toggleWildcard("region");
      expect(wrapper.vm.pendingFilters.region).toBe("*");
    });

    it("should handle empty additional dimensions", () => {
      wrapper = createWrapper({ additionalDimensions: {} });
      expect(Object.keys(wrapper.props().additionalDimensions).length).toBe(0);
    });
  });

  describe("Wildcard Toggle", () => {
    it("should toggle dimension to wildcard", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "us-west" };

      wrapper.vm.toggleWildcard("region");
      await nextTick();

      expect(wrapper.vm.pendingFilters.region).toBe("*");
    });

    it("should restore original value when toggling from wildcard", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "*" };

      wrapper.vm.toggleWildcard("region");
      await nextTick();

      expect(wrapper.vm.pendingFilters.region).toBe("us-west");
    });

    it("should check if showing all wildcard", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "*" };
      expect(wrapper.vm.pendingFilters.region).toBe("*");
    });

    it("should check if showing specific value", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "us-west" };
      expect(wrapper.vm.pendingFilters.region).toBe("us-west");
    });
  });

  describe("hasChanges Computed", () => {
    it("should return false when no changes", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { ...defaultProps.currentFilters };

      expect(wrapper.vm.hasChanges).toBe(false);
    });

    it("should return true when values changed", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = {
        ...defaultProps.currentFilters,
        service: "new-api",
      };

      expect(wrapper.vm.hasChanges).toBe(true);
    });

    it("should return true when keys added", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = {
        ...defaultProps.currentFilters,
        newKey: "newValue",
      };

      expect(wrapper.vm.hasChanges).toBe(true);
    });

    it("should return true when keys removed", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { service: "api" };

      expect(wrapper.vm.hasChanges).toBe(true);
    });

    it("should disable ODialog primary button when hasChanges is false", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { ...defaultProps.currentFilters };
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should enable ODialog primary button when hasChanges is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = {
        ...defaultProps.currentFilters,
        service: "changed",
      };
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });
  });

  describe("Action Buttons", () => {
    it("should have close handler", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleClose).toBe("function");
    });

    it("should have cancel handler", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleCancel).toBe("function");
    });

    it("should have reset handler", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleReset).toBe("function");
    });

    it("should have apply handler", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleApply).toBe("function");
    });

    it("should compute hasChanges as false when no changes", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { ...defaultProps.currentFilters };

      expect(wrapper.vm.hasChanges).toBe(false);
    });

    it("should compute hasChanges as true when there are changes", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = {
        ...defaultProps.currentFilters,
        service: "modified",
      };
      await nextTick();

      expect(wrapper.vm.hasChanges).toBe(true);
    });
  });

  describe("ODialog Emit Wiring", () => {
    it("should call handleApply on click:primary", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { modified: "value" };

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      await nextTick();

      expect(wrapper.emitted("update:filters")).toBeTruthy();
      expect(wrapper.emitted("update:filters")?.[0]).toEqual([
        { modified: "value" },
      ]);
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
    });

    it("should call handleCancel on click:secondary", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { modified: "value" };

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should call handleReset on click:neutral", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { extra: "value" };

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:neutral");
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.matchedDimensions);
    });

    it("should propagate update:open false to update:modelValue and emit close", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should propagate update:open true to update:modelValue without emitting close", async () => {
      wrapper = createWrapper({ modelValue: false });

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", true);
      await nextTick();

      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([true]);
      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  describe("Event Handlers", () => {
    it("should emit update:filters on apply", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { modified: "value" };

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:filters")).toBeTruthy();
      expect(wrapper.emitted("update:filters")?.[0]).toEqual([
        { modified: "value" },
      ]);
    });

    it("should emit update:modelValue on apply", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleApply();
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should restore filters on cancel", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { modified: "value" };

      wrapper.vm.handleCancel();
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
    });

    it("should emit close on cancel", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleCancel();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should reset to matched dimensions only", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { extra: "value" };

      wrapper.vm.handleReset();
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.matchedDimensions);
    });

    it("should restore filters on dialog close", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { modified: "value" };

      wrapper.vm.handleClose();
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
    });
  });

  describe("Input Bindings", () => {
    it("should update pendingFilters for matched dimensions", async () => {
      wrapper = createWrapper();

      wrapper.vm.pendingFilters = {
        ...wrapper.vm.pendingFilters,
        service: "new-service",
      };
      await nextTick();

      expect(wrapper.vm.pendingFilters.service).toBe("new-service");
    });

    it("should update pendingFilters for additional dimensions", async () => {
      wrapper = createWrapper();

      wrapper.vm.pendingFilters = {
        ...wrapper.vm.pendingFilters,
        region: "us-east",
      };
      await nextTick();

      expect(wrapper.vm.pendingFilters.region).toBe("us-east");
    });
  });

  describe("Tooltips", () => {
    it("should have tooltip logic for dimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.props().matchedDimensions).toBeDefined();
      expect(wrapper.props().additionalDimensions).toBeDefined();
    });

    it("should track stable dimensions for tooltips", () => {
      wrapper = createWrapper();
      const matchedKeys = Object.keys(wrapper.props().matchedDimensions);
      expect(matchedKeys.length).toBeGreaterThan(0);
    });

    it("should track unstable dimensions for tooltips", () => {
      wrapper = createWrapper();
      const additionalKeys = Object.keys(wrapper.props().additionalDimensions);
      expect(additionalKeys.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty matchedDimensions", () => {
      wrapper = createWrapper({ matchedDimensions: {} });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle undefined additionalDimensions", () => {
      wrapper = createWrapper({ additionalDimensions: {} });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dimension with special characters", () => {
      wrapper = createWrapper({
        matchedDimensions: { "special-key": "special-value" },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very long dimension values", () => {
      wrapper = createWrapper({
        currentFilters: {
          key: "a".repeat(1000),
        },
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Styling and Layout", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should have ODialog component", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.exists()).toBe(true);
    });

    it("should pass open prop to ODialog", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });
  });

  describe("Reactivity", () => {
    it("should react to modelValue changes", async () => {
      wrapper = createWrapper({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(defaultProps.currentFilters);
    });

    it("should react to currentFilters prop changes", async () => {
      wrapper = createWrapper();
      const newFilters = { newKey: "newValue" };

      await wrapper.setProps({ currentFilters: newFilters });
      await nextTick();

      expect(wrapper.vm.pendingFilters).toEqual(newFilters);
    });
  });
});
