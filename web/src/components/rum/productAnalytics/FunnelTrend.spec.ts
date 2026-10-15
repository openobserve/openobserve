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

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import FunnelTrend from "./FunnelTrend.vue";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw } from "@/types/i18n";
import {
  alignPrevious,
  foldTrend,
  trendPeriods,
  type TrendContext,
  type TrendPeriods,
} from "@/utils/rum/funnelTrend";

const HOUR = 3_600_000_000;
const DAY = 24 * HOUR;
const D8 = Date.UTC(2026, 9, 8) * 1000;
const NOW = D8 + 7 * DAY + 10 * HOUR;
const store = createStore({ state: { theme: "light", timezone: "UTC" } });

const periodsOf = (days: number, start = D8): TrendPeriods => {
  const p = trendPeriods({ startUs: start, endUs: start + days * DAY }, "UTC", NOW, "day");
  if (!("boundariesUs" in p)) throw new Error("expected periods");
  return p;
};
const ctx: TrendContext = {
  range: { startUs: D8, endUs: D8 + 8 * DAY },
  nowUs: NOW,
  dataStartUs: null,
  dataThroughUs: null,
  windowUs: null,
};
const state = (patch: Partial<PanelState<unknown>> = {}): PanelState<unknown> => ({
  status: "ok",
  rows: [],
  error: null,
  partial: null,
  key: "k",
  sampled: 1,
  ...patch,
});
const rows = [
  { bk: 1, ca: 5, cb: 1 },
  { bk: 3, ca: 7, cb: 4 },
  { bk: 5, ca: 52, cb: 21 },
  { bk: 7, ca: 11, cb: 4 },
];

type ChartStub = { props: (k: string) => { options: Record<string, any> } };

const mountTrend = async (props: Record<string, unknown> = {}) => {
  const periods = (props.periods as TrendPeriods | undefined) ?? periodsOf(8);
  const w = mount(FunnelTrend, {
    props: {
      state: state(),
      series: foldTrend(rows, periods, ctx, false),
      periods,
      pair: { a: 1, b: 6 },
      pairLabel: raw("Step 1 → Step 6"),
      timezone: "UTC",
      range: "8–15 Oct",
      unitNoun: raw("sessions"),
      ...props,
    },
    global: {
      plugins: [store],
      stubs: {
        ChartRenderer: {
          name: "ChartRenderer",
          props: ["data"],
          template: "<div data-test='chart-stub' />",
        },
      },
    },
  });
  await flushPromises();
  return w;
};

const cell = (w: Awaited<ReturnType<typeof mountTrend>>, dt: string) =>
  w.find(`[data-test="rum-analytics-funnel-trend-row-${dt}"]`);

describe("FunnelTrend (P0-9)", () => {
  it("shows a skeleton while the trend runs and an error with retry when it fails", async () => {
    const loading = await mountTrend({ state: state({ status: "loading" }), series: [] });
    expect(loading.find('[data-test="rum-analytics-funnel-trend-loading"]').exists()).toBe(true);
    expect(loading.find('[data-test="chart-stub"]').exists()).toBe(false);
    const failed = await mountTrend({
      state: state({ status: "error", error: { message: "boom" } }),
      series: [],
    });
    await failed.find('[data-test="rum-analytics-funnel-trend-retry-btn"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("says why when the range cannot make a trend", async () => {
    const w = await mountTrend({ issue: "tooShort" });
    expect(w.find('[data-test="rum-analytics-funnel-trend-range-issue"]').text()).toContain(
      "at least 2 days",
    );
  });

  it("an empty range says no sessions instead of drawing zeros", async () => {
    const w = await mountTrend({ series: foldTrend([], periodsOf(8), ctx, false) });
    expect(w.find('[data-test="rum-analytics-funnel-trend-empty"]').text()).toContain(
      "No sessions in this range",
    );
    expect(w.find('[data-test="chart-stub"]').exists()).toBe(false);
  });

  it("lists every day with gaps in words, still-converting and low-volume tags, and the zone", async () => {
    const w = await mountTrend();
    expect(w.find('[data-test="rum-analytics-funnel-trend-caption"]').text()).toBe(
      "8–15 Oct · UTC",
    );
    const head = w.find('[data-test="rum-analytics-funnel-trend-table"] thead').text();
    for (const h of ["Day", "Entered step 1", "Reached step 6", "Conversion"])
      expect(head).toContain(h);
    expect(head).not.toContain("Previous period");
    expect(cell(w, "0-label").text()).toBe("8 Oct");
    expect(cell(w, "0-note").text()).toBe("No sessions");
    expect(cell(w, "5-rate").text()).toContain("40.4%");
    expect(cell(w, "1-low").exists()).toBe(true);
    expect(cell(w, "5-low").exists()).toBe(false);
    expect(cell(w, "7-still").text()).toBe("Still converting");
    expect(cell(w, "6-still").exists()).toBe(false);
  });

  it("draws gaps as banded nulls and today as a separate dashed, hollow point", async () => {
    const w = await mountTrend();
    const options = (w.findComponent({ name: "ChartRenderer" }) as unknown as ChartStub).props(
      "data",
    ).options;
    const [main, still] = options.series;
    expect(main.connectNulls).toBe(false);
    expect(main.data[0]).toEqual([0, null]);
    expect(main.data[7]).toEqual([7, null]);
    expect(main.markArea.data.map((a: { name: string }[]) => a[0].name)).toEqual([
      "No sessions",
      "No sessions",
      "No sessions",
      "No sessions",
    ]);
    expect(still.name).toBe("Still converting (today)");
    expect(still.lineStyle.type).toBe("dashed");
    expect(still.data[7]).toEqual({ value: [7, 36.4] });
    expect(still.data[6]).toBeNull();
    expect(options.yAxis).toMatchObject({ min: 0, max: 100, name: "Conversion (%)" });
  });

  it("with compare, adds the previous period as a dashed grey line and names each matching day", async () => {
    const periods = periodsOf(8);
    const [cur] = foldTrend(rows, periods, ctx, false);
    const prevPeriods = periodsOf(8, D8 - 8 * DAY);
    const [prev] = foldTrend([{ bk: 1, ca: 5, cb: 1 }], prevPeriods, ctx, false);
    const w = await mountTrend({
      previous: { status: "ok", buckets: alignPrevious(cur, prev), range: "30 Sep–7 Oct" },
    });
    expect(w.find('[data-test="rum-analytics-funnel-trend-table"] thead').text()).toContain(
      "Previous period, same day",
    );
    expect(cell(w, "0-previous").text()).toBe("30 Sep · no sessions");
    expect(cell(w, "1-previous").text()).toBe("1 Oct · 20.0%");
    const options = (w.findComponent({ name: "ChartRenderer" }) as unknown as ChartStub).props(
      "data",
    ).options;
    const last = options.series.at(-1);
    expect(last.name).toBe("30 Sep–7 Oct (previous)");
    expect(last.lineStyle.type).toBe("dashed");
    expect(options.series[0].name).toBe("8–15 Oct");
  });

  it("a breakdown gap band needs every value empty; one empty value is not a chart-wide gap", async () => {
    const periods = periodsOf(8);
    const hits = [
      { dim: "Chrome", un: 0, tot: 90, bk: 1, ca: 10, cb: 5 },
      { dim: "Safari", un: 0, tot: 40, bk: 1, ca: 4, cb: 2 },
      { dim: "Safari", un: 0, tot: 40, bk: 2, ca: 40, cb: 8 },
    ];
    const w = await mountTrend({
      breakdown: true,
      dimLabel: raw("Browser"),
      periods,
      series: foldTrend(hits, periods, ctx, true),
    });
    const options = (w.findComponent({ name: "ChartRenderer" }) as unknown as ChartStub).props(
      "data",
    ).options;
    const banded = options.series[0].markArea.data.map(
      (a: { xAxis: number }[]) => a[0].xAxis + 0.5,
    );
    expect(banded).not.toContain(1);
    expect(banded).not.toContain(2);
    expect(banded).toContain(0);
  });

  it("the pivot marks every still-converting day, as Users mode's window leaves several open", async () => {
    const periods = periodsOf(8);
    const hits = [{ dim: "Chrome", un: 0, tot: 9, bk: 1, ca: 10, cb: 5 }];
    const w = await mountTrend({
      breakdown: true,
      dimLabel: raw("Browser"),
      periods,
      series: foldTrend(hits, periods, { ...ctx, windowUs: DAY }, true),
      today: false,
    });
    const head = w.find('[data-test="rum-analytics-funnel-trend-table"] thead').text();
    expect(head).toContain("14 Oct · Still converting");
    expect(head).toContain("15 Oct · Still converting");
    expect(head).not.toContain("13 Oct · Still converting");
  });

  it("a breakdown pivots value × day up to 8 days, and past that shows averages without today", async () => {
    const hits = [
      { dim: "Chrome", un: 0, bk: 1, ca: 10, cb: 5 },
      { dim: "Chrome", un: 0, bk: 7, ca: 4, cb: 0 },
      { dim: "Firefox", un: 0, bk: 1, ca: 4, cb: 4 },
    ];
    const short = periodsOf(8);
    const pivot = await mountTrend({
      breakdown: true,
      dimLabel: raw("Browser"),
      periods: short,
      series: foldTrend(hits, short, ctx, true),
    });
    const head = pivot.find('[data-test="rum-analytics-funnel-trend-table"] thead').text();
    expect(head).toContain("Browser");
    expect(head).toContain("15 Oct · Still converting (today)");
    expect(cell(pivot, "v0-b1").text()).toBe("50.0%");
    expect(cell(pivot, "v0-b0").text()).toBe("—");
    const long = periodsOf(10, D8 - 2 * DAY);
    const avg = await mountTrend({
      breakdown: true,
      dimLabel: raw("Browser"),
      periods: long,
      series: foldTrend(
        hits.map((h) => ({ ...h, bk: h.bk + 2 })),
        long,
        { ...ctx, range: { startUs: D8 - 2 * DAY, endUs: D8 + 8 * DAY } },
        true,
      ),
    });
    const avgHead = avg.find('[data-test="rum-analytics-funnel-trend-table"] thead').text();
    expect(avgHead).toContain("Average conversion");
    expect(cell(avg, "v0-label").text()).toBe("Chrome");
    expect(cell(avg, "v0-rate").text()).toContain("50.0%");
  });
});
