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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import AlertSummary from "./AlertSummary.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

installQuasar();

describe("AlertSummary", () => {
  let mockFormData: any;
  let mockDestinations: any[];

  beforeEach(() => {
    mockFormData = {
      name: "Test Alert",
      stream_type: "logs",
      stream_name: "default",
      query_condition: {
        type: "sql",
        conditions: [],
      },
      trigger_condition: {
        period: 5,
        operator: ">=",
        threshold: 100,
      },
      destination: ["dest1"],
    };

    mockDestinations = [
      {
        uuid: "dest1",
        name: "Slack Channel",
        template: "slack",
      },
    ];
  });

  it("should render the component", () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".alert-summary").exists()).toBe(true);
  });

  it("should display placeholder when summaryText is empty", () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: {},
        destinations: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    const placeholder = wrapper.find(".summary-placeholder");
    expect(placeholder.exists()).toBe(true);
  });

  it("should display summary text when formData is provided", () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
      },
      global: {
        plugins: [i18n],
      },
    });

    const summaryText = wrapper.find(".summary-text");
    expect(summaryText.exists()).toBe(true);
  });

  it("should not show scroll to bottom button initially", () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
      },
      global: {
        plugins: [i18n],
      },
    });

    const scrollButton = wrapper.find(".scroll-to-bottom-btn");
    // Button exists but is hidden (v-show)
    expect(wrapper.vm.showScrollToBottom).toBe(false);
  });

  it("should handle summary click events with focus target", async () => {
    const mockFocusManager = {
      focusField: vi.fn(),
    };

    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
        focusManager: mockFocusManager,
      },
      global: {
        plugins: [i18n],
      },
    });

    // Create a mock event with a target that has data-focus-target attribute
    const mockEvent = {
      target: {
        getAttribute: vi.fn().mockReturnValue("stream_name"),
      },
    } as any;

    await wrapper.vm.handleSummaryClick(mockEvent);

    expect(mockFocusManager.focusField).toHaveBeenCalledWith("stream_name");
  });

  it("should not call focusField when no focus target is provided", async () => {
    const mockFocusManager = {
      focusField: vi.fn(),
    };

    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
        focusManager: mockFocusManager,
      },
      global: {
        plugins: [i18n],
      },
    });

    const mockEvent = {
      target: {
        getAttribute: vi.fn().mockReturnValue(null),
      },
    } as any;

    await wrapper.vm.handleSummaryClick(mockEvent);

    expect(mockFocusManager.focusField).not.toHaveBeenCalled();
  });

  it("should handle scrollToBottomSmooth correctly", async () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
      },
      global: {
        plugins: [i18n],
      },
      attachTo: document.body,
    });

    // Mock the scrollTo method
    const mockScrollTo = vi.fn();
    const summaryContainer = wrapper.find(".summary-content").element as HTMLElement;
    summaryContainer.scrollTo = mockScrollTo;

    wrapper.vm.showScrollToBottom = true;
    await wrapper.vm.scrollToBottomSmooth();

    expect(mockScrollTo).toHaveBeenCalled();
    expect(wrapper.vm.showScrollToBottom).toBe(false);

    wrapper.unmount();
  });

  it("should accept wizardStep prop", () => {
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
        wizardStep: 2,
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.props("wizardStep")).toBe(2);
  });

  it("should accept previewQuery prop", () => {
    const previewQuery = "SELECT * FROM logs";
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
        previewQuery,
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.props("previewQuery")).toBe(previewQuery);
  });

  it("should accept generatedSqlQuery prop", () => {
    const generatedSqlQuery = "SELECT count(*) FROM logs";
    const wrapper = mount(AlertSummary, {
      props: {
        formData: mockFormData,
        destinations: mockDestinations,
        generatedSqlQuery,
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.props("generatedSqlQuery")).toBe(generatedSqlQuery);
  });
});
