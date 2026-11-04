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
import useChartZoom, {
  CHART_ZOOM_MAX,
  CHART_ZOOM_MIN,
  CHART_ZOOM_STEP,
  panRange,
  zoomRange,
} from "@/composables/traces/useChartZoom";

const fakeChart = (initialZoom?: number) => {
  let zoom = initialZoom;
  const calls: any[] = [];
  return {
    calls,
    chart: {
      getOption: () => ({ series: [zoom === undefined ? {} : { zoom }] }),
      setOption: (opt: any, flags: any) => {
        calls.push({ opt, flags });
        zoom = opt.series[0].zoom;
      },
    },
  };
};

describe("useChartZoom", () => {
  it("steps the series zoom by 1.25 from the chart's live level", () => {
    const { chart, calls } = fakeChart(2);
    const { zoomIn, zoomOut } = useChartZoom(() => chart);

    zoomIn();
    expect(calls[0].opt.series[0].zoom).toBeCloseTo(2 * CHART_ZOOM_STEP);
    expect(calls[0].flags).toEqual({ lazyUpdate: true });

    zoomOut();
    expect(calls[1].opt.series[0].zoom).toBeCloseTo(2);
  });

  it("treats a missing zoom as 1", () => {
    const { chart, calls } = fakeChart();
    useChartZoom(() => chart).zoomIn();
    expect(calls[0].opt.series[0].zoom).toBeCloseTo(CHART_ZOOM_STEP);
  });

  it("clamps the zoom to the min and max", () => {
    const { chart, calls } = fakeChart(1);
    const { zoomIn, zoomOut } = useChartZoom(() => chart);

    for (let i = 0; i < 30; i++) zoomIn();
    expect(calls.at(-1).opt.series[0].zoom).toBe(CHART_ZOOM_MAX);

    for (let i = 0; i < 30; i++) zoomOut();
    expect(calls.at(-1).opt.series[0].zoom).toBe(CHART_ZOOM_MIN);
  });

  it("does nothing without a chart", () => {
    const { zoomIn, zoomOut } = useChartZoom(() => undefined);
    expect(() => {
      zoomIn();
      zoomOut();
    }).not.toThrow();
  });

  it("fit runs the callback then bumps the chart key", () => {
    const onBeforeFit = vi.fn();
    const { chartKey, fitToScreen } = useChartZoom(() => null, onBeforeFit);

    fitToScreen();
    expect(onBeforeFit).toHaveBeenCalledTimes(1);
    expect(chartKey.value).toBe(1);
  });
});

describe("zoomRange", () => {
  const bounds = { min: 0, max: 100 };

  it("narrows and widens around the centre", () => {
    expect(zoomRange({ min: 0, max: 100 }, 1.25, bounds, 1)).toEqual({ min: 10, max: 90 });
    const widened = zoomRange({ min: 10, max: 90 }, 1 / 1.25, bounds, 1);
    expect(widened.min).toBeCloseTo(0);
    expect(widened.max).toBeCloseTo(100);
  });

  it("never narrows below the minimum span", () => {
    let range = { min: 0, max: 100 };
    for (let i = 0; i < 50; i++) range = zoomRange(range, 1.25, bounds, 1);
    expect(range.max - range.min).toBeCloseTo(1);
    expect(range.min).toBeCloseTo(49.5);
  });

  it("never widens past the bounds and shifts back inside them", () => {
    expect(zoomRange({ min: 0, max: 100 }, 1 / 1.25, bounds, 1)).toEqual({ min: 0, max: 100 });
    const shifted = zoomRange({ min: 80, max: 100 }, 1 / 1.25, bounds, 1);
    expect(shifted.max).toBeCloseTo(100);
    expect(shifted.max - shifted.min).toBeCloseTo(25);
  });
});

describe("panRange", () => {
  const bounds = { min: 0, max: 100 };

  it("shifts the window by the delta and keeps its width", () => {
    expect(panRange({ min: 10, max: 30 }, 15, bounds)).toEqual({ min: 25, max: 45 });
    expect(panRange({ min: 10, max: 30 }, -5, bounds)).toEqual({ min: 5, max: 25 });
  });

  it("stops at the bounds", () => {
    expect(panRange({ min: 10, max: 30 }, -50, bounds)).toEqual({ min: 0, max: 20 });
    expect(panRange({ min: 10, max: 30 }, 500, bounds)).toEqual({ min: 80, max: 100 });
  });
});
