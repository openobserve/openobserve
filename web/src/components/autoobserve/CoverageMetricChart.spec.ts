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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import CoverageMetricChart from "./CoverageMetricChart.vue";
import type { MetricDef, MetricSeries } from "./coverageSeries";
import type { CoverageCell } from "./fixtures";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: { name: "ChartRenderer", props: ["data"], template: "<div />" },
}));

const DEF: MetricDef = {
  signal: "latency",
  titleKey: "autoobserveLive.classes.latency",
  unit: "ms",
  base: 100,
  spread: 10,
};

const SERIES: MetricSeries = {
  points: [],
  band: null,
  anomalies: [],
  current: 0,
  previous: 0,
  low: null,
  high: null,
};

const gapCell = (stateKey: "none" | "silent"): CoverageCell => ({
  state: "gap",
  reason: raw("Latency: no monitor watches this"),
  engine: { state: raw(stateKey), stateKey, monitors: [] },
});

const mountChart = (cell: CoverageCell, noData: boolean) =>
  mount(CoverageMetricChart, {
    props: {
      def: DEF,
      series: SERIES,
      cell,
      range: "24h",
      start: 0,
      end: 1,
      expanded: false,
      readyOn: null,
      noData,
    },
    global: { plugins: [i18n, store] },
  });

const badge = (wrapper: ReturnType<typeof mountChart>) =>
  wrapper.find('[data-test="autoobserve-coverage-chart-badge-latency"]').text();

describe("CoverageMetricChart gap wording", () => {
  it("names a live gap by its glossary word once, on the badge only", () => {
    const missing = mountChart(gapCell("none"), true);
    expect(badge(missing)).toBe("Coverage gap");
    expect(
      missing.find('[data-test="autoobserve-coverage-chart-badge-latency"]').classes(),
    ).toContain("text-badge-amber-soft-text");
    expect(missing.text().split("Coverage gap")).toHaveLength(2);
    expect(missing.find('[data-test="autoobserve-coverage-chart-gap-latency"]').exists()).toBe(
      false,
    );
    expect(missing.find('[data-test="autoobserve-coverage-chart-nodata-latency"]').exists()).toBe(
      true,
    );
    expect(badge(mountChart(gapCell("silent"), true))).toBe("Coverage gap");
  });

  it("reads Added, not Coverage gap, on a check whose alert was just added (T2-N1)", () => {
    const wrapper = mount(CoverageMetricChart, {
      props: {
        def: DEF,
        series: SERIES,
        cell: gapCell("none"),
        range: "24h",
        start: 0,
        end: 1,
        expanded: false,
        readyOn: null,
        noData: false,
        added: true,
      },
      global: { plugins: [i18n, store] },
    });
    expect(badge(wrapper)).toBe("Added");
    expect(
      wrapper.find('[data-test="autoobserve-coverage-chart-badge-latency"]').classes(),
    ).toContain("text-text-secondary");
  });

  it("keeps 'Coverage gap' outside live mode", () => {
    const wrapper = mountChart({ state: "gap" }, false);
    expect(badge(wrapper)).toBe("Coverage gap");
    expect(wrapper.find('[data-test="autoobserve-coverage-chart-gap-latency"]').text()).toBe(
      "Coverage gap",
    );
  });
});

describe("CoverageMetricChart live states", () => {
  const COVERED: CoverageCell = {
    state: "watched",
    detector: "checkout-p99",
    engine: { state: raw("covered"), stateKey: "covered", monitors: [] },
  };
  const READY: MetricSeries = { ...SERIES, points: [[0, 120]], current: 120, previous: 100 };

  const mountLive = (props: Record<string, unknown>) =>
    mount(CoverageMetricChart, {
      props: {
        def: DEF,
        series: READY,
        cell: COVERED,
        range: "24h",
        start: 0,
        end: 1,
        expanded: false,
        readyOn: null,
        status: "ready",
        ...props,
      },
      global: { plugins: [i18n, store] },
    });

  const find = (wrapper: ReturnType<typeof mountLive>, part: string) =>
    wrapper.find(`[data-test="autoobserve-coverage-chart-${part}-latency"]`);

  it("holds the chart's height with a skeleton while loading", () => {
    const loading = mountLive({ status: "loading" });
    const skeleton = find(loading, "loading");
    expect(skeleton.exists()).toBe(true);
    expect(skeleton.classes()).toContain("h-30");
    expect(find(loading, "value").exists()).toBe(false);
    const ready = mountLive({});
    expect(ready.find('[role="img"]').classes()).toContain("h-30");
    expect(find(ready, "value").text()).toBe("120 ms");
  });

  it("shows a failed chart in red, saying what failed and why, with a Retry that asks again", async () => {
    const wrapper = mountLive({
      status: "failed",
      reason: raw("Couldn't load this chart from app_traces"),
      detail: raw("the server didn't answer in time"),
    });
    const failed = find(wrapper, "failed");
    expect(failed.classes()).toEqual(
      expect.arrayContaining(["h-30", "bg-banner-error-soft-bg", "text-banner-error-soft-text"]),
    );
    expect(failed.text()).toContain("Couldn't load this chart from app_traces");
    expect(failed.text()).toContain("the server didn't answer in time");
    expect(failed.classes()).not.toContain("text-status-warning-text");
    await failed.find("button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("shows a denial in red with the missing permission, and no Retry", () => {
    const wrapper = mountLive({
      status: "denied",
      reason: raw("You can't view app_traces"),
      detail: raw("Your role is missing the Get permission on app_traces."),
    });
    const denied = find(wrapper, "denied");
    expect(denied.classes()).toEqual(
      expect.arrayContaining(["h-30", "bg-banner-error-soft-bg", "text-banner-error-soft-text"]),
    );
    expect(denied.text()).toContain("You can't view app_traces");
    expect(denied.text()).toContain("Your role is missing the Get permission on app_traces.");
    expect(denied.find("button").exists()).toBe(false);
    expect(find(wrapper, "failed").exists()).toBe(false);
    expect(find(wrapper, "value").exists()).toBe(false);
  });

  it("shows a dash and no change, never an older value, when the newest bucket has nothing", () => {
    const wrapper = mountLive({
      series: {
        ...SERIES,
        points: [
          [0, 120],
          [1, null],
        ],
        current: null,
        previous: 120,
      },
    });
    expect(find(wrapper, "value").text()).toBe("\u2014");
    expect(find(wrapper, "delta").exists()).toBe(false);
    const noStart = mountLive({
      series: {
        ...SERIES,
        points: [
          [0, null],
          [1, 90],
        ],
        current: 90,
        previous: null,
      },
    });
    expect(find(noStart, "value").text()).toBe("90 ms");
    expect(find(noStart, "delta").exists()).toBe(false);
  });

  it("states the reason in place of the chart, at the chart's height", () => {
    const wrapper = mountLive({
      status: "noField",
      noData: true,
      reason: raw("No duration field in ingest_b"),
    });
    const box = find(wrapper, "nodata");
    expect(box.text()).toBe("No duration field in ingest_b");
    expect(box.classes()).toContain("h-30");
    expect(box.classes()).not.toContain("text-status-warning-text");
    expect(wrapper.text()).not.toContain("Chart not available yet");
  });

  it("charts a live gap's data, keeping the gap word on the badge", () => {
    const wrapper = mountLive({ cell: gapCell("none") });
    expect(find(wrapper, "gap").exists()).toBe(false);
    expect(find(wrapper, "value").text()).toBe("120 ms");
    expect(badge(wrapper)).toBe("Coverage gap");
  });

  it("captions partial data and a stream shared with other services", () => {
    const wrapper = mountLive({ partial: true, wide: true });
    expect(find(wrapper, "partial").text()).toBe("Partial data");
    expect(find(wrapper, "wide").attributes("aria-label")).toBe(
      "Includes other services that share this stream",
    );
    expect(find(mountLive({}), "partial").exists()).toBe(false);
  });

  it("captions a partial response that found nothing", () => {
    const wrapper = mountLive({
      status: "empty",
      noData: true,
      partial: true,
      reason: raw("No data from svc-b in the searched part of the last 24 h"),
    });
    expect(find(wrapper, "partial").text()).toBe("Partial data");
    expect(find(wrapper, "nodata").text()).toBe(
      "No data from svc-b in the searched part of the last 24 h",
    );
  });
});

describe("CoverageMetricChart axis and labels (T5-N10, T5-25)", () => {
  const options = (def: MetricDef) => {
    const wrapper = mount(CoverageMetricChart, {
      props: {
        def,
        series: { ...SERIES, points: [[0, 0.05]], current: 0.05 },
        cell: {
          state: "watched",
          engine: { state: raw("covered"), stateKey: "covered", monitors: [] },
        },
        range: "24h",
        start: 0,
        end: 1,
        expanded: false,
        readyOn: null,
        status: "ready",
      },
      global: { plugins: [i18n, store] },
    });
    return wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;
  };

  it("never repeats a y-axis label for small rates", () => {
    const format = options(DEF).yAxis.axisLabel.formatter;
    const ticks = [0, 0.02, 0.04, 0.06, 0.08].map(format);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(format(1500)).toBe("1.5K");
  });

  it("draws Now and the threshold label on a backing, at opposite ends", () => {
    const opts = options({ ...DEF, threshold: 34 });
    const now = opts.series.at(-1).label;
    expect(now.backgroundColor).toBeTruthy();
    const line = opts.series[0].markLine.label;
    expect(line.backgroundColor).toBeTruthy();
    expect(line.position).toBe("insideStartTop");
  });
});
