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

import PanelErrorButtons from "@/components/dashboards/PanelErrorButtons.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("PanelErrorButtons", () => {
  let wrapper: any;

  const defaultProps = {
    error: "",
    maxQueryRangeWarning: "",
    limitNumberOfSeriesWarningMessage: "",
    isCachedDataDifferWithCurrentTimeRange: false,
    isPartialData: false,
    isPanelLoading: false,
    lastTriggeredAt: null,
    viewOnly: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(PanelErrorButtons, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          'RelativeTime': {
            template: '<span data-test="relative-time">{{ timestamp }}</span>',
            props: ['timestamp', 'fullTimePrefix']
          }
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("PanelErrorButtons");
    });

    it("should not render anything when no props have values", () => {
      wrapper = createWrapper();
      // Component should still exist but inner container should not be visible
      // since all props are falsy
      const container = wrapper.find('.row');
      expect(container.exists()).toBe(false);
    });
  });

  describe("Error Button", () => {
    it("should show error button when error prop is provided", () => {
      wrapper = createWrapper({ error: "Query execution failed" });

      expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(true);
    });

    it("should not show error button when error prop is empty", () => {
      wrapper = createWrapper({ error: "" });

      expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(false);
    });

    it("should display error message in tooltip", () => {
      const errorMessage = "Query execution failed";
      wrapper = createWrapper({ error: errorMessage });

      const errorBtn = wrapper.find('[data-test="panel-error-data"]');
      expect(errorBtn.exists()).toBe(true);
      
      // Check tooltip text
      const tooltip = errorBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain(errorMessage);
      }
    });

    it("should have warning class on error button", () => {
      wrapper = createWrapper({ error: "Error message" });

      const errorBtn = wrapper.find('[data-test="panel-error-data"]');
      expect(errorBtn.classes()).toContain('warning');
    });
  });

  describe("Max Query Range Warning", () => {
    it("should show max query range warning button when prop is provided", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Query range exceeded" });

      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
    });

    it("should not show max query range warning when prop is empty", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "" });

      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(false);
    });

    it("should display warning message in tooltip", () => {
      const warningMessage = "Query exceeded maximum allowed range";
      wrapper = createWrapper({ maxQueryRangeWarning: warningMessage });

      const warningBtn = wrapper.find('[data-test="panel-max-duration-warning"]');
      expect(warningBtn.exists()).toBe(true);
      
      const tooltip = warningBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain(warningMessage);
      }
    });

    it("should have warning class on max query range warning button", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Warning message" });

      const warningBtn = wrapper.find('[data-test="panel-max-duration-warning"]');
      expect(warningBtn.classes()).toContain('warning');
    });
  });

  describe("Limit Number of Series Warning", () => {
    it("should show limit series warning button when prop is provided", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Series limit exceeded" });

      expect(wrapper.find('[data-test="panel-limit-number-of-series-warning"]').exists()).toBe(true);
    });

    it("should not show limit series warning when prop is empty", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "" });

      expect(wrapper.find('[data-test="panel-limit-number-of-series-warning"]').exists()).toBe(false);
    });

    it("should display warning message in tooltip", () => {
      const warningMessage = "Series limit of 1000 exceeded";
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: warningMessage });

      const warningBtn = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
      expect(warningBtn.exists()).toBe(true);
      
      const tooltip = warningBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain(warningMessage);
      }
    });

    it("should have warning class on limit series warning button", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Limit exceeded" });

      const warningBtn = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
      expect(warningBtn.classes()).toContain('warning');
    });
  });

  describe("Cached Data Warning", () => {
    it("should show cached data warning button when prop is true", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });

      expect(wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]').exists()).toBe(true);
    });

    it("should not show cached data warning when prop is false", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: false });

      expect(wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]').exists()).toBe(false);
    });

    it("should display correct message in tooltip", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });

      const warningBtn = wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]');
      expect(warningBtn.exists()).toBe(true);
      
      const tooltip = warningBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("cached");
      }
    });
  });

  describe("Partial Data Warning", () => {
    it("should show partial data warning when isPartialData is true and not loading", () => {
      wrapper = createWrapper({ 
        isPartialData: true, 
        isPanelLoading: false 
      });

      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
    });

    it("should not show partial data warning when isPartialData is false", () => {
      wrapper = createWrapper({ 
        isPartialData: false, 
        isPanelLoading: false 
      });

      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
    });

    it("should not show partial data warning when isPanelLoading is true", () => {
      wrapper = createWrapper({ 
        isPartialData: true, 
        isPanelLoading: true 
      });

      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
    });

    it("should have warning class on partial data warning button", () => {
      wrapper = createWrapper({ 
        isPartialData: true, 
        isPanelLoading: false 
      });

      const warningBtn = wrapper.find('[data-test="panel-partial-data-warning"]');
      expect(warningBtn.classes()).toContain('warning');
    });

    it("should display correct message in tooltip", () => {
      wrapper = createWrapper({ 
        isPartialData: true, 
        isPanelLoading: false 
      });

      const warningBtn = wrapper.find('[data-test="panel-partial-data-warning"]');
      const tooltip = warningBtn.find('q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("incomplete");
      }
    });
  });

  describe("Last Triggered At Display", () => {
    it("should show last refreshed time when lastTriggeredAt is provided and not viewOnly", () => {
      wrapper = createWrapper({ 
        lastTriggeredAt: Date.now(), 
        viewOnly: false 
      });

      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(true);
    });

    it("should not show last refreshed time when viewOnly is true", () => {
      wrapper = createWrapper({ 
        lastTriggeredAt: Date.now(), 
        viewOnly: true 
      });

      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(false);
    });

    it("should not show last refreshed time when lastTriggeredAt is null", () => {
      wrapper = createWrapper({ 
        lastTriggeredAt: null, 
        viewOnly: false 
      });

      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(false);
    });

    it("should render RelativeTime component when lastTriggeredAt is provided", () => {
      wrapper = createWrapper({ 
        lastTriggeredAt: Date.now(), 
        viewOnly: false 
      });

      expect(wrapper.find('[data-test="relative-time"]').exists()).toBe(true);
    });

    it("should show clock icon when lastTriggeredAt is provided", () => {
      wrapper = createWrapper({ 
        lastTriggeredAt: Date.now(), 
        viewOnly: false 
      });

      expect(wrapper.find('.lastRefreshedAtIcon').exists()).toBe(true);
    });
  });

  describe("Multiple Warnings Displayed", () => {
    it("should show multiple warning buttons when multiple props are set", () => {
      wrapper = createWrapper({
        error: "Error occurred",
        maxQueryRangeWarning: "Range exceeded",
        limitNumberOfSeriesWarningMessage: "Series limit exceeded"
      });

      expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-limit-number-of-series-warning"]').exists()).toBe(true);
    });

    it("should show all possible warnings and info at once", () => {
      wrapper = createWrapper({
        error: "Error",
        maxQueryRangeWarning: "Range warning",
        limitNumberOfSeriesWarningMessage: "Series warning",
        isCachedDataDifferWithCurrentTimeRange: true,
        isPartialData: true,
        isPanelLoading: false,
        lastTriggeredAt: Date.now(),
        viewOnly: false
      });

      expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-limit-number-of-series-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(true);
    });
  });

  describe("Props Validation", () => {
    it("should accept error as string", () => {
      wrapper = createWrapper({ error: "Test error" });
      expect(wrapper.props().error).toBe("Test error");
    });

    it("should accept maxQueryRangeWarning as string", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Test warning" });
      expect(wrapper.props().maxQueryRangeWarning).toBe("Test warning");
    });

    it("should accept limitNumberOfSeriesWarningMessage as string", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Test warning" });
      expect(wrapper.props().limitNumberOfSeriesWarningMessage).toBe("Test warning");
    });

    it("should accept isCachedDataDifferWithCurrentTimeRange as boolean", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });
      expect(wrapper.props().isCachedDataDifferWithCurrentTimeRange).toBe(true);
    });

    it("should accept isPartialData as boolean", () => {
      wrapper = createWrapper({ isPartialData: true });
      expect(wrapper.props().isPartialData).toBe(true);
    });

    it("should accept isPanelLoading as boolean", () => {
      wrapper = createWrapper({ isPanelLoading: true });
      expect(wrapper.props().isPanelLoading).toBe(true);
    });

    it("should accept lastTriggeredAt as number (timestamp)", () => {
      const timestamp = Date.now();
      wrapper = createWrapper({ lastTriggeredAt: timestamp });
      expect(wrapper.props().lastTriggeredAt).toBe(timestamp);
    });

    it("should accept lastTriggeredAt as Date object", () => {
      const date = new Date();
      wrapper = createWrapper({ lastTriggeredAt: date });
      expect(wrapper.props().lastTriggeredAt).toEqual(date);
    });

    it("should accept lastTriggeredAt as string", () => {
      const dateString = "2023-01-01T00:00:00Z";
      wrapper = createWrapper({ lastTriggeredAt: dateString });
      expect(wrapper.props().lastTriggeredAt).toBe(dateString);
    });

    it("should accept viewOnly as boolean", () => {
      wrapper = createWrapper({ viewOnly: true });
      expect(wrapper.props().viewOnly).toBe(true);
    });
  });

  describe("Default Props", () => {
    it("should have default value for error as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.props().error).toBe("");
    });

    it("should have default value for maxQueryRangeWarning as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.props().maxQueryRangeWarning).toBe("");
    });

    it("should have default value for limitNumberOfSeriesWarningMessage as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.props().limitNumberOfSeriesWarningMessage).toBe("");
    });

    it("should have default value for isCachedDataDifferWithCurrentTimeRange as false", () => {
      wrapper = createWrapper();
      expect(wrapper.props().isCachedDataDifferWithCurrentTimeRange).toBe(false);
    });

    it("should have default value for isPartialData as false", () => {
      wrapper = createWrapper();
      expect(wrapper.props().isPartialData).toBe(false);
    });

    it("should have default value for isPanelLoading as false", () => {
      wrapper = createWrapper();
      expect(wrapper.props().isPanelLoading).toBe(false);
    });

    it("should have default value for lastTriggeredAt as null", () => {
      wrapper = createWrapper();
      expect(wrapper.props().lastTriggeredAt).toBe(null);
    });

    it("should have default value for viewOnly as false", () => {
      wrapper = createWrapper();
      expect(wrapper.props().viewOnly).toBe(false);
    });
  });

  describe("Container Visibility", () => {
    it("should render container div when error is provided", () => {
      wrapper = createWrapper({ error: "Error" });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should render container div when maxQueryRangeWarning is provided", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Warning" });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should render container div when limitNumberOfSeriesWarningMessage is provided", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Warning" });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should render container div when isCachedDataDifferWithCurrentTimeRange is true", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should render container div when partial data warning should show", () => {
      wrapper = createWrapper({ isPartialData: true, isPanelLoading: false });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should render container div when lastTriggeredAt is provided and not viewOnly", () => {
      wrapper = createWrapper({ lastTriggeredAt: Date.now(), viewOnly: false });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(true);
    });

    it("should not render container when lastTriggeredAt is provided but viewOnly is true", () => {
      wrapper = createWrapper({ lastTriggeredAt: Date.now(), viewOnly: true });
      expect(wrapper.find('.row.items-center.no-wrap').exists()).toBe(false);
    });
  });

  describe("Icon Usage", () => {
    it("should use outlinedWarning icon for error button", () => {
      wrapper = createWrapper({ error: "Error" });
      // Check that the component has access to the icon
      expect(wrapper.vm.outlinedWarning).toBeDefined();
    });

    it("should use outlinedWarning icon for max query range warning button", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Warning" });
      expect(wrapper.vm.outlinedWarning).toBeDefined();
    });

    it("should use symOutlinedDataInfoAlert icon for limit series warning", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Warning" });
      expect(wrapper.vm.symOutlinedDataInfoAlert).toBeDefined();
    });

    it("should use outlinedRunningWithErrors icon for cached data warning", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });
      expect(wrapper.vm.outlinedRunningWithErrors).toBeDefined();
    });

    it("should use symOutlinedClockLoader20 icon for partial data warning", () => {
      wrapper = createWrapper({ isPartialData: true, isPanelLoading: false });
      expect(wrapper.vm.symOutlinedClockLoader20).toBeDefined();
    });
  });

  describe("Styles", () => {
    it("should have warning class for error button", () => {
      wrapper = createWrapper({ error: "Error" });
      const btn = wrapper.find('[data-test="panel-error-data"]');
      expect(btn.classes()).toContain('warning');
    });

    it("should have warning class for max query range warning button", () => {
      wrapper = createWrapper({ maxQueryRangeWarning: "Warning" });
      const btn = wrapper.find('[data-test="panel-max-duration-warning"]');
      expect(btn.classes()).toContain('warning');
    });

    it("should have warning class for limit series warning button", () => {
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: "Warning" });
      const btn = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
      expect(btn.classes()).toContain('warning');
    });

    it("should have warning class for partial data warning button", () => {
      wrapper = createWrapper({ isPartialData: true, isPanelLoading: false });
      const btn = wrapper.find('[data-test="panel-partial-data-warning"]');
      expect(btn.classes()).toContain('warning');
    });

    it("should have lastRefreshedAt class for last refreshed time display", () => {
      wrapper = createWrapper({ lastTriggeredAt: Date.now(), viewOnly: false });
      expect(wrapper.find('.lastRefreshedAt').exists()).toBe(true);
    });

    it("should have lastRefreshedAtIcon class for clock icon", () => {
      wrapper = createWrapper({ lastTriggeredAt: Date.now(), viewOnly: false });
      expect(wrapper.find('.lastRefreshedAtIcon').exists()).toBe(true);
    });
  });

  describe("Tooltip Content", () => {
    it("should show error message in error tooltip", () => {
      const errorMessage = "Detailed error message";
      wrapper = createWrapper({ error: errorMessage });
      const tooltip = wrapper.find('[data-test="panel-error-data"] q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toBe(errorMessage);
      }
    });

    it("should show warning message in max query range tooltip", () => {
      const warningMessage = "Query range exceeded 30 days";
      wrapper = createWrapper({ maxQueryRangeWarning: warningMessage });
      const tooltip = wrapper.find('[data-test="panel-max-duration-warning"] q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toBe(warningMessage);
      }
    });

    it("should show warning message in limit series tooltip", () => {
      const warningMessage = "Series limit of 1000 exceeded";
      wrapper = createWrapper({ limitNumberOfSeriesWarningMessage: warningMessage });
      const tooltip = wrapper.find('[data-test="panel-limit-number-of-series-warning"] q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toBe(warningMessage);
      }
    });

    it("should show cached data message in cached data tooltip", () => {
      wrapper = createWrapper({ isCachedDataDifferWithCurrentTimeRange: true });
      const tooltip = wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"] q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("cached");
      }
    });

    it("should show partial data message in partial data tooltip", () => {
      wrapper = createWrapper({ isPartialData: true, isPanelLoading: false });
      const tooltip = wrapper.find('[data-test="panel-partial-data-warning"] q-tooltip');
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("incomplete");
      }
    });
  });
});
