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
  default: { name: "ChartRenderer", template: "<div />" },
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
  it("names a live gap by its cell word, never 'Not watched'", () => {
    const missing = mountChart(gapCell("none"), true);
    expect(badge(missing)).toBe("No monitor");
    expect(missing.text()).not.toContain("Not watched");
    expect(missing.find('[data-test="autoobserve-coverage-chart-gap-latency"]').exists()).toBe(
      false,
    );
    expect(missing.find('[data-test="autoobserve-coverage-chart-nodata-latency"]').exists()).toBe(
      true,
    );
    expect(badge(mountChart(gapCell("silent"), true))).toBe("Silent");
  });

  it("keeps 'Not watched' outside live mode", () => {
    const wrapper = mountChart({ state: "gap" }, false);
    expect(badge(wrapper)).toBe("Not watched");
    expect(wrapper.find('[data-test="autoobserve-coverage-chart-gap-latency"]').text()).toBe(
      "Not watched",
    );
  });
});
