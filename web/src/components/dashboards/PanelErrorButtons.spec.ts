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

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import PanelErrorButtons from "./PanelErrorButtons.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

// Create a mock Vuex store with timezone state
const mockStore = createStore({
  state: {
    timezone: "UTC",
  },
  mutations: {},
  actions: {},
});

describe("PanelErrorButtons", () => {
  // Helper function to mount component with store
  const mountComponent = (options = {}) => {
    return mount(PanelErrorButtons, {
      global: {
        provide: {
          store: mockStore,
        },
      },
      ...options,
    });
  };

  it("should render the component", () => {
    const wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
  });

  it("should display error button when error prop is provided", () => {
    const wrapper = mountComponent({
      props: {
        error: "Sample error message",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(true);
  });

  it("should not display error button when no error prop is provided", () => {
    const wrapper = mountComponent({
      props: {
        error: "",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(false);
  });

  it("should display max query range warning button when provided", () => {
    const wrapper = mountComponent({
      props: {
        maxQueryRangeWarning: "Query range exceeds maximum",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-max-duration-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display limit number of series warning button when provided", () => {
    const wrapper = mountComponent({
      props: {
        limitNumberOfSeriesWarningMessage: "Too many series",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display cached data warning button when flag is true", () => {
    const wrapper = mountComponent({
      props: {
        isCachedDataDifferWithCurrentTimeRange: true,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display partial data warning when isPartialData is true and not loading", () => {
    const wrapper = mountComponent({
      props: {
        isPartialData: true,
        isPanelLoading: false,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should not display partial data warning when isPanelLoading is true", () => {
    const wrapper = mountComponent({
      props: {
        isPartialData: true,
        isPanelLoading: true,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(false);
  });

  it("should display last refreshed time when provided and not in viewOnly mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should not display last refreshed time in viewOnly mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: true,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display last refreshed time in simplifiedPanelView mode", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: Date.now(),
        simplifiedPanelView: true,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display anything when no props are provided", () => {
    const wrapper = mountComponent();

    expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
  });

  it("should display multiple warnings simultaneously", () => {
    const wrapper = mountComponent({
      props: {
        error: "Error message",
        maxQueryRangeWarning: "Range warning",
        isPartialData: true,
        isPanelLoading: false,
      },
    });

    expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(true);
  });

  it("should accept null lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: null,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should accept string timestamp for lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: "2024-01-01T00:00:00Z",
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should accept number timestamp for lastTriggeredAt", () => {
    const wrapper = mountComponent({
      props: {
        lastTriggeredAt: 1704067200000,
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });
});
