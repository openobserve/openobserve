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
import SpanBlock from "@/plugins/traces/SpanBlock.vue";
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

const mockSpan = {
  _timestamp: 1752490492843047,
  startTimeUs: 1752490492843000,
  endTimeUs: 1752490493164000,
  durationMs: 321.372,
  durationUs: 321372,
  idleMs: 321.33,
  busyMs: 0.04,
  spanId: "d9603ec7f76eb499",
  operationName: "service:alerts:evaluate_scheduled",
  serviceName: "alertmanager",
  spanStatus: "UNSET",
  spanKind: "Client",
  parentId: "6702b0494b2b6e57",
  spans: [],
  index: 0,
  style: {
    color: "#1ab8be",
    backgroundColor: "#1ab8be33",
    top: "0px",
    left: "0px",
  },
  links: [],
  lowestStartTime: 1752490492843,
  highestEndTime: 1752490493164,
  depth: 0,
  hasChildSpans: true,
  currentIndex: 0,
  totalSpans: 90,
};

const mockBaseTracePosition = {
  durationMs: 350.372,
  startTimeMs: 1752490492843,
  startTimeUs: 1752490492843000,
  durationUs: 350372,
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

const mockSpanData = {
  _timestamp: 1752490492843047,
  busy_ns: "40550",
  code_filepath: "src/service/alerts/mod.rs",
  code_lineno: "114",
  code_namespace: "openobserve::service::alerts",
  duration: 321372,
  end_time: 1752490493164419300,
  events: "[]",
  flags: 1,
  idle_ns: "321332352",
  links: "[]",
  operation_name: "service:alerts:evaluate_scheduled",
  reference_parent_span_id: "6702b0494b2b6e57",
  reference_parent_trace_id: "6262666637a9ae45ad3e25f5111dd59f",
  reference_ref_type: "ChildOf",
  service_name: "alertmanager",
  service_service_instance: "dev2-openobserve-alertmanager-1",
  service_service_version: "v0.15.0-rc3",
  span_id: "d9603ec7f76eb499",
  span_kind: "1",
  span_status: "UNSET",
  start_time: 1752490492843047200,
  status_code: 0,
  status_message: "",
  thread_id: "6",
  thread_name: "job_runtime",
  trace_id: "6262666637a9ae45ad3e25f5111dd59f",
};

const mockStyle = {
  position: "absolute",
  top: "0px",
  left: "0px",
  height: "60px",
};

describe("SpanBlock", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(SpanBlock, {
      props: {
        span: mockSpan,
        baseTracePosition: mockBaseTracePosition,
        depth: 0,
        styleObj: mockStyle,
        showCollapse: true,
        isCollapsed: false,
        spanDimensions: mockSpanDimensions,
        spanData: mockSpanData,
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

    wrapper.find('[data-test="span-block"]').element.style.width = "1024px";
  });

  afterEach(() => {
    wrapper.unmount();
  });

  const spanMarker = () => {
    return wrapper.find('[data-test="span-marker"]');
  };

  it("should mount SpanBlock component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should render span block with correct span ID", () => {
    const spanBlock = wrapper.find(`[id="${mockSpan.spanId}"]`);
    expect(spanBlock.exists()).toBe(true);
  });

  it("should render span marker with correct styling width, left position and height", () => {
    expect(spanMarker().exists()).toBe(true);
    expect(spanMarker().attributes("style")).toContain(`width: 91.72%`);
    expect(spanMarker().attributes("style")).toContain(`left: 0%`);
    expect(spanMarker().attributes("style")).toContain(
      `height: ${mockSpanDimensions.barHeight}px`,
    );
  });

  it("should display duration text", () => {
    const durationText = wrapper.find(".text-caption");
    expect(durationText.exists()).toBe(true);
    expect(durationText.text()).toBe(mockSpan.durationMs.toFixed(2) + "ms");
  });

  it("should emit selectSpan when span is clicked", async () => {
    const spanBlock = wrapper.find(".span-block");
    await spanBlock.trigger("click");

    expect(wrapper.emitted("selectSpan")).toBeTruthy();
    expect(wrapper.emitted("selectSpan")[0]).toEqual([mockSpan.spanId]);
  });

  it("should emit hover when span is hovered", async () => {
    const spanBlock = wrapper.find(".span-block");
    await spanBlock.trigger("mouseover");

    expect(wrapper.emitted("hover")).toBeTruthy();
  });

  it("should be defocused when selectedSpanId is not present", async () => {
    const spanBlock = wrapper.find('[data-test="span-block-container"]');
    expect(spanBlock.attributes("style")).not.toContain("opacity: 0.3");
  });

  describe("When span is not selected", async () => {
    let newWrapper: any;
    beforeEach(async () => {
      // This is to reset the modules, as modules are cached and not re-imported. This resets the imports of the module.
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
          },
        }),
      }));

      let SpanBlock = (await import("@/plugins/traces/SpanBlock.vue")).default;

      newWrapper = mount(SpanBlock, {
        props: {
          span: mockSpan,
          baseTracePosition: mockBaseTracePosition,
          depth: 0,
          styleObj: mockStyle,
          showCollapse: true,
          isCollapsed: false,
          spanDimensions: mockSpanDimensions,
          spanData: mockSpanData,
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
      vi.clearAllMocks();
      newWrapper.unmount();
    });

    it("should apply defocus class when span is not selected", async () => {
      await flushPromises();
      const spanBlock = newWrapper.find(
        '[data-test="span-block-select-trigger"]',
      );
      expect(spanBlock.classes()).toContain("defocus");
    });

    it("Should not show border when span is not selected", async () => {
      const spanBlock = newWrapper.find('[data-test="span-block-container"]');
      expect(spanBlock.attributes("style")).not.toContain(
        `border-bottom: 2px solid ${mockSpan.style.color}`,
      );
    });

    describe("When span is clicked", async () => {
      beforeEach(async () => {
        const spanBlock = newWrapper.find(
          '[data-test="span-block-select-trigger"]',
        );
        await spanBlock.trigger("click");
      });

      it("Should emit selectSpan event", async () => {
        expect(newWrapper.emitted("selectSpan")).toBeTruthy();
        expect(newWrapper.emitted("selectSpan")[0]).toEqual([mockSpan.spanId]);
      });
    });
  });

  describe("When start time is greater than 50% of the trace starttime", async () => {
    let newWrapper: any;
    beforeEach(async () => {
      // This is to reset the modules, as modules are cached and not re-imported. This resets the imports of the module.
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
          },
        }),
      }));

      let SpanBlock = (await import("@/plugins/traces/SpanBlock.vue")).default;

      newWrapper = mount(SpanBlock, {
        props: {
          span: {
            ...mockSpan,
            startTimeMs: 1752490492843 + 220,
            durationMs: 100,
            durationUs: 100000,
          },
          baseTracePosition: mockBaseTracePosition,
          depth: 0,
          styleObj: mockStyle,
          showCollapse: true,
          isCollapsed: false,
          spanDimensions: mockSpanDimensions,
          spanData: {
            ...mockSpanData,
            start_time: 1752490492843 + 220,
          },
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
        },
      });

      const el = newWrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", {
        configurable: true,
        value: 1024, // Set to expected mock width
      });
      await newWrapper.vm.onResize(); // trigger manually
    });

    afterEach(() => {
      vi.clearAllMocks();
      newWrapper.unmount();
    });

    it("should show duration text in the correct position", async () => {
      const spanBlock = newWrapper.find('[data-test="span-block-duration"]');
      expect(spanBlock.exists()).toBe(true);
      expect(spanBlock.attributes("style")).toContain(`left:`);
    });
  });
});
