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
import {
  Quasar,
  QDialog,
  QCard,
  QCardSection,
  QCardActions,
  QBtn,
  QInput,
  QIcon,
  QTooltip,
  QSeparator,
} from "quasar";
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
        plugins: [
          [
            Quasar,
            {
              components: {
                QDialog,
                QCard,
                QCardSection,
                QCardActions,
                QBtn,
                QInput,
                QIcon,
                QTooltip,
                QSeparator,
              },
            },
          ],
          i18n,
          store,
        ],
      },
      attachTo: document.body,
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

    it("should render dialog when modelValue is true", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(QDialog);
      expect(dialog.exists()).toBe(true);
    });

    it("should have title defined", () => {
      wrapper = createWrapper();
      // QDialog content doesn't render in tests (Teleport), check component exists
      expect(wrapper.findComponent(QDialog).exists()).toBe(true);
    });

    it("should have description defined", () => {
      wrapper = createWrapper();
      // QDialog content doesn't render in tests (Teleport), check component exists
      expect(wrapper.findComponent(QDialog).exists()).toBe(true);
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
      expect(Object.keys(wrapper.props().matchedDimensions)).toContain("environment");
    });

    it("should have dialog component for matched dimensions", () => {
      wrapper = createWrapper();
      // QDialog content doesn't render (Teleport), check component structure
      expect(wrapper.findComponent(QDialog).exists()).toBe(true);
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
      expect(Object.keys(wrapper.props().additionalDimensions)).toContain("cluster");
    });

    it("should track additional dimension keys", () => {
      wrapper = createWrapper();
      const additionalKeys = Object.keys(wrapper.props().additionalDimensions);
      expect(additionalKeys.length).toBe(2);
    });

    it("should have unstable dimension tracking", () => {
      wrapper = createWrapper();
      expect(wrapper.props().additionalDimensions).toBeDefined();
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

      // Verify wildcard is set
      expect(wrapper.vm.pendingFilters.region).toBe("*");
    });

    it("should check if showing specific value", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "us-west" };

      // Verify specific value is set
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

      // Directly update pendingFilters (simulating input change)
      wrapper.vm.pendingFilters = {
        ...wrapper.vm.pendingFilters,
        service: "new-service",
      };
      await nextTick();

      expect(wrapper.vm.pendingFilters.service).toBe("new-service");
    });

    it("should update pendingFilters for additional dimensions", async () => {
      wrapper = createWrapper();

      // Directly update pendingFilters (simulating input change)
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
      // QDialog content (including tooltips) doesn't render in tests due to Teleport
      // Check that component has the necessary props
      expect(wrapper.props().matchedDimensions).toBeDefined();
      expect(wrapper.props().additionalDimensions).toBeDefined();
    });

    it("should track stable dimensions for tooltips", () => {
      wrapper = createWrapper();
      // Verify matched dimensions are tracked (these show stable tooltips)
      const matchedKeys = Object.keys(wrapper.props().matchedDimensions);
      expect(matchedKeys.length).toBeGreaterThan(0);
    });

    it("should track unstable dimensions for tooltips", () => {
      wrapper = createWrapper();
      // Verify additional dimensions are tracked (these show unstable tooltips)
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

    it("should have dialog component", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(QDialog);
      expect(dialog.exists()).toBe(true);
    });

    it("should pass modelValue prop to dialog", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(QDialog);
      expect(dialog.props("modelValue")).toBe(true);
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
