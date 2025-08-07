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
import SpanRenderer from "@/plugins/traces/SpanRenderer.vue";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

installQuasar();

const mockStore = createStore({
  state: {
    theme: "light",
    API_ENDPOINT: "http://localhost:8080",
  },
});

const mockSpans = [
  {
    spanId: "span-1",
    operationName: "test-operation-1",
    serviceName: "test-service-1",
    startTimeMs: 1000,
    endTimeMs: 1100,
    durationMs: 100,
    depth: 0,
    style: {
      color: "#1ab8be",
      backgroundColor: "#1ab8be33",
      top: "0px",
      left: "0px",
    },
  },
  {
    spanId: "span-2",
    operationName: "test-operation-2",
    serviceName: "test-service-2",
    startTimeMs: 1050,
    endTimeMs: 1080,
    durationMs: 30,
    depth: 1,
    style: {
      color: "#ff6b6b",
      backgroundColor: "#ff6b6b33",
      top: "30px",
      left: "50px",
    },
  },
];

const mockBaseTracePosition = {
  durationMs: 200,
  startTimeMs: 1000,
  tics: [
    { value: 0, label: "0.00us", left: "-1px" },
    { value: 50, label: "50.00ms", left: "25%" },
    { value: 100, label: "100.00ms", left: "50%" },
    { value: 150, label: "150.00ms", left: "75%" },
    { value: 200, label: "200.00ms", left: "100%" },
  ],
};

const mockCollapseMapping = {
  "span-1": false,
  "span-2": true,
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

describe("SpanRenderer", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(SpanRenderer, {
      props: {
        spans: mockSpans,
        isCollapsed: false,
        collapseMapping: mockCollapseMapping,
        baseTracePosition: mockBaseTracePosition,
        depth: 0,
        spanDimensions: mockSpanDimensions,
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

  it("should mount SpanRenderer component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should render container with correct styling", () => {
    const container = wrapper.find(".relative-position");
    expect(container.exists()).toBe(true);
    expect(container.attributes("style")).toContain("height: 100%");
  });

  it("should not render spans when spans array is empty", async () => {
    const emptyWrapper = mount(SpanRenderer, {
      props: {
        spans: [],
        isCollapsed: false,
        collapseMapping: {},
        baseTracePosition: mockBaseTracePosition,
        depth: 0,
        spanDimensions: mockSpanDimensions,
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

    const spanRenderer = emptyWrapper.find("[data-test='span-renderer']");
    expect(spanRenderer.exists()).toBe(true);
    emptyWrapper.unmount();
  });

  it("should not render spans when spans is null", async () => {
    const nullWrapper = mount(SpanRenderer, {
      props: {
        spans: null,
        isCollapsed: false,
        collapseMapping: {},
        baseTracePosition: mockBaseTracePosition,
        depth: 0,
        spanDimensions: mockSpanDimensions,
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

    const spanRenderer = nullWrapper.find("[data-test='span-renderer']");
    expect(spanRenderer.exists()).toBe(true);
    nullWrapper.unmount();
  });

  it("should have correct props with default values", () => {
    const defaultWrapper = mount(SpanRenderer, {
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

    expect(defaultWrapper.props("spans")).toEqual([]);
    expect(defaultWrapper.props("isCollapsed")).toBe(false);
    expect(defaultWrapper.props("collapseMapping")).toEqual({});
    expect(defaultWrapper.props("baseTracePosition")).toBeNull();
    expect(defaultWrapper.props("depth")).toBe(0);
    expect(defaultWrapper.props("spanDimensions")).toEqual({});

    defaultWrapper.unmount();
  });

  it("should have toggleSpanCollapse method", () => {
    expect(typeof wrapper.vm.toggleSpanCollapse).toBe("function");
  });

  it("should emit toggleCollapse event when toggleSpanCollapse is called", async () => {
    const spanId = "test-span-id";
    await wrapper.vm.toggleSpanCollapse(spanId);

    expect(wrapper.emitted("toggleCollapse")).toBeTruthy();
    expect(wrapper.emitted("toggleCollapse")[0]).toEqual([spanId]);
  });

  it("should include SpanBlock component", () => {
    expect(wrapper.vm.$options.components).toHaveProperty("SpanBlock");
  });

  describe("with different collapse states", () => {
    it("should handle collapsed state", async () => {
      const collapsedWrapper = mount(SpanRenderer, {
        props: {
          spans: mockSpans,
          isCollapsed: true,
          collapseMapping: mockCollapseMapping,
          baseTracePosition: mockBaseTracePosition,
          depth: 0,
          spanDimensions: mockSpanDimensions,
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

      expect(collapsedWrapper.props("isCollapsed")).toBe(true);
      collapsedWrapper.unmount();
    });

    it("should handle different depth values", async () => {
      const depthWrapper = mount(SpanRenderer, {
        props: {
          spans: mockSpans,
          isCollapsed: false,
          collapseMapping: mockCollapseMapping,
          baseTracePosition: mockBaseTracePosition,
          depth: 5,
          spanDimensions: mockSpanDimensions,
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

      expect(depthWrapper.props("depth")).toBe(5);
      depthWrapper.unmount();
    });
  });

  describe("component structure", () => {
    it("should have correct template structure", () => {
      const spanRenderer = wrapper.find("[data-test='span-renderer']");
      expect(spanRenderer.exists()).toBe(true);
      expect(spanRenderer.classes()).toContain("q-pt-sm");
    });
  });
});
