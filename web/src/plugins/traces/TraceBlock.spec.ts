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

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import TraceBlock from "@/plugins/traces/TraceBlock.vue";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

const mockStore = createStore({
  state: {
    theme: "light",
    API_ENDPOINT: "http://localhost:8080",
    zoConfig: {
      timestamp_column: "@timestamp",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
    timezone: "UTC",
  },
});

const mockItem = {
  service_name: "alertmanager",
  operation_name: "service:alerts:evaluate_scheduled",
  duration: 321372,
  spans: 5,
  errors: 2,
  services: {
    alertmanager: 3,
    "user-service": 2,
  },
  trace_start_time: 0,
};

const mockSearchObj = {
  meta: {
    serviceColors: {
      alertmanager: "#1ab8be",
      "user-service": "#ff6b6b",
    },
  },
};

describe("TraceBlock", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/composables/useTraces", () => ({
      default: () => ({
        searchObj: {
          data: {
            traceDetails: {
              selectedTrace: null as {
                trace_id: string;
                trace_start_time: number;
                trace_end_time: number;
              } | null,
              traceId: "",
              spanList: [],
              isLoadingTraceMeta: false,
              isLoadingTraceDetails: false,
              selectedSpanId: "avc" as String,
              expandedSpans: [] as String[],
              showSpanDetails: false,
              selectedLogStreams: [] as String[],
            },
          },
          meta: mockSearchObj.meta,
        },
      }),
    }));

    const TraceBlock = (await import("@/plugins/traces/TraceBlock.vue")).default;

    // Create a fresh mock item for each test with current timestamp
    const currentMockItem = {
      ...mockItem,
      trace_start_time: Date.now() * 1000,
    };

    wrapper = mount(TraceBlock, {
      props: {
        item: currentMockItem,
        index: 0,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
      },
    });

    await flushPromises();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should mount TraceBlock component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should receive props correctly", () => {
    expect(wrapper.props("item")).toBeDefined();
    expect(wrapper.props("item").trace_start_time).toBeGreaterThan(0);
    expect(wrapper.props("index")).toBe(0);
  });

  it("should have reactive formattedDate", () => {
    expect(wrapper.vm.formattedDate).toBeDefined();
    expect(wrapper.vm.formattedDate.day).toBeDefined();
    expect(wrapper.vm.formattedDate.time).toBeDefined();
    expect(wrapper.vm.formattedDate.diff).toBeDefined();
  });

  it("should render trace name correctly", () => {
    const traceName = wrapper.find(".trace-name");
    expect(traceName.exists()).toBe(true);
    expect(traceName.text()).toContain("alertmanager:");
    expect(traceName.text()).toContain("service:alerts:evaluate_scheduled");
  });

  it("should render duration correctly", () => {
    const duration = wrapper.find(".trace-duration");
    expect(duration.exists()).toBe(true);
    expect(duration.text()).toBe("321.37ms");
  });

  it("should render spans count", () => {
    const spansElement = wrapper.find(".trace-spans");
    expect(spansElement.exists()).toBe(true);
    expect(spansElement.text()).toContain("Spans :");
    expect(spansElement.text()).toContain("5");
  });

  it("should render errors count when errors exist", () => {
    const errorsElement = wrapper.find(".trace-errors");
    expect(errorsElement.exists()).toBe(true);
    expect(errorsElement.text()).toContain("Errors :");
    expect(errorsElement.text()).toContain("2");
  });

  it("should not render errors when no errors", async () => {
    await wrapper.setProps({
      item: { ...mockItem, errors: 0 },
    });

    const errorsElement = wrapper.find(".trace-errors");
    expect(errorsElement.exists()).toBe(false);
  });

  it("should render service tags correctly", () => {
    const serviceTags = wrapper.findAll(".trace-tag");
    expect(serviceTags.length).toBe(2);

    // Check alertmanager service tag
    expect(serviceTags[0].text()).toContain("alertmanager (3)");
    
    // Check user-service tag
    expect(serviceTags[1].text()).toContain("user-service (2)");
  });

      it("should apply correct service colors", () => {
      const serviceTags = wrapper.findAll(".trace-tag");
      
      const alertmanagerColor = serviceTags[0].find("div").attributes("style");
      expect(alertmanagerColor).toContain("background-color: rgb(26, 184, 190)");
      
      const userServiceColor = serviceTags[1].find("div").attributes("style");
      expect(userServiceColor).toContain("background-color: rgb(255, 107, 107)");
    });

  it("should render date and time correctly", async () => {
    await flushPromises();
    
    const dateTimeSection = wrapper.find(".trace-date-time");
    expect(dateTimeSection.exists()).toBe(true);
    
    const dayElement = dateTimeSection.find("div");
    const timeElement = dateTimeSection.findAll("div")[2];
    
    expect(dayElement.exists()).toBe(true);
    expect(timeElement.exists()).toBe(true);
  });


  describe("Duration formatting", () => {
    it("should format duration in milliseconds", async () => {
      await wrapper.setProps({
        item: { ...mockItem, duration: 1500 },
      });

      const duration = wrapper.find(".trace-duration");
      expect(duration.text()).toBe("1.50ms");
    });

    it("should format duration in microseconds", async () => {
      await wrapper.setProps({
        item: { ...mockItem, duration: 500 },
      });

      const duration = wrapper.find(".trace-duration");
      expect(duration.text()).toBe("500.00us");
    });

    it("should format duration in seconds", async () => {
      await wrapper.setProps({
        item: { ...mockItem, duration: 2000000 },
      });

      const duration = wrapper.find(".trace-duration");
      expect(duration.text()).toBe("2.00s");
    });
  });

    it("should format today's date as 'Today'", async () => {
      await flushPromises();
      await flushPromises();
      await flushPromises();
      
      // Ensure moment is loaded and getFormattedDate is called
      await wrapper.vm.importMoment();
      await wrapper.vm.getFormattedDate();
      await wrapper.vm.$nextTick();

      const traceDay = wrapper.find("[data-test='trace-block-trace-date-day']");
      
      // Check if the formatted date shows "Today"
      expect(traceDay.text()).toBe("Today");
    });

    it("should format yesterday's date as 'Yesterday'", async () => {
      // Set the trace start time to yesterday (24 hours + 50 seconds ago)
      const yesterdayTimestamp = (Date.now() * 1000) - 86405000000;
      
      await wrapper.setProps({
        item: { ...wrapper.props("item"), trace_start_time: yesterdayTimestamp },
      });

      // Ensure moment is imported and date is formatted after prop change
      await wrapper.vm.importMoment();
      await wrapper.vm.getFormattedDate();
      await flushPromises();
      
      const traceDay = wrapper.find("[data-test='trace-block-trace-date-day']");
      
      // Check if the formatted date shows "Yesterday"
      expect(traceDay.text()).toBe("Yesterday");
    });

    it.skip("should react to prop changes via watch", async () => {
      // Verify the initial formatted date
      await flushPromises();
      await flushPromises();

      const traceDay = wrapper.find("[data-test='trace-block-trace-date-day']");
      
      // Check if the formatted date shows "Today"
      expect(traceDay.text()).toBe("Today");      
      
      // Change the trace start time to yesterday
      const yesterdayTimestamp = (Date.now() * 1000) - 86405000000;
      
      await wrapper.setProps({
        item: { ...wrapper.props("item"), trace_start_time: yesterdayTimestamp },
      });
      
      // Wait for the watch to trigger and update the formatted date
      await flushPromises();
      await wrapper.vm.$nextTick();
      await flushPromises();

      // The formatted date should now show "Yesterday"
      const _traceDay = wrapper.find("[data-test='trace-block-trace-date-day']");
      
      // Check if the formatted date shows "Yesterday"
      expect(_traceDay.text()).toBe("Yesterday");    
    });

    it.skip("should format older dates with day and month", async () => {
      await flushPromises();
      await flushPromises();

      // Create a timestamp 5 days ago in microseconds
      // Date.now() returns milliseconds, so we multiply by 1000 to get microseconds
      // Then subtract 5 days worth of microseconds (5 * 24 * 60 * 60 * 1000000)
      const fiveDaysAgoMs = Date.now() - (5 * 24 * 60 * 60 * 1000); // 5 days ago in milliseconds
      const oldTimestamp = fiveDaysAgoMs * 1000; // Convert to microseconds

      await wrapper.setProps({
        item: { ...wrapper.props("item"), trace_start_time: oldTimestamp },
      });

      await flushPromises();
      const traceDay = wrapper.find("[data-test='trace-block-trace-date-day']");

      // The component should show day and month for older dates
      expect(traceDay.text()).toMatch(/\d+ \w+/);
    });

    it("should format time in 12-hour format", async () => {
      // Ensure moment is imported and date is formatted
      await wrapper.vm.importMoment();
      await wrapper.vm.getFormattedDate();
      await flushPromises();
      
      const traceTime = wrapper.find("[data-test='trace-block-trace-date-time']");
      // Time should be in 12-hour format with AM/PM
      expect(traceTime.text()).toMatch(/\d{2}:\d{2}:\d{2} (AM|PM)/);
    });

    it.skip("should handle midnight correctly", async () => {
      // Get the current timestamp that was set in beforeEach
      const currentTimestamp = wrapper.props("item").trace_start_time;

      let date = new Date().getUTCHours();

        
      // Set trace start time to midnight (subtract hours to get to midnight)
      const midnightTime = currentTimestamp - (12 * 3600 * 1000000); // 10 hours before
      await wrapper.setProps({
        item: { ...wrapper.props("item"), trace_start_time: midnightTime },
      });

      await flushPromises();
      await wrapper.vm.$nextTick();
      await flushPromises();
      
      const traceTime = wrapper.find("[data-test='trace-block-trace-date-time']")
      expect(traceTime.text()).toContain(date.toString() + ":");
    });

  describe("Error handling", () => {
    it("should handle missing item data gracefully", async () => {
      await wrapper.setProps({
        item: {},
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing services data", async () => {
      await wrapper.setProps({
        item: { ...mockItem, services: {} },
      });

      const serviceTags = wrapper.findAll(".trace-tag");
      expect(serviceTags.length).toBe(0);
    });

    it("should handle missing service colors", async () => {
      const wrapperWithNoColors = mount(TraceBlock, {
        props: {
          item: mockItem,
          index: 0,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          mocks: {
            useTraces: () => ({
              searchObj: { meta: { serviceColors: {} } },
            }),
          },
        },
      });

      expect(wrapperWithNoColors.exists()).toBe(true);
      
      wrapperWithNoColors.unmount();
    });
  });

  describe("Responsive design", () => {
    it("should have correct CSS classes for layout", () => {
      const container = wrapper.find(".trace-container");
      expect(container.classes()).toContain("full-width");
      expect(container.classes()).toContain("px-mg");
      expect(container.classes()).toContain("cursor-pointer");
    });

    it("should have proper flex layout", () => {
      const header = wrapper.find(".flex.justify-between");
      expect(header.exists()).toBe(true);
      
      const summary = wrapper.find(".trace-summary.flex");
      expect(summary.exists()).toBe(true);
    });

    it("should have correct width constraints", () => {
      const summary = wrapper.find(".trace-summary");
      expect(summary.attributes("style")).toContain("width: 175px");
      
      const servicesContainer = wrapper.find(".flex.justify-start");
      expect(servicesContainer.attributes("style")).toContain("width: calc(100% - 350px)");
      
      const dateTime = wrapper.find(".trace-date-time");
      expect(dateTime.attributes("style")).toContain("width: 175px");
    });
  });

  describe("Accessibility", () => {
    it("should have proper cursor pointer for clickable elements", () => {
      const container = wrapper.find(".trace-container");
      expect(container.classes()).toContain("cursor-pointer");
    });

    it("should have proper text contrast in light theme", () => {
      const traceName = wrapper.find(".trace-name");
      expect(traceName.classes()).toContain("text-body2");
      expect(traceName.classes()).toContain("text-bold");
    });

    it("should have proper text contrast in dark theme", async () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
          API_ENDPOINT: "http://localhost:8080",
          zoConfig: {
            timestamp_column: "@timestamp",
          },
          selectedOrganization: {
            identifier: "test-org",
          },
          timezone: "UTC",
        },
      });

      const darkWrapper = mount(TraceBlock, {
        props: {
          item: mockItem,
          index: 0,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: darkStore,
          },
          mocks: {
            useTraces: () => ({
              searchObj: mockSearchObj,
            }),
          },
        },
      });

      const spansElement = darkWrapper.find(".trace-spans");
      expect(spansElement.classes()).toContain("text-grey-5");

      darkWrapper.unmount();
    });
  });

  describe("Computed properties", () => {
    it("should compute duration correctly", () => {
      expect(wrapper.vm.getDuration).toBe("321.37ms");
    });

    it("should update duration when item changes", async () => {
      await wrapper.setProps({
        item: { ...mockItem, duration: 500000 },
      });

      expect(wrapper.vm.getDuration).toBe("500.00ms");
    });
  });

  describe("Props validation", () => {
    it("should handle default props", () => {
      const defaultWrapper = mount(TraceBlock, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          mocks: {
            useTraces: () => ({
              searchObj: mockSearchObj,
            }),
          },
        },
      });

      expect(defaultWrapper.props("item")).toEqual({});
      expect(defaultWrapper.props("index")).toBe(0);

      defaultWrapper.unmount();
    });

    it("should handle custom index prop", () => {
      expect(wrapper.props("index")).toBe(0);
      
      const customIndexWrapper = mount(TraceBlock, {
        props: {
          item: mockItem,
          index: 5,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          mocks: {
            useTraces: () => ({
              searchObj: mockSearchObj,
            }),
          },
        },
      });

      expect(customIndexWrapper.props("index")).toBe(5);
      
      customIndexWrapper.unmount();
    });
  });
});
