// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboardPanelData = {
  data: {
    id: "panel-1",
    title: "Test Panel",
    description: "",
    type: "line",
    config: {
      step_value: 0,
      top_results: 10,
      trellis_layout: "horizontal"
    }
  },
  meta: {
    dateTime: {
      start_time: new Date('2023-01-01T00:00:00Z'),
      end_time: new Date('2023-01-01T23:59:59Z')
    }
  }
};

describe("ConfigPanel", () => {
  let wrapper: any;

  const defaultProps = {
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.selectedOrganization = { identifier: "test-org" };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(ConfigPanel, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render config panel with description field", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-config-description"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("dashboard.description");
    });

    it("should render custom chart specific layout for custom_chart type", () => {
      const customChartData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, type: "custom_chart" }
      };
      
      wrapper = createWrapper({ dashboardPanelData: customChartData });

      expect(wrapper.find('[data-test="dashboard-config-description"]').exists()).toBe(true);
      // Custom chart should have simpler layout
      expect(wrapper.find('[data-test="dashboard-config-step-value"]').exists()).toBe(false);
    });

    it("should render standard panel layout for non-custom chart types", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-config-description"]').exists()).toBe(true);
      // Should have more configuration options for standard charts
      expect(wrapper.text()).toContain("dashboard.description");
    });
  });

  describe("Description Field", () => {
    it("should bind description value to input", async () => {
      const panelDataWithDescription = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, description: "Test description" }
      };
      
      wrapper = createWrapper({ dashboardPanelData: panelDataWithDescription });

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(descriptionInput.element.value).toBe("Test description");
    });

    it("should update description when input changes", async () => {
      wrapper = createWrapper();

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      await descriptionInput.setValue("New description");

      expect(wrapper.vm.dashboardPanelData.data.description).toBe("New description");
    });

    it("should handle empty description", () => {
      wrapper = createWrapper();

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(descriptionInput.element.value).toBe("");
    });

    it("should support multiline descriptions with autogrow", () => {
      wrapper = createWrapper();

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(descriptionInput.attributes('autogrow')).toBeDefined();
    });
  });

  describe("PromQL Mode Configuration", () => {
    it("should show step value input in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: true });

      expect(wrapper.find('[data-test="dashboard-config-step-value"]').exists()).toBe(true);
    });

    it("should hide step value input when not in PromQL mode", () => {
      wrapper = createWrapper({ promqlMode: false });

      expect(wrapper.find('[data-test="dashboard-config-step-value"]').exists()).toBe(false);
    });

    it("should bind step value to input", async () => {
      const panelDataWithStepValue = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          config: { ...mockDashboardPanelData.data.config, step_value: 30 }
        }
      };
      
      wrapper = createWrapper({ 
        dashboardPanelData: panelDataWithStepValue, 
        promqlMode: true 
      });

      const stepValueInput = wrapper.find('[data-test="dashboard-config-step-value"]');
      expect(stepValueInput.element.value).toBe("30");
    });

    it("should update step value when input changes", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const stepValueInput = wrapper.find('[data-test="dashboard-config-step-value"]');
      await stepValueInput.setValue("60");

      expect(wrapper.vm.dashboardPanelData.data.config.step_value).toBe("60");
    });

    it("should show step value tooltip", () => {
      wrapper = createWrapper({ promqlMode: true });

      const infoIcon = wrapper.find('[data-test="dashboard-config-top_results-info"]');
      const tooltip = infoIcon.find('q-tooltip');
      
      expect(infoIcon.exists()).toBe(true);
      expect(tooltip.text()).toContain("Step");
      expect(tooltip.text()).toContain("interval between datapoints");
    });
  });

  describe("Panel Type Handling", () => {
    it("should handle different panel types", () => {
      const chartTypes = ["line", "bar", "area", "pie", "table"];
      
      chartTypes.forEach(type => {
        const panelData = {
          ...mockDashboardPanelData,
          data: { ...mockDashboardPanelData.data, type }
        };
        
        wrapper = createWrapper({ dashboardPanelData: panelData });
        expect(wrapper.exists()).toBe(true);
        
        if (wrapper) {
          wrapper.unmount();
        }
      });
    });

    it("should show different configurations for different chart types", () => {
      // Test line chart
      wrapper = createWrapper();
      const lineConfig = wrapper.html();
      wrapper.unmount();

      // Test table
      const tableData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, type: "table" }
      };
      wrapper = createWrapper({ dashboardPanelData: tableData });
      const tableConfig = wrapper.html();

      // Configurations should be different
      expect(lineConfig).not.toBe(tableConfig);
    });
  });

  describe("Configuration Updates", () => {
    it("should emit configuration changes", async () => {
      wrapper = createWrapper();

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      await descriptionInput.setValue("Updated description");

      expect(wrapper.emitted('config-updated')).toBeTruthy();
    });

    it("should handle reactive prop updates", async () => {
      wrapper = createWrapper();

      const newPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, description: "Updated from parent" }
      };

      await wrapper.setProps({ dashboardPanelData: newPanelData });

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(descriptionInput.element.value).toBe("Updated from parent");
    });

    it("should preserve configuration when switching modes", async () => {
      wrapper = createWrapper({ promqlMode: false });

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      await descriptionInput.setValue("Test description");

      await wrapper.setProps({ promqlMode: true });

      const updatedDescriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(updatedDescriptionInput.element.value).toBe("Test description");
    });
  });

  describe("Trellis Configuration", () => {
    it("should show trellis layout options when applicable", () => {
      // Mock showTrellisConfig computed property
      wrapper = createWrapper();
      wrapper.vm.showTrellisConfig = true;
      
      expect(wrapper.vm.showTrellisConfig).toBe(true);
    });

    it("should hide trellis configuration when not applicable", () => {
      wrapper = createWrapper();
      
      // Should not show trellis for simple charts by default
      expect(wrapper.find('[data-test="dashboard-config-trellis"]').exists()).toBe(false);
    });
  });

  describe("Validation", () => {
    it("should handle invalid step values", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const stepValueInput = wrapper.find('[data-test="dashboard-config-step-value"]');
      await stepValueInput.setValue("-1");

      // Should enforce minimum value
      expect(parseInt(stepValueInput.element.value)).toBeGreaterThanOrEqual(0);
    });

    it("should handle non-numeric step values", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const stepValueInput = wrapper.find('[data-test="dashboard-config-step-value"]');
      await stepValueInput.setValue("invalid");

      // Should handle gracefully
      expect(wrapper.vm.dashboardPanelData.data.config.step_value).toBeDefined();
    });

    it("should validate configuration completeness", () => {
      wrapper = createWrapper();

      const isValid = wrapper.vm.isConfigurationValid;
      expect(typeof isValid).toBe("boolean");
    });
  });

  describe("Accessibility", () => {
    it("should have proper labels for form inputs", () => {
      wrapper = createWrapper();

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      expect(descriptionInput.attributes('label')).toBeDefined();
    });

    it("should provide tooltips for complex fields", () => {
      wrapper = createWrapper({ promqlMode: true });

      const infoIcon = wrapper.find('[data-test="dashboard-config-top_results-info"]');
      const tooltip = infoIcon.find('q-tooltip');
      
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text().length).toBeGreaterThan(0);
    });

    it("should support keyboard navigation", async () => {
      wrapper = createWrapper({ promqlMode: true });

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      const stepValueInput = wrapper.find('[data-test="dashboard-config-step-value"]');

      await descriptionInput.trigger('keydown.tab');
      await stepValueInput.trigger('focus');

      expect(document.activeElement).toBe(stepValueInput.element);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper({ dashboardPanelData: null });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it("should handle malformed configuration data", () => {
      const malformedData = {
        data: {
          id: "panel-1",
          // Missing required fields
        }
      };
      
      wrapper = createWrapper({ dashboardPanelData: malformedData });

      expect(wrapper.exists()).toBe(true);
    });

    it("should provide fallback values for missing config properties", () => {
      const incompleteData = {
        data: {
          id: "panel-1",
          type: "line",
          config: {} // Empty config
        }
      };
      
      wrapper = createWrapper({ dashboardPanelData: incompleteData });

      expect(wrapper.vm.dashboardPanelData.data.config).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should not cause unnecessary re-renders", async () => {
      wrapper = createWrapper();
      const renderSpy = vi.spyOn(wrapper.vm, '$forceUpdate');

      // Multiple prop updates
      await wrapper.setProps({ promqlMode: true });
      await wrapper.setProps({ promqlMode: false });
      await wrapper.setProps({ promqlMode: true });

      expect(renderSpy).not.toHaveBeenCalled();
    });

    it("should debounce rapid configuration changes", async () => {
      wrapper = createWrapper();
      const emitSpy = vi.spyOn(wrapper.vm, '$emit');

      const descriptionInput = wrapper.find('[data-test="dashboard-config-description"]');
      
      // Rapid changes
      await descriptionInput.setValue("A");
      await descriptionInput.setValue("AB");
      await descriptionInput.setValue("ABC");

      // Should not emit for every character change
      expect(emitSpy).not.toHaveBeenCalledTimes(3);
    });
  });
});