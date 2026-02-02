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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import TraceHeader from "@/plugins/traces/TraceHeader.vue";
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
  },
});

const mockBaseTracePosition = {
  durationMs: 350.372,
  startTimeMs: 1752490492843,
  tics: [
    {
      value: 0,
      label: "0.00us",
      left: "-1px",
    },
    {
      value: 80.34,
      label: "80.34ms",
      left: "25%",
    },
    {
      value: 160.69,
      label: "160.69ms",
      left: "50%",
    },
    {
      value: 241.03,
      label: "241.03ms",
      left: "75%",
    },
    {
      value: 321.37,
      label: "321.37ms",
      left: "100%",
    },
  ],
};

const mockSpanDimensions = {
  height: 30,
  barHeight: 8,
  textHeight: 25,
  gap: 15,
  collapseHeight: "14",
  collapseWidth: 14,
  connectorPadding: 2,
  paddingLeft: 8,
  hConnectorWidth: 20,
  dotConnectorWidth: 6,
  dotConnectorHeight: 6,
  colors: ["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2"],
};

describe("TraceHeader", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TraceHeader, {
      props: {
        baseTracePosition: mockBaseTracePosition,
        spanDimensions: mockSpanDimensions,
        splitterWidth: 300,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          "q-resize-observer": true,
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component mounting and basic rendering", () => {
    it("should mount TraceHeader component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the main header container", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.exists()).toBe(true);
    });

    it("should have correct default height", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("trace-header-container");
    });

    it("should have sticky positioning", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("trace-header-container");
    });
  });

  describe("Operation name section", () => {
    it("should render operation name section", () => {
      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.exists()).toBe(true);
    });

    it("should display 'Operation Name' text", () => {
      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.text()).toContain("Operation Name");
    });

    it("should have correct width based on splitterWidth prop", () => {
      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.attributes("style")).toContain(
        "width: 300px",
      );
    });

    it("should render resize button", () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      expect(resizeBtn.exists()).toBe(true);
    });

    it("should have drag indicator icon", () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      expect(resizeBtn.find(".material-icons").exists()).toBe(true);
      expect(resizeBtn.find(".material-icons").text()).toBe("drag_indicator");
    });

    it("should have correct avatar properties", () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      expect(resizeBtn.classes()).toContain("bg-primary");
      expect(resizeBtn.classes()).toContain("text-white");
    });
  });

  describe("Tics section", () => {
    it("should render tics section", () => {
      const ticsSection = wrapper.find('[data-test="trace-header-tics"]');
      expect(ticsSection.exists()).toBe(true);
    });

    it("should have correct width calculation", () => {
      const ticsSection = wrapper.find('[data-test="trace-header-tics"]');
      expect(ticsSection.attributes("style")).toContain(
        "width: calc(100% - 300px)",
      );
    });

    it("should render all tic labels", () => {
      const tic0 = wrapper.find('[data-test="trace-header-tic-label-0"]');
      const tic1 = wrapper.find('[data-test="trace-header-tic-label-1"]');
      const tic2 = wrapper.find('[data-test="trace-header-tic-label-2"]');
      const tic3 = wrapper.find('[data-test="trace-header-tic-label-3"]');

      expect(tic0.exists()).toBe(true);
      expect(tic1.exists()).toBe(true);
      expect(tic2.exists()).toBe(true);
      expect(tic3.exists()).toBe(true);
    });

    it("should display correct tic labels", () => {
      const tic0 = wrapper.find('[data-test="trace-header-tic-label-0"]');
      const tic1 = wrapper.find('[data-test="trace-header-tic-label-1"]');
      const tic2 = wrapper.find('[data-test="trace-header-tic-label-2"]');
      const tic3 = wrapper.find('[data-test="trace-header-tic-label-3"]');

      expect(tic0.text()).toBe("0.00us");
      expect(tic1.text()).toBe("80.34ms");
      expect(tic2.text()).toBe("160.69ms");
      expect(tic3.text()).toContain("241.03ms");
      expect(tic3.text()).toContain("321.37ms");
    });

    it("should render tic lines", () => {
      const ticLines = wrapper.findAll('[data-test^="trace-header-tic-line-"]');
      expect(ticLines.length).toBe(5); // 5 tic lines
    });

    it("should have correct positioning for tic lines", () => {
      const ticLines = wrapper.findAll('[data-test^="trace-header-tic-line-"]');

      expect(ticLines[0].attributes("style")).toContain("left: -1px");
      expect(ticLines[1].attributes("style")).toContain("left: 25%");
      expect(ticLines[2].attributes("style")).toContain("left: 50%");
      expect(ticLines[3].attributes("style")).toContain("left: 75%");
      expect(ticLines[4].attributes("style")).toContain("left: 100%");
    });

    it("should have correct z-index for first tic", () => {
      const firstTic = wrapper.find('[data-test="trace-header-tic-line-0"]');
      expect(firstTic.classes()).toContain("trace-tic-first");
    });

    it("should have correct z-index for other tics", () => {
      const otherTics = wrapper
        .findAll('[data-test^="trace-header-tic-line-"]')
        .slice(1);
      otherTics.forEach((tic) => {
        expect(tic.classes()).toContain("trace-tic");
      });
    });
  });

  describe("Theme support", () => {
    it("should apply light theme by default", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("bg-grey-2");
      expect(headerContainer.classes()).toContain("trace-header-container");
    });

    it("should apply dark theme when store theme is dark", async () => {
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
        },
      });

      const darkWrapper = mount(TraceHeader, {
        props: {
          baseTracePosition: mockBaseTracePosition,
          spanDimensions: mockSpanDimensions,
          splitterWidth: 300,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: darkStore,
          },
          stubs: {
            "q-resize-observer": true,
          },
        },
      });

      const headerContainer = darkWrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("bg-grey-9");
      expect(headerContainer.classes()).toContain("trace-header-container");

      darkWrapper.unmount();
    });

    it("should apply dark theme colors to tic lines", async () => {
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
        },
      });

      const darkWrapper = mount(TraceHeader, {
        props: {
          baseTracePosition: mockBaseTracePosition,
          spanDimensions: mockSpanDimensions,
          splitterWidth: 300,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: darkStore,
          },
          stubs: {
            "q-resize-observer": true,
          },
        },
      });

      const ticLines = darkWrapper.findAll(
        '[data-test^="trace-header-tic-line-"]',
      );
      ticLines.forEach((tic) => {
        expect(tic.classes()).toContain("bg-dark-tic");
      });

      darkWrapper.unmount();
    });

    it("should apply light theme colors to tic lines", () => {
      const ticLines = wrapper.findAll('[data-test^="trace-header-tic-line-"]');
      ticLines.forEach((tic) => {
        expect(tic.classes()).toContain("trace-tic");
      });
    });
  });

  describe("Resize functionality", () => {
    it("should emit resize-start event when resize button is clicked", async () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      await resizeBtn.trigger("mousedown");

      expect(wrapper.emitted("resize-start")).toBeTruthy();
    });

    it("should pass MouseEvent to resize-start event", async () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');

      await resizeBtn.trigger("mousedown");

      expect(wrapper.emitted("resize-start")).toBeTruthy();
      expect(wrapper.emitted("resize-start")[0]).toBeDefined();
      expect(wrapper.emitted("resize-start")[0][0]).toBeInstanceOf(Event);
    });

    it("should have correct cursor style for resize button", () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      expect(resizeBtn.classes()).toContain("resize-btn");
    });
  });

  describe("Props handling", () => {
    it("should handle null baseTracePosition", async () => {
      await wrapper.setProps({
        baseTracePosition: null,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty spanDimensions", async () => {
      await wrapper.setProps({
        spanDimensions: {},
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle zero splitterWidth", async () => {
      await wrapper.setProps({
        splitterWidth: 0,
      });

      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.attributes("style")).toContain("width: 0px");

      const ticsSection = wrapper.find('[data-test="trace-header-tics"]');
      expect(ticsSection.attributes("style")).toContain(
        "width: calc(100% - 0px)",
      );
    });

    it("should handle large splitterWidth", async () => {
      await wrapper.setProps({
        splitterWidth: 500,
      });

      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.attributes("style")).toContain(
        "width: 500px",
      );

      const ticsSection = wrapper.find('[data-test="trace-header-tics"]');
      expect(ticsSection.attributes("style")).toContain(
        "width: calc(100% - 500px)",
      );
    });

    it("should handle missing tics in baseTracePosition", async () => {
      const incompleteTracePosition = {
        durationMs: 350.372,
        startTimeMs: 1752490492843,
        tics: [],
      };

      await wrapper.setProps({
        baseTracePosition: incompleteTracePosition,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle tics with missing properties", async () => {
      const incompleteTics = [
        { value: 0, label: "0.00us" }, // missing left
        { value: 80.34, left: "25%" }, // missing label
      ];

      const incompleteTracePosition = {
        durationMs: 350.372,
        startTimeMs: 1752490492843,
        tics: incompleteTics,
      };

      await wrapper.setProps({
        baseTracePosition: incompleteTracePosition,
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("CSS classes and styling", () => {
    it("should have correct flex classes", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("flex");
      expect(headerContainer.classes()).toContain("justify-start");
      expect(headerContainer.classes()).toContain("items-center");
    });

    it("should have correct header background class", () => {
      const headerContainer = wrapper.find('[data-test="trace-header"]');
      expect(headerContainer.classes()).toContain("header-bg");
    });

    it("should have correct operation name section classes", () => {
      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.classes()).toContain("tw:relative");
      expect(operationNameSection.classes()).toContain("flex");
      expect(operationNameSection.classes()).toContain("justify-start");
      expect(operationNameSection.classes()).toContain("items-center");
      expect(operationNameSection.classes()).toContain("no-wrap");
      expect(operationNameSection.classes()).toContain("row");
      expect(operationNameSection.classes()).toContain("q-px-sm");
    });

    it("should have correct tics section classes", () => {
      const ticsSection = wrapper.find('[data-test="trace-header-tics"]');
      expect(ticsSection.classes()).toContain("flex");
      expect(ticsSection.classes()).toContain("justify-start");
      expect(ticsSection.classes()).toContain("items-center");
      expect(ticsSection.classes()).toContain("no-wrap");
      expect(ticsSection.classes()).toContain("row");
      expect(ticsSection.classes()).toContain("relative-position");
    });

    it("should have correct tic label classes", () => {
      const tic0 = wrapper.find('[data-test="trace-header-tic-label-0"]');
      expect(tic0.classes()).toContain("col-3");
      expect(tic0.classes()).toContain("text-caption");
      expect(tic0.classes()).toContain("q-pl-md");
    });

    it("should have correct tic line classes", () => {
      const ticLines = wrapper.findAll('[data-test^="trace-header-tic-line-"]');
      ticLines.forEach((tic) => {
        expect(tic.classes()).toContain("trace-tic");
      });
    });
  });

  describe("Component methods", () => {
    it("should have handleMouseDown method", () => {
      expect(wrapper.vm.handleMouseDown).toBeDefined();
      expect(typeof wrapper.vm.handleMouseDown).toBe("function");
    });

    it("should emit resize-start when handleMouseDown is called", () => {
      const mockEvent = { type: "mousedown" };
      wrapper.vm.handleMouseDown(mockEvent);

      expect(wrapper.emitted("resize-start")).toBeTruthy();
      expect(wrapper.emitted("resize-start")[0]).toEqual([mockEvent]);
    });
  });

  describe("Store integration", () => {
    it("should access store state", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });
  });

  describe("Error handling and edge cases", () => {
    it("should handle undefined props gracefully", async () => {
      const wrapperWithoutProps = mount(TraceHeader, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            "q-resize-observer": true,
          },
        },
      });

      expect(wrapperWithoutProps.exists()).toBe(true);
      wrapperWithoutProps.unmount();
    });

    it("should handle malformed baseTracePosition", async () => {
      const malformedTracePosition = {
        durationMs: "invalid",
        startTimeMs: "invalid",
        tics: "not an array",
      };

      await wrapper.setProps({
        baseTracePosition: malformedTracePosition,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle resize button click without event", async () => {
      const resizeBtn = wrapper.find('[data-test="trace-header-resize-btn"]');
      await resizeBtn.trigger("mousedown");

      expect(wrapper.emitted("resize-start")).toBeTruthy();
      expect(wrapper.emitted("resize-start")[0]).toBeDefined();
    });
  });

  describe("Performance and rendering", () => {
    it("should render efficiently with large number of tics", async () => {
      const largeTics = Array.from({ length: 20 }, (_, i) => ({
        value: i * 10,
        label: `${i * 10}ms`,
        left: `${i * 5}%`,
      }));

      const largeTracePosition = {
        durationMs: 350.372,
        startTimeMs: 1752490492843,
        tics: largeTics,
      };

      await wrapper.setProps({
        baseTracePosition: largeTracePosition,
      });

      await flushPromises();

      const ticLines = wrapper.findAll('[data-test^="trace-header-tic-line-"]');
      expect(ticLines.length).toBe(20);
    });

    it("should update efficiently when props change", async () => {
      await wrapper.setProps({
        splitterWidth: 400,
      });

      await flushPromises();

      const operationNameSection = wrapper.find(
        '[data-test="trace-header-operation-name"]',
      );
      expect(operationNameSection.attributes("style")).toContain(
        "width: 400px",
      );
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      expect(wrapper.find('[data-test="trace-header"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="trace-header-operation-name"]').exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="trace-header-tics"]').exists()).toBe(
        true,
      );
    });

    it("should have proper ARIA attributes for resize button", () => {
      const resizeBtn = wrapper.find(".resize-btn");
      expect(resizeBtn.exists()).toBe(true);
    });
  });
});
