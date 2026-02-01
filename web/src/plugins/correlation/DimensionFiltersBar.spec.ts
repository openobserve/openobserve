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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { Quasar, QSelect, QBtn, QTooltip } from "quasar";
import DimensionFiltersBar from "./DimensionFiltersBar.vue";
import store from "@/test/unit/helpers/store";
import { nextTick } from "vue";

const mockTranslations = {
  "correlation.filters": "Filters",
  "common.apply": "Apply",
  "correlation.unstableDimensionTooltip": "This dimension is unstable",
};

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: {
    en: mockTranslations,
  },
});

describe("DimensionFiltersBar.vue", () => {
  let wrapper: any;

  const mockGetDimensionOptions = vi.fn((key: string, value: string) => [
    { label: value, value: value },
    { label: "option1", value: "option1" },
    { label: "option2", value: "option2" },
  ]);

  const defaultProps = {
    dimensions: {
      service: "api",
      region: "us-west",
    },
    unstableDimensionKeys: new Set(["region"]),
    getDimensionOptions: mockGetDimensionOptions,
    hasPendingChanges: false,
    showApplyButton: true,
  };

  const createWrapper = (props = {}) => {
    return mount(DimensionFiltersBar, {
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
                QSelect,
                QBtn,
                QTooltip,
              },
            },
          ],
          i18n,
          store,
        ],
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render filter label", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Filters");
    });
  });

  describe("Props Handling", () => {
    it("should accept dimensions prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().dimensions).toEqual({
        service: "api",
        region: "us-west",
      });
    });

    it("should accept unstableDimensionKeys prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().unstableDimensionKeys).toBeInstanceOf(Set);
      expect(wrapper.props().unstableDimensionKeys.has("region")).toBe(true);
    });

    it("should accept custom filter label", () => {
      wrapper = createWrapper({
        filterLabel: "Custom Filters",
      });
      expect(wrapper.text()).toContain("Custom Filters");
    });

    it("should accept custom apply label", () => {
      wrapper = createWrapper({
        applyLabel: "Submit",
      });
      const applyBtn = wrapper.find('[data-test="apply-dimension-filters"]');
      expect(applyBtn.text()).toContain("Submit");
    });

    it("should use default labels when not provided", () => {
      wrapper = createWrapper({
        filterLabel: undefined,
        applyLabel: undefined,
      });
      expect(wrapper.vm.filterLabelComputed).toBe("Filters");
      expect(wrapper.vm.applyLabelComputed).toBe("Apply");
    });
  });

  describe("Dimension Rendering", () => {
    it("should render all dimensions", () => {
      wrapper = createWrapper();
      const dimensions = wrapper.findAll('[data-test^="dimension-filter-"]');
      expect(dimensions.length).toBeGreaterThan(0);
    });

    it("should render dimension labels", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("service:");
      expect(wrapper.text()).toContain("region:");
    });

    it("should apply unstable styling to unstable dimensions", () => {
      wrapper = createWrapper();
      const html = wrapper.html();

      // Check if opacity classes are applied
      expect(html).toContain("tw:opacity-60");
      expect(html).toContain("tw:opacity-100");
    });

    it("should show tooltip for unstable dimensions", () => {
      wrapper = createWrapper();
      const tooltips = wrapper.findAllComponents(QTooltip);
      expect(tooltips.length).toBeGreaterThan(0);
    });
  });

  describe("Apply Button", () => {
    it("should show apply button when showApplyButton is true", () => {
      wrapper = createWrapper({ showApplyButton: true });
      const applyBtn = wrapper.find('[data-test="apply-dimension-filters"]');
      expect(applyBtn.exists()).toBe(true);
    });

    it("should hide apply button when showApplyButton is false", () => {
      wrapper = createWrapper({ showApplyButton: false });
      const applyBtn = wrapper.find('[data-test="apply-dimension-filters"]');
      expect(applyBtn.exists()).toBe(false);
    });

    it("should disable apply button when no pending changes", () => {
      wrapper = createWrapper({ hasPendingChanges: false });
      const applyBtn = wrapper.findComponent(QBtn);
      // Check the Quasar button component's disable prop directly
      expect(applyBtn.props("disable")).toBe(true);
    });

    it("should enable apply button when there are pending changes", () => {
      wrapper = createWrapper({ hasPendingChanges: true });
      const applyBtn = wrapper.findComponent(QBtn);
      // When enabled, the disable prop should be false
      expect(applyBtn.props("disable")).toBe(false);
    });

    it("should emit apply event when apply button is clicked", async () => {
      wrapper = createWrapper({ hasPendingChanges: true });
      const applyBtn = wrapper.find('[data-test="apply-dimension-filters"]');

      await applyBtn.trigger("click");
      await nextTick();

      expect(wrapper.emitted("apply")).toBeTruthy();
      expect(wrapper.emitted("apply")?.length).toBe(1);
    });
  });

  describe("Dimension Change Handling", () => {
    it("should emit update:dimension when dimension value changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleDimensionChange("service", "new-api");
      await nextTick();

      expect(wrapper.emitted("update:dimension")).toBeTruthy();
      expect(wrapper.emitted("update:dimension")?.[0]).toEqual([
        { key: "service", value: "new-api" },
      ]);
    });

    it("should call getDimensionOptions for each dimension", () => {
      wrapper = createWrapper();

      expect(mockGetDimensionOptions).toHaveBeenCalledWith("service", "api");
      expect(mockGetDimensionOptions).toHaveBeenCalledWith("region", "us-west");
    });
  });

  describe("Computed Properties", () => {
    it("should compute filterLabelComputed correctly with custom label", () => {
      wrapper = createWrapper({ filterLabel: "Custom Label" });
      expect(wrapper.vm.filterLabelComputed).toBe("Custom Label");
    });

    it("should compute filterLabelComputed with default when not provided", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filterLabelComputed).toBe("Filters");
    });

    it("should compute applyLabelComputed correctly with custom label", () => {
      wrapper = createWrapper({ applyLabel: "Submit Changes" });
      expect(wrapper.vm.applyLabelComputed).toBe("Submit Changes");
    });

    it("should compute applyLabelComputed with default when not provided", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.applyLabelComputed).toBe("Apply");
    });

    it("should compute unstableDimensionTooltipComputed with custom tooltip", () => {
      wrapper = createWrapper({ unstableDimensionTooltip: "Custom Tooltip" });
      expect(wrapper.vm.unstableDimensionTooltipComputed).toBe("Custom Tooltip");
    });

    it("should compute unstableDimensionTooltipComputed with default", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.unstableDimensionTooltipComputed).toBe(
        "This dimension is unstable"
      );
    });
  });

  describe("Event Handlers", () => {
    it("should have handleDimensionChange method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleDimensionChange).toBe("function");
    });

    it("should have handleApply method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.handleApply).toBe("function");
    });

    it("should emit apply when apply button is clicked", async () => {
      wrapper = createWrapper({ hasPendingChanges: true });

      const applyBtn = wrapper.find('[data-test="apply-dimension-filters"]');
      await applyBtn.trigger("click");
      await nextTick();

      expect(wrapper.emitted("apply")).toBeTruthy();
    });
  });

  describe("Styling and Layout", () => {
    it("should have correct container classes", () => {
      wrapper = createWrapper();
      const container = wrapper.find(".tw\\:py-2");
      expect(container.exists()).toBe(true);
    });

    it("should use flex layout for dimensions", () => {
      wrapper = createWrapper();
      const flexContainer = wrapper.find(".tw\\:flex");
      expect(flexContainer.exists()).toBe(true);
    });

    it("should have proper spacing between elements", () => {
      wrapper = createWrapper();
      const gapContainer = wrapper.find(".tw\\:gap-3");
      expect(gapContainer.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty dimensions object", () => {
      wrapper = createWrapper({ dimensions: {} });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty unstableDimensionKeys set", () => {
      wrapper = createWrapper({ unstableDimensionKeys: new Set() });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dimension with special characters", () => {
      wrapper = createWrapper({
        dimensions: { "special-key": "special-value" },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle multiple unstable dimensions", () => {
      wrapper = createWrapper({
        dimensions: { key1: "val1", key2: "val2", key3: "val3" },
        unstableDimensionKeys: new Set(["key1", "key2"]),
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Reactivity", () => {
    it("should react to dimensions prop changes", async () => {
      wrapper = createWrapper();

      await wrapper.setProps({
        dimensions: { newKey: "newValue" },
      });
      await nextTick();

      expect(wrapper.props().dimensions).toEqual({ newKey: "newValue" });
    });

    it("should react to hasPendingChanges prop changes", async () => {
      wrapper = createWrapper({ hasPendingChanges: false });
      let applyBtn = wrapper.findComponent(QBtn);
      expect(applyBtn.props("disable")).toBe(true);

      await wrapper.setProps({ hasPendingChanges: true });
      await nextTick();

      // Re-find the button after prop change
      applyBtn = wrapper.findComponent(QBtn);
      expect(applyBtn.props("disable")).toBe(false);
    });
  });
});
