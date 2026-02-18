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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PanelErrorButtons from "./PanelErrorButtons.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

describe("PanelErrorButtons", () => {
  it("should render the component", () => {
    const wrapper = mount(PanelErrorButtons);
    expect(wrapper.exists()).toBe(true);
  });

  it("should display error button when error prop is provided", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        error: "Sample error message",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(true);
  });

  it("should not display error button when no error prop is provided", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        error: "",
      },
    });

    const errorButton = wrapper.find('[data-test="panel-error-data"]');
    expect(errorButton.exists()).toBe(false);
  });

  it("should display max query range warning button when provided", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        maxQueryRangeWarning: "Query range exceeds maximum",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-max-duration-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display limit number of series warning button when provided", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        limitNumberOfSeriesWarningMessage: "Too many series",
      },
    });

    const warningButton = wrapper.find('[data-test="panel-limit-number-of-series-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display cached data warning button when flag is true", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        isCachedDataDifferWithCurrentTimeRange: true,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should display partial data warning when isPartialData is true and not loading", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        isPartialData: true,
        isPanelLoading: false,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(true);
  });

  it("should not display partial data warning when isPanelLoading is true", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        isPartialData: true,
        isPanelLoading: true,
      },
    });

    const warningButton = wrapper.find('[data-test="panel-partial-data-warning"]');
    expect(warningButton.exists()).toBe(false);
  });

  it("should display last refreshed time when provided and not in viewOnly mode", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should not display last refreshed time in viewOnly mode", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: Date.now(),
        viewOnly: true,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display last refreshed time in simplifiedPanelView mode", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: Date.now(),
        simplifiedPanelView: true,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should not display anything when no props are provided", () => {
    const wrapper = mount(PanelErrorButtons);

    expect(wrapper.find('[data-test="panel-error-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="panel-partial-data-warning"]').exists()).toBe(false);
  });

  it("should display multiple warnings simultaneously", () => {
    const wrapper = mount(PanelErrorButtons, {
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
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: null,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(false);
  });

  it("should accept string timestamp for lastTriggeredAt", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: "2024-01-01T00:00:00Z",
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });

  it("should accept number timestamp for lastTriggeredAt", () => {
    const wrapper = mount(PanelErrorButtons, {
      props: {
        lastTriggeredAt: 1704067200000,
        viewOnly: false,
      },
    });

    const lastRefreshed = wrapper.find('.lastRefreshedAt');
    expect(lastRefreshed.exists()).toBe(true);
  });
});
