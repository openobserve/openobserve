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

    it("should show title", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Edit Filters");
    });

    it("should show description", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Configure dimension filters");
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
    it("should render matched dimensions section", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Matched Dimensions");
    });

    it("should render all matched dimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("service:");
      expect(wrapper.text()).toContain("environment:");
    });

    it("should render matched dimension inputs", () => {
      wrapper = createWrapper();
      const serviceInput = wrapper.find(
        '[data-test="matched-dimension-input-service"]'
      );
      const envInput = wrapper.find(
        '[data-test="matched-dimension-input-environment"]'
      );

      expect(serviceInput.exists()).toBe(true);
      expect(envInput.exists()).toBe(true);
    });

    it("should show lock icon for matched dimensions", () => {
      wrapper = createWrapper();
      const html = wrapper.html();
      expect(html).toContain("lock");
    });

    it("should show check icon for stable dimensions", () => {
      wrapper = createWrapper();
      const html = wrapper.html();
      expect(html).toContain("check_circle");
    });
  });

  describe("Additional Dimensions Section", () => {
    it("should render additional dimensions section when present", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Additional Dimensions");
    });

    it("should render all additional dimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("region:");
      expect(wrapper.text()).toContain("cluster:");
    });

    it("should render additional dimension inputs", () => {
      wrapper = createWrapper();
      const regionInput = wrapper.find(
        '[data-test="additional-dimension-input-region"]'
      );
      const clusterInput = wrapper.find(
        '[data-test="additional-dimension-input-cluster"]'
      );

      expect(regionInput.exists()).toBe(true);
      expect(clusterInput.exists()).toBe(true);
    });

    it("should show warning icon for additional dimensions", () => {
      wrapper = createWrapper();
      const html = wrapper.html();
      expect(html).toContain("warning");
    });

    it("should show wildcard toggle button for additional dimensions", () => {
      wrapper = createWrapper();
      const toggleBtn = wrapper.find('[data-test="toggle-wildcard-region"]');
      expect(toggleBtn.exists()).toBe(true);
    });

    it("should show no additional dimensions message when empty", () => {
      wrapper = createWrapper({ additionalDimensions: {} });
      expect(wrapper.text()).toContain("No additional dimensions");
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

    it("should show correct button label when showing all", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "*" };

      expect(wrapper.text()).toContain("Showing All");
    });

    it("should show correct button label when not showing all", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { region: "us-west" };

      expect(wrapper.text()).toContain("Set to All");
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
    it("should render close button", () => {
      wrapper = createWrapper();
      const closeBtn = wrapper.find('[data-test="close-dialog-btn"]');
      expect(closeBtn.exists()).toBe(true);
    });

    it("should render cancel button", () => {
      wrapper = createWrapper();
      const cancelBtn = wrapper.find('[data-test="cancel-btn"]');
      expect(cancelBtn.exists()).toBe(true);
    });

    it("should render reset button", () => {
      wrapper = createWrapper();
      const resetBtn = wrapper.find('[data-test="reset-btn"]');
      expect(resetBtn.exists()).toBe(true);
    });

    it("should render apply button", () => {
      wrapper = createWrapper();
      const applyBtn = wrapper.find('[data-test="apply-btn"]');
      expect(applyBtn.exists()).toBe(true);
    });

    it("should disable apply button when no changes", () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = { ...defaultProps.currentFilters };

      const applyBtn = wrapper.find('[data-test="apply-btn"]');
      expect(applyBtn.attributes("disable")).toBe("true");
    });

    it("should enable apply button when there are changes", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingFilters = {
        ...defaultProps.currentFilters,
        service: "modified",
      };
      await nextTick();

      const applyBtn = wrapper.find('[data-test="apply-btn"]');
      expect(applyBtn.attributes("disable")).toBeUndefined();
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
    it("should update pendingFilters when matched dimension input changes", async () => {
      wrapper = createWrapper();
      const input = wrapper.find(
        '[data-test="matched-dimension-input-service"]'
      );

      await input.setValue("new-service");
      await nextTick();

      expect(wrapper.vm.pendingFilters.service).toBe("new-service");
    });

    it("should update pendingFilters when additional dimension input changes", async () => {
      wrapper = createWrapper();
      const input = wrapper.find(
        '[data-test="additional-dimension-input-region"]'
      );

      await input.setValue("us-east");
      await nextTick();

      expect(wrapper.vm.pendingFilters.region).toBe("us-east");
    });
  });

  describe("Tooltips", () => {
    it("should render tooltips for matched dimensions", () => {
      wrapper = createWrapper();
      const tooltips = wrapper.findAllComponents(QTooltip);
      expect(tooltips.length).toBeGreaterThan(0);
    });

    it("should show stable dimension tooltip", () => {
      wrapper = createWrapper();
      expect(wrapper.html()).toContain("Stable");
    });

    it("should show unstable dimension tooltip", () => {
      wrapper = createWrapper();
      expect(wrapper.html()).toContain("Unstable");
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
