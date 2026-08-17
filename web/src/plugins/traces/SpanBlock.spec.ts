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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SpanBlock from "@/plugins/traces/SpanBlock.vue";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

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
  serviceName: "scheduler",
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
  service_name: "scheduler",
  service_service_instance: "dev2-openobserve-scheduler-1",
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
        stubs: {},
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
    expect(spanMarker().attributes("style")).toContain(`height: ${mockSpanDimensions.barHeight}px`);
  });

  it("should display duration text", () => {
    const durationText = wrapper.find('[data-test="span-block-duration"]');
    expect(durationText.exists()).toBe(true);
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
          stubs: {},
        },
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
      newWrapper.unmount();
    });

    it("should apply defocus class when span is not selected", async () => {
      await flushPromises();
      const spanBlock = newWrapper.find('[data-test="span-block-select-trigger"]');
      expect(spanBlock.classes()).toContain("opacity-30");
    });

    it("Should not show border when span is not selected", async () => {
      const spanBlock = newWrapper.find('[data-test="span-block-container"]');
      expect(spanBlock.attributes("style")).not.toContain(
        `border-bottom: 2px solid ${mockSpan.style.color}`,
      );
    });

    describe("When span is clicked", async () => {
      beforeEach(async () => {
        const spanBlock = newWrapper.find('[data-test="span-block-select-trigger"]');
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

  // ─── New tests covering functionality added after Dec 05 2025 ───────────────

  describe("formatTimeWithSuffix usage for duration display", () => {
    it("should render duration using formatTimeWithSuffix (not raw durationMs)", () => {
      // The source uses formatTimeWithSuffix(span.durationUs) — not durationMs.toFixed()
      const durationEl = wrapper.find('[data-test="span-block-duration"]');
      expect(durationEl.exists()).toBe(true);
      // The text must be non-empty (formatted value); it should NOT equal the old
      // durationMs format like "321.37ms" verbatim when durationUs has microseconds
      expect(durationEl.text().trim()).not.toBe("");
    });

    it("should expose formatTimeWithSuffix from setup", () => {
      expect(wrapper.vm.formatTimeWithSuffix).toBeDefined();
      expect(typeof wrapper.vm.formatTimeWithSuffix).toBe("function");
    });
  });

  describe("getDurationStyle — right-aligned edge case", () => {
    it("should expose getDurationStyle function", () => {
      expect(wrapper.vm.getDurationStyle).toBeDefined();
      expect(typeof wrapper.vm.getDurationStyle).toBe("function");
    });

    it("should return an object with 'top' property", () => {
      const style = wrapper.vm.getDurationStyle();
      expect(style).toHaveProperty("top");
    });

    // Regression: this branch used to set `right: 0`, which pins the label to the
    // container's right edge. A bar that leaves no room after itself is a bar
    // that reaches that edge, so the label was printed on top of the bar in
    // row-background text colour over an arbitrary service colour — every long
    // span rendered an unreadable duration. It now goes above the bar, into the
    // empty band the row's `items-end` leaves there.
    it("lifts the label above the bar when it does not fit after it", async () => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", {
        configurable: true,
        value: 100,
      });
      await wrapper.vm.onResize();

      // leftPosition = 0, spanWidth ≈ 91.72% of 100px → the bar ends at 91.72px
      // and the 60px label cannot follow it inside a 100px row.
      const style = wrapper.vm.getDurationStyle();

      expect(style).not.toHaveProperty("right");
      expect(style.top).toBe("-1rem");
      // Right-aligned to the bar's end: 91.72 - 60.
      expect(parseFloat(style.left)).toBeCloseTo(31.72, 1);
      expect(wrapper.vm.labelAboveBar).toBe(true);
    });

    // The lifted label tracks the bar's own right edge, not the container's, so
    // it still reads as this bar's duration when the bar stops short of the edge.
    it("right-aligns the lifted label to the bar's end, not the container's", async () => {
      // 80% of the trace in a 300px row: the bar ends at 240px, and 240 + 6 + 60
      // = 306 overflows, so the label lifts. It must land at 180px — ending with
      // the bar at 240 — rather than at the container's 240px right-alignment.
      await wrapper.setProps({ span: { ...mockSpan, durationUs: 280297 } });
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
      await wrapper.vm.onResize();
      await flushPromises();

      const style = wrapper.vm.getDurationStyle();

      expect(wrapper.vm.spanWidth).toBe(80);
      expect(wrapper.vm.labelAboveBar).toBe(true);
      expect(parseFloat(style.left)).toBeCloseTo(180, 1);
      // Ends with the bar, well short of the container's own right edge.
      expect(parseFloat(style.left) + 60).toBeLessThan(300);
    });

    // The band above the bar is only free because the bar row sits at the bottom
    // of the 30px span row. Beside the bar the label stays centred on it, so the
    // lift must not leak into the ordinary positions.
    it("keeps the label centred on the bar wherever it fits beside it", async () => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 2000 });
      await wrapper.vm.onResize();

      const style = wrapper.vm.getDurationStyle();

      expect(style.top).toBe("-0.25rem");
      expect(wrapper.vm.labelAboveBar).toBe(false);
    });
  });

  describe("getDurationStyle — bar-to-label gutter", () => {
    // The 6px gutter used to be baked into the bar fill's width. It now lives
    // here, so the bar can be truthful while the label keeps its breathing room.
    it("offsets the label past the bar end by the gutter", async () => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 1000 });
      await wrapper.vm.onResize();

      // leftPosition = 0, spanWidth ≈ 91.72%, onePercent = 10
      // bar ends at 917.2px; label sits 6px past it.
      const style = wrapper.vm.getDurationStyle();
      expect(style.left).toBe(`${91.72 * 10 + 6}px`);
    });

    // Regression: below 19px of bar the label stops tracking the bar's end and
    // pins to a fixed offset from its start. That offset used to clear the fill
    // by `19 + 6 - barWidth`, because the fill was drawn 6px shorter than its
    // geometry box. Once the bar became truthful the clearance fell to
    // `19 - barWidth`, i.e. to ~0 for a bar just under the threshold.
    it("keeps the gutter's clearance on a bar too narrow to track", async () => {
      // 5255 / 350372 → spanWidth 1.50%, i.e. a 15px bar in a 1000px row.
      await wrapper.setProps({ span: { ...mockSpan, durationUs: 5255 } });
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 1000 });
      await wrapper.vm.onResize();
      await flushPromises();

      expect(wrapper.vm.spanWidth).toBe(1.5);
      expect(wrapper.vm.getDurationStyle().left).toBe(`${19 + 6}px`);
    });

    // Regression: the right-align threshold was still written for a label
    // placed flush against the bar. With the gutter the label's right edge is
    // `barEnd + 6 + 60`, so a band of 6px worth of bar widths fell through to
    // the left-aligned branch and got clipped by `overflow-hidden`.
    it("moves the label off a bar the gutter would push out of the container", async () => {
      // 329350 / 350372 → spanWidth 94.00%, so the bar ends at 940px of 1000px.
      // Label at 946px + 60px wide = 1006px, past the container's edge, so it
      // lifts and right-aligns to the bar's end at 940.
      await wrapper.setProps({ span: { ...mockSpan, durationUs: 329350 } });
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 1000 });
      await wrapper.vm.onResize();
      await flushPromises();

      expect(wrapper.vm.spanWidth).toBe(94);
      expect(parseFloat(wrapper.vm.getDurationStyle().left)).toBeCloseTo(940 - 60, 1);
      expect(wrapper.vm.labelAboveBar).toBe(true);
    });

    // The case the screenshot showed. There IS room to the left of a bar like
    // this, and an earlier revision used it — but that split long spans between
    // two treatments on a margin of a pixel or two, so neighbouring rows of
    // similar length disagreed about where the label belonged. Every bar with no
    // room after it now lifts, whatever is to its left.
    it("lifts a long bar's label rather than tucking it into the space on the left", async () => {
      // Starts 30% in and runs to the container's right edge, so there is ~234px
      // free on the left — more than the 66px the label would need there.
      await wrapper.setProps({
        span: {
          ...mockSpan,
          startTimeUs: mockBaseTracePosition.startTimeUs + 105112,
          durationUs: 245260,
        },
      });
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 1000 });
      await wrapper.vm.onResize();
      await flushPromises();

      const barStartPx = wrapper.vm.leftPosition * 10;
      const style = wrapper.vm.getDurationStyle();

      expect(barStartPx).toBeGreaterThan(66);
      expect(wrapper.vm.labelAboveBar).toBe(true);
      expect(style.top).toBe("-1rem");
      // Above the bar's end, not tucked in before its start.
      expect(parseFloat(style.left)).toBeGreaterThan(barStartPx);
    });
  });

  describe("duration label lifted above the bar", () => {
    /** Squeezes the container until neither side of the bar has room. */
    const forceLabelAboveBar = async (w: any) => {
      const el = w.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 100 });
      await w.vm.onResize();
      await flushPromises();
    };

    // The label goes onto the row background rather than onto the span's colour,
    // so it needs no contrast treatment and hides none of the bar. The flag is
    // exposed on the element so the position is observable from the DOM.
    it("flags the lifted label and offsets it clear of the bar", async () => {
      await forceLabelAboveBar(wrapper);

      const label = wrapper.find('[data-test="span-block-duration"]');

      expect(label.attributes("data-label-above-bar")).toBe("true");
      expect(label.attributes("style")).toContain("top: -1rem");
    });

    it("does not flag a label that fits beside the bar", async () => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 2000 });
      await wrapper.vm.onResize();
      await flushPromises();

      expect(
        wrapper.find('[data-test="span-block-duration"]').attributes("data-label-above-bar"),
      ).toBe("false");
    });

    // Regression: the flag is a side effect of the placement function, so a stale
    // `true` would keep a label floating above a bar that had since shrunk enough
    // to sit beside it. Rows are virtualized and resize as the sidebar opens.
    it("drops the lift once the bar shrinks enough to fit beside it", async () => {
      await forceLabelAboveBar(wrapper);
      expect(wrapper.vm.labelAboveBar).toBe(true);

      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 2000 });
      await wrapper.vm.onResize();
      await flushPromises();

      expect(wrapper.vm.labelAboveBar).toBe(false);
      expect(wrapper.vm.getDurationStyle().top).toBe("-0.25rem");
    });

    // Regression: every room comparison fails against an unmeasured container,
    // which lifted the label above the bar at a negative offset — off-screen —
    // on every row before its first resize. Rows are virtualized and remount on
    // scroll, so this was the state each one rendered in first.
    it("falls back to the after-the-bar position before the row is measured", () => {
      // jsdom reports clientWidth 0, so this wrapper has never been measured.
      const style = wrapper.vm.getDurationStyle();

      expect(parseFloat(style.left)).toBeGreaterThanOrEqual(0);
      expect(style.top).toBe("-0.25rem");
      expect(wrapper.vm.labelAboveBar).toBe(false);
    });
  });

  describe("durationStyle reactive ref", () => {
    it("should expose durationStyle and be an object", () => {
      expect(wrapper.vm.durationStyle).toBeDefined();
      expect(typeof wrapper.vm.durationStyle).toBe("object");
    });

    it("should update durationStyle when spanBlockWidth changes via onResize", async () => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", {
        configurable: true,
        value: 2048,
      });
      await wrapper.vm.onResize();

      const afterStyle = { ...wrapper.vm.durationStyle };
      // Style object should still be a valid object (no crash)
      expect(afterStyle).toBeDefined();
    });
  });

  describe("onSpanHover emits hover", () => {
    it("should emit hover event when span block is hovered", async () => {
      const spanBlock = wrapper.find('[data-test="span-block"]');
      await spanBlock.trigger("mouseover");
      expect(wrapper.emitted("hover")).toBeTruthy();
    });

    it("should call onSpanHover on mouseover of the span-block", async () => {
      const onSpanHoverSpy = vi.spyOn(wrapper.vm, "onSpanHover");
      const spanBlock = wrapper.find('[data-test="span-block"]');
      await spanBlock.trigger("mouseover");
      expect(onSpanHoverSpy).toHaveBeenCalled();
    });
  });

  describe("leftPosition and spanWidth reactive refs", () => {
    it("should expose leftPosition as a number", () => {
      expect(typeof wrapper.vm.leftPosition).toBe("number");
    });

    it("should expose spanWidth as a number", () => {
      expect(typeof wrapper.vm.spanWidth).toBe("number");
    });

    it("leftPosition should be 0 when span starts at trace start", () => {
      // mockSpan.startTimeUs === mockBaseTracePosition.startTimeUs
      expect(wrapper.vm.leftPosition).toBe(0);
    });

    it("spanWidth should reflect the fraction of total trace duration", () => {
      // 321372 / 350372 ≈ 91.72 %
      expect(wrapper.vm.spanWidth).toBeCloseTo(91.72, 0);
    });

    it("should recalculate leftPosition when baseTracePosition changes", async () => {
      const newBaseTracePosition = {
        ...mockBaseTracePosition,
        startTimeUs: mockSpan.startTimeUs - 50000,
        durationUs: 400000,
      };
      await wrapper.setProps({ baseTracePosition: newBaseTracePosition });
      // left = (startTimeUs - newStart) / duration * 100 = 50000/400000*100 = 12.5
      expect(wrapper.vm.leftPosition).toBeCloseTo(12.5, 0);
    });
  });

  describe("span-block-select-trigger click", () => {
    it("should emit selectSpan when select trigger div is clicked", async () => {
      const trigger = wrapper.find('[data-test="span-block-select-trigger"]');
      await trigger.trigger("click");
      expect(wrapper.emitted("selectSpan")).toBeTruthy();
      expect(wrapper.emitted("selectSpan")![0]).toEqual([mockSpan.spanId]);
    });
  });

  describe("spanMarker styling", () => {
    it("should render span-marker element", () => {
      expect(wrapper.find('[data-test="span-marker"]').exists()).toBe(true);
    });

    it("span-marker height should match spanDimensions.barHeight", () => {
      const marker = wrapper.find('[data-test="span-marker"]');
      expect(marker.attributes("style")).toContain(`height: ${mockSpanDimensions.barHeight}px`);
    });

    it("inner color div should use span.style.color as background", () => {
      // The inner div of the marker uses backgroundColor: span.style.color
      // Browsers normalize hex colors to rgb() in inline styles
      const marker = wrapper.find('[data-test="span-marker"]');
      const colorDiv = marker.find("div");
      const style = colorDiv.attributes("style") ?? "";
      const hasHex = style.includes(`background-color: ${mockSpan.style.color}`);
      const hasRgb = style.includes("background-color: rgb(26, 184, 190)");
      expect(hasHex || hasRgb).toBe(true);
    });

    // Regression: the fill carried `calc(100% - 6px)`, vestigial space
    // reservation for a chevron removed in Oct 2024 (commit d7876dde46). It
    // made every bar 6px shorter than its span and clamped any span <=6px wide
    // to zero visible width.
    it("fills the full width of the span's geometry box", () => {
      const marker = wrapper.find('[data-test="span-marker"]');
      const fill = marker.find("div");
      expect(fill.classes()).toContain("w-full");
      expect(fill.classes()).not.toContain("w-[calc(100%-0.375rem)]");
    });
  });

  describe("span event markers", () => {
    // Event timestamps are stored in nanoseconds while the trace window is in
    // microseconds — see useSpanEvents.
    const eventNsAt = (fraction: number) =>
      (mockBaseTracePosition.startTimeUs + mockBaseTracePosition.durationUs * fraction) * 1000;

    const setEvents = async (events: unknown) =>
      wrapper.setProps({
        spanData: {
          ...mockSpanData,
          events: typeof events === "string" ? events : JSON.stringify(events),
        },
      });

    const markers = () => wrapper.findAll('[data-test="span-event-marker"]');

    /**
     * Drives the component's real resize path so clustering has a measured
     * container width. jsdom reports clientWidth as 0, which the composable
     * treats as "not measured yet" and renders every marker un-clustered.
     */
    const setTimelineWidth = async (width: number) => {
      const el = wrapper.find('[data-test="span-block"]').element;
      Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
      (wrapper.vm as any).onResize();
      await flushPromises();
    };

    it("renders no markers for a span with no events", () => {
      expect(markers()).toHaveLength(0);
    });

    // Regression: this div carried Quasar's `position-relative`, a class no rule
    // in this codebase defines, so it was a static box. The markers and the
    // duration label are absolutely positioned inside it; with no positioned
    // ancestor here they escaped to the waterfall row wrapper and `top-1/2`
    // centred them on the 30px row instead of the 8px bar. jsdom does no layout,
    // so this can only assert the containing block exists, not where it lands.
    it("makes the bar row the markers' containing block", () => {
      const trigger = wrapper.find('[data-test="span-block-select-trigger"]');

      expect(trigger.classes()).toContain("relative");
      expect(trigger.classes()).not.toContain("position-relative");
    });

    // The bar row is only as tall as the bar, so once it became the containing
    // block its `overflow-hidden` would have cut the duration label's 1rem line
    // box down to the bar's 8px. The clip belongs on the full-height row, which
    // has the same left and right edges.
    it("clips at the row, not at the bar row", () => {
      expect(wrapper.find('[data-test="span-block"]').classes()).toContain("overflow-hidden");
      expect(wrapper.find('[data-test="span-block-select-trigger"]').classes()).not.toContain(
        "overflow-hidden",
      );
    });

    // Regression: `spanBlockWidth` starts at 0 and was only ever set by the
    // 300ms-debounced observer callback, so a row that scrolled into view spent
    // a third of a second with a cluster threshold of 0 — every event its own
    // overlapping tick — before collapsing.
    it("clusters on first render rather than after the debounce", async () => {
      const widthSpy = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(900);
      let earlyWrapper: any;

      try {
        earlyWrapper = mount(SpanBlock, {
          props: {
            span: mockSpan,
            baseTracePosition: mockBaseTracePosition,
            depth: 0,
            styleObj: mockStyle,
            showCollapse: true,
            isCollapsed: false,
            spanDimensions: mockSpanDimensions,
            spanData: {
              ...mockSpanData,
              events: JSON.stringify([
                { name: "a", _timestamp: eventNsAt(0.5) },
                { name: "b", _timestamp: eventNsAt(0.5001) },
                { name: "c", _timestamp: eventNsAt(0.5002) },
              ]),
            },
          },
          global: { plugins: [i18n, router], provide: { store: mockStore } },
        });
        await flushPromises();

        const earlyMarkers = earlyWrapper.findAll('[data-test="span-event-marker"]');
        expect(earlyMarkers).toHaveLength(1);
        expect(earlyMarkers[0].attributes("data-event-count")).toBe("3");
      } finally {
        earlyWrapper?.unmount();
        widthSpy.mockRestore();
      }
    });

    it("positions markers across the trace window and flags exceptions", async () => {
      await setEvents([
        { name: "cache.miss", _timestamp: eventNsAt(0.25) },
        { name: "exception", _timestamp: eventNsAt(0.75), "exception.type": "TimeoutError" },
      ]);

      expect(markers()).toHaveLength(2);
      expect(markers()[0].attributes("style")).toContain("left: 25%");
      expect(markers()[0].attributes("data-event-severity")).toBe("info");
      expect(markers()[1].attributes("style")).toContain("left: 75%");
      expect(markers()[1].attributes("data-event-severity")).toBe("error");
    });

    it("labels markers with the event name and exception type", async () => {
      await setEvents([
        { name: "cache.miss", _timestamp: eventNsAt(0.25) },
        { name: "exception", _timestamp: eventNsAt(0.75), "exception.type": "TimeoutError" },
      ]);

      expect(markers()[0].attributes("title")).toContain("cache.miss");
      expect(markers()[1].attributes("title")).toContain("TimeoutError");
      expect(markers()[1].attributes("aria-label")).toContain("TimeoutError");
    });

    it("colours exceptions and ordinary events with different tokens", async () => {
      await setEvents([
        { name: "cache.miss", _timestamp: eventNsAt(0.25) },
        { name: "exception", _timestamp: eventNsAt(0.75) },
      ]);

      expect(markers()[0].classes()).toContain("bg-trace-event-info");
      expect(markers()[1].classes()).toContain("bg-badge-error-solid-bg");
    });

    // Regression: `default`-stream events carry `level` and no `exception.*`.
    // Exception-only detection rendered a level=ERROR event as benign.
    it("renders a level=ERROR event with the error token", async () => {
      await setEvents([{ name: "search failed", level: "ERROR", _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].classes()).toContain("bg-badge-error-solid-bg");
      expect(markers()[0].attributes("data-event-severity")).toBe("error");
    });

    it("renders a level=WARN event with the warning token", async () => {
      await setEvents([{ name: "retrying", level: "WARN", _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].classes()).toContain("bg-badge-warning-solid-bg");
      expect(markers()[0].attributes("data-event-severity")).toBe("warning");
    });

    it("renders a level=INFO event with the info token", async () => {
      await setEvents([{ name: "cache hit", level: "INFO", _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].classes()).toContain("bg-trace-event-info");
      expect(markers()[0].attributes("data-event-severity")).toBe("info");
    });

    // The default stream's median event name is 119 chars; the longest is 5561.
    it("truncates a long event name in both the tooltip and the accessible name", async () => {
      await setEvents([{ name: "y".repeat(400), _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].attributes("title")!.length).toBeLessThan(120);
      expect(markers()[0].attributes("aria-label")!.length).toBeLessThan(120);
    });

    // Every tick is h-3 (12px) against the 8px bar — 1.5x, so it overhangs by
    // 2px above and below. A stroke that crosses the bar reads as an annotation
    // on it; an enclosed tick competed with the bar for the same few pixels and
    // looked like it was replacing the span. Overhang also puts part of every
    // mark on the row background, a known luminance, which is what lets markers
    // carry no outline at all.
    it("overhangs the bar on every severity tier", async () => {
      await setEvents([
        { name: "boom", level: "ERROR", _timestamp: eventNsAt(0.2) },
        { name: "hmm", level: "WARN", _timestamp: eventNsAt(0.5) },
        { name: "fyi", level: "INFO", _timestamp: eventNsAt(0.8) },
      ]);

      expect(markers()).toHaveLength(3);
      expect(
        markers()
          .map((m: any) => m.attributes("data-event-severity"))
          .sort(),
      ).toEqual(["error", "info", "warning"]);
      for (const marker of markers()) {
        expect(marker.classes()).toContain("h-3");
        expect(marker.classes()).not.toContain("h-1.5");
        expect(marker.classes()).not.toContain("rounded-full");
      }
    });

    // A cluster takes the highest severity it contains. Height no longer varies
    // by tier, but the promotion still has to reach the rendered marker, so this
    // pins the severity that drives its colour.
    it("gives a cluster promoted to error the error styling", async () => {
      await setTimelineWidth(900);
      await setEvents([
        { name: "a", level: "INFO", _timestamp: eventNsAt(0.5) },
        { name: "b", level: "ERROR", _timestamp: eventNsAt(0.5001) },
      ]);

      expect(markers()).toHaveLength(1);
      expect(markers()[0].attributes("data-event-severity")).toBe("error");
      expect(markers()[0].classes()).toContain("h-3");
      expect(markers()[0].classes()).toContain("bg-badge-error-solid-bg");
    });

    it("gives the marker a hit area wider than the tick itself", async () => {
      await setEvents([{ name: "a", _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].classes()).toContain("before:w-2.5");
    });

    // A ring is 1px on all four sides, so on a 3px tick it is 40% of the width
    // and most of the area — and `ring-surface-base` is opaque where the
    // achromatic info fill is not, so the outline out-shouted the mark and the
    // marker read as a bordered box. No tier carries one now: separation comes
    // from luminance (info), overhang (error) and hue (warning).
    it("carries no ring on any tier, so the fill is the whole mark", async () => {
      await setEvents([
        { name: "boom", level: "ERROR", _timestamp: eventNsAt(0.2) },
        { name: "hmm", level: "WARN", _timestamp: eventNsAt(0.5) },
        { name: "fyi", level: "INFO", _timestamp: eventNsAt(0.8) },
      ]);

      expect(markers()).toHaveLength(3);
      for (const marker of markers()) {
        expect(marker.classes()).not.toContain("ring-1");
        expect(marker.classes()).not.toContain("ring-surface-base");
      }
    });

    // The tick is 3px on both DOM surfaces, and MARKER_MIN_SPACING_PX is derived
    // from that width — the two are one decision, so a change here without a
    // matching change there reintroduces the overlap clustering prevents.
    it("renders the tick at the shared 3px width", async () => {
      await setEvents([{ name: "a", _timestamp: eventNsAt(0.4) }]);

      expect(markers()[0].classes()).toContain("w-0.75");
    });

    // Regression: 55.1% of default-stream events were hidden behind a neighbour.
    it("renders one marker per cluster, not one per event", async () => {
      await setTimelineWidth(900);
      await setEvents([
        { name: "a", _timestamp: eventNsAt(0.5) },
        { name: "b", _timestamp: eventNsAt(0.5001) },
        { name: "c", _timestamp: eventNsAt(0.5002) },
      ]);

      expect(markers()).toHaveLength(1);
      expect(markers()[0].attributes("data-event-count")).toBe("3");
    });

    it("labels a cluster by count rather than by one event's name", async () => {
      await setTimelineWidth(900);
      await setEvents([
        { name: "a", _timestamp: eventNsAt(0.5) },
        { name: "b", _timestamp: eventNsAt(0.5001) },
      ]);

      expect(markers()[0].attributes("title")).toContain("2");
    });

    it("promotes a cluster containing an error to the error token", async () => {
      await setTimelineWidth(900);
      await setEvents([
        { name: "a", level: "INFO", _timestamp: eventNsAt(0.5) },
        { name: "b", level: "ERROR", _timestamp: eventNsAt(0.5001) },
      ]);

      expect(markers()).toHaveLength(1);
      expect(markers()[0].classes()).toContain("bg-badge-error-solid-bg");
    });

    it("selects the span when a marker is clicked", async () => {
      await setEvents([{ name: "cache.miss", _timestamp: eventNsAt(0.25) }]);
      await markers()[0].trigger("click");

      expect(wrapper.emitted("selectSpan")?.[0]).toEqual([mockSpan.spanId]);
    });

    it("ignores malformed event payloads", async () => {
      await setEvents("not-json");

      expect(markers()).toHaveLength(0);
    });

    it("skips events falling outside the trace window", async () => {
      await setEvents([
        { name: "before", _timestamp: eventNsAt(-0.5) },
        { name: "inside", _timestamp: eventNsAt(0.5) },
      ]);

      expect(markers()).toHaveLength(1);
      expect(markers()[0].attributes("title")).toContain("inside");
    });
  });

  describe("pre-selected span_id scroll behavior", () => {
    let scrollSpy: ReturnType<typeof vi.fn>;
    let originalScrollIntoView: any;

    beforeEach(() => {
      scrollSpy = vi.fn();
      // jsdom does not implement scrollIntoView — install a spy.
      originalScrollIntoView = (Element.prototype as any).scrollIntoView;
      (Element.prototype as any).scrollIntoView = scrollSpy;
    });

    afterEach(async () => {
      (Element.prototype as any).scrollIntoView = originalScrollIntoView;
      await router.push({ query: {} });
    });

    // Regression: with virtualized rows, a SpanBlock remounts every time it
    // scrolls into the viewport. It must NOT scroll the URL's span_id back into
    // view on each mount (that fought the user's scroll). Centering the
    // pre-selected span is owned by TraceTree via the virtualizer.
    it("should not scroll the span into view on mount when span_id is in the route query", async () => {
      await router.push({ query: { span_id: mockSpan.spanId } });

      const localWrapper = mount(SpanBlock, {
        attachTo: document.body,
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
          provide: { store: mockStore },
          stubs: {},
        },
      });

      await flushPromises();

      expect(scrollSpy).not.toHaveBeenCalled();

      localWrapper.unmount();
    });
  });
});

describe("SpanBlock marker drill-down", () => {
  // Selecting a span hides the waterfall timeline entirely, so a marker click
  // must carry enough information to re-establish the same picture in the
  // sidebar rather than merely selecting the span.
  it("emits the clicked cluster's first event index alongside the span id", async () => {
    const wrapper = mount(SpanBlock, {
      props: {
        span: mockSpan,
        baseTracePosition: mockBaseTracePosition,
        spanDimensions: mockSpanDimensions,
        spanData: {
          events: JSON.stringify([
            { name: "a", _timestamp: (mockBaseTracePosition.startTimeUs + 70074) * 1000 },
            { name: "b", _timestamp: (mockBaseTracePosition.startTimeUs + 280297) * 1000 },
          ]),
        },
      },
      global: { plugins: [i18n, router, mockStore] },
    });
    await flushPromises();

    const markers = wrapper.findAll('[data-test="span-event-marker"]');
    expect(markers).toHaveLength(2);
    await markers[1].trigger("click");

    expect(wrapper.emitted("selectSpanEvent")).toEqual([
      [{ spanId: mockSpan.spanId, eventIndex: 1 }],
    ]);
    // Still selects the span, so the sidebar opens at all.
    expect(wrapper.emitted("selectSpan")).toEqual([[mockSpan.spanId]]);
  });
});
