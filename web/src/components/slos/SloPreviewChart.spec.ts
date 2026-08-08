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

import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SloPreviewChart from "./SloPreviewChart.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// The renderer pulls in the whole dashboard panel stack (and ECharts through
// it). What matters here is the SCHEMA this component hands it, so the stub
// keeps the props and draws nothing.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "width", "height", "variablesData", "searchType"],
    template: '<div class="panel-schema-renderer-stub" />',
  },
}));

const NOW = 1_754_300_000_000; // fixed wall clock — the built window is relative to it

/** Mounted AND settled: the schemas are built in `onMounted`, so the first
 *  render is always the empty state — every assertion here needs the tick. */
const createWrapper = async (props: Record<string, any> = {}) => {
  const wrapper = mount(SloPreviewChart, {
    props: {
      streamType: "logs",
      stream: "default",
      scope: "",
      goodExpr: "code < 500",
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

/** The schemas actually handed to the renderer, in panel order (good, bad). */
const schemas = (wrapper: VueWrapper<any>) =>
  wrapper.findAllComponents({ name: "PanelSchemaRenderer" }).map((c) => c.props("panelSchema"));

describe("SloPreviewChart", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  describe("panels", () => {
    it("draws good and bad as TWO panels, not two series on one chart", async () => {
      // The component's central design decision: good and bad are near-perfect
      // mirrors, so a shared axis flattens the small series (bad) into the
      // baseline — and bad is the one that matters.
      wrapper = await createWrapper();

      expect(wrapper.find('[data-test="slos-slopreviewchart-good"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="slos-slopreviewchart-bad"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Good events");
      expect(wrapper.text()).toContain("Bad events");
      expect(schemas(wrapper)).toHaveLength(2);
    });

    it("titles the panels with the shared PanelBar, so they carry the header tint", async () => {
      // Regression guard: these bars were hand-copied class strings and silently
      // missed the header tint when it was introduced.
      wrapper = await createWrapper();

      const bars = wrapper.findAllComponents({ name: "PanelBar" });
      expect(bars).toHaveLength(2);
      expect(bars[0].classes()).toContain("bg-panel-bar-bg");
    });
  });

  describe("before the SLI is defined", () => {
    it("shows the prompt instead of an empty chart when good_expr is missing", async () => {
      wrapper = await createWrapper({ goodExpr: "" });

      expect(schemas(wrapper)).toHaveLength(0);
      expect(wrapper.find('[data-test="slos-slopreviewchart-good-empty"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Pick a stream and define "good when" to preview');
    });

    it("shows the prompt when the stream is blank", async () => {
      wrapper = await createWrapper({ stream: "   " });

      expect(schemas(wrapper)).toHaveLength(0);
      expect(wrapper.find('[data-test="slos-slopreviewchart-bad-empty"]').exists()).toBe(true);
    });
  });

  describe("the schema it builds", () => {
    it("pins each series to a FIXED colour so good and bad never draw the same", async () => {
      // The default hashes the series NAME into the palette, which is what drew
      // both series blue. `fixed` is the fix, and the two colours must differ.
      wrapper = await createWrapper();
      const [good, bad] = schemas(wrapper);

      expect(good.config.color.mode).toBe("fixed");
      expect(bad.config.color.mode).toBe("fixed");
      expect(good.config.color.fixedColor).not.toEqual(bad.config.color.fixedColor);
    });

    it("blanks the axis labels — the panel header already names the series", async () => {
      wrapper = await createWrapper();
      const [good] = schemas(wrapper);

      expect(good.queries[0].fields.x[0].label).toBe("");
      expect(good.queries[0].fields.y[0].label).toBe("");
    });

    it("draws BARS: these are counts per bucket, and a line implies interpolation", async () => {
      wrapper = await createWrapper();
      expect(schemas(wrapper)[0].type).toBe("bar");
    });

    it("carries the stream and stream type as a custom SQL query", async () => {
      wrapper = await createWrapper({ streamType: "traces", stream: "spans" });
      const [good] = schemas(wrapper);

      expect(good.queryType).toBe("sql");
      expect(good.queries[0].customQuery).toBe(true);
      expect(good.queries[0].fields.stream).toBe("spans");
      expect(good.queries[0].fields.stream_type).toBe("traces");
    });

    it("counts good and bad with DIFFERENT queries off the same definition", async () => {
      wrapper = await createWrapper();
      const [good, bad] = schemas(wrapper);
      expect(good.queries[0].query).not.toBe(bad.queries[0].query);
    });
  });

  describe("the preview window", () => {
    it("feeds the renderer MICROSECONDS-into-Date, the convention it expects", async () => {
      // Honest milliseconds render an empty chart — the one thing about this
      // window that is not guessable from the code.
      wrapper = await createWrapper();
      const timeObj = wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })[0]
        .props("selectedTimeObj");

      expect(timeObj.end_time.getTime()).toBe(NOW * 1000);
      expect(timeObj.end_time.getTime() - timeObj.start_time.getTime()).toBe(3600 * 1000 * 1000);
    });

    it("widens the window when a longer range is picked", async () => {
      wrapper = await createWrapper();
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "6h");
      await flushPromises();

      const timeObj = wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })[0]
        .props("selectedTimeObj");
      expect(timeObj.end_time.getTime() - timeObj.start_time.getTime()).toBe(
        6 * 3600 * 1000 * 1000,
      );
    });

    it("ignores an empty range selection rather than collapsing the window", async () => {
      wrapper = await createWrapper();
      wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "");
      await flushPromises();

      const timeObj = wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })[0]
        .props("selectedTimeObj");
      expect(timeObj.end_time.getTime() - timeObj.start_time.getTime()).toBe(3600 * 1000 * 1000);
    });

    it("shares ONE window across both panels — they are two readings of it", async () => {
      wrapper = await createWrapper();
      const [good, bad] = wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })
        .map((c) => c.props("selectedTimeObj"));
      expect(good).toBe(bad);
    });
  });

  describe("debounce", () => {
    it("waits for a pause in typing before rebuilding — every rebuild is two searches", async () => {
      wrapper = await createWrapper();
      const before = schemas(wrapper)[0].queries[0].query;

      await wrapper.setProps({ goodExpr: "code < 400" });
      await flushPromises();
      expect(schemas(wrapper)[0].queries[0].query).toBe(before); // still the old query

      vi.advanceTimersByTime(500);
      await flushPromises();
      expect(schemas(wrapper)[0].queries[0].query).not.toBe(before);
    });

    it("collapses a burst of keystrokes into ONE rebuild", async () => {
      wrapper = await createWrapper();

      await wrapper.setProps({ goodExpr: "a" });
      vi.advanceTimersByTime(300);
      await wrapper.setProps({ goodExpr: "ab" });
      vi.advanceTimersByTime(300);
      await wrapper.setProps({ goodExpr: "abc" });
      vi.advanceTimersByTime(499);
      await flushPromises();

      // 1099ms in, still nothing: the timer restarted on every keystroke.
      expect(schemas(wrapper)[0].queries[0].query).toContain("code < 500");

      vi.advanceTimersByTime(1);
      await flushPromises();
      expect(schemas(wrapper)[0].queries[0].query).toContain("abc");
    });

    it("drops a pending rebuild on unmount", async () => {
      wrapper = await createWrapper();
      await wrapper.setProps({ goodExpr: "code < 400" });
      expect(vi.getTimerCount()).toBe(1); // the debounce is armed

      wrapper.unmount();

      // Cleared, not merely harmless: a surviving timer rebuilds a torn-down
      // component (and Vue does not throw on that, so nothing would show it).
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
