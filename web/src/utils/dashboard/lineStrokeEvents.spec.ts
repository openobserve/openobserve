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

import { afterEach, describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { isLineStrokeEvent, withLineStrokeEvents } from "./lineSeriesAtPoint";

// Real ECharts with the SVG renderer: hit-testing is zrender's path math, so jsdom can drive it.
const WIDTH = 400;
const HEIGHT = 300;
const EVENTS = ["click", "mouseover", "mouseout", "mousemove", "contextmenu"];
const TOOLTIP_EVENTS = ["showtip", "hidetip", "highlight", "downplay"];

interface Recorded {
  name: string;
  selfType?: string;
  seriesIndex?: number;
  dataIndex?: number;
}

let charts: echarts.ECharts[] = [];

const render = (series: Record<string, unknown>[], trigger: string, on: boolean) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const chart = echarts.init(el, null, { renderer: "svg", width: WIDTH, height: HEIGHT });
  charts.push(chart);
  chart.setOption(
    withLineStrokeEvents(
      {
        animation: false,
        grid: { left: 0, right: 0, top: 0, bottom: 0 },
        xAxis: { type: "value", min: 0, max: 4 },
        yAxis: { type: "value", min: 0, max: 20 },
        tooltip: { trigger, showDelay: 0, hideDelay: 0, transitionDuration: 0 },
        series,
      },
      on,
    ),
  );
  const recorded: Recorded[] = [];
  for (const name of [...EVENTS, ...TOOLTIP_EVENTS]) {
    chart.on(name, (params: unknown) => {
      const p = params as Omit<Recorded, "name">;
      recorded.push({
        name,
        selfType: p.selfType,
        seriesIndex: p.seriesIndex,
        dataIndex: p.dataIndex,
      });
    });
  }
  const pointer = (type: string, [zrX, zrY]: number[]) =>
    chart.getZr().handler.dispatch(type, {
      zrX,
      zrY,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });
  const gesture = (at: number[]) => {
    for (const type of ["mousemove", "mousedown", "mouseup", "click", "contextmenu"]) {
      pointer(type, at);
    }
  };
  return { chart, recorded, gesture };
};

/** The pixel where a vertical line at data x crosses the drawn stroke of a series. */
const strokeAt = (series: Record<string, unknown>[], seriesIndex: number, x: number) => {
  const { chart, recorded, gesture } = render(series, "item", true);
  const column = chart.convertToPixel({ xAxisIndex: 0 }, x) as number;
  for (let y = 0; y < HEIGHT; y++) {
    recorded.length = 0;
    gesture([column, y]);
    const hit = recorded.find((event) => event.name === "contextmenu");
    if (hit && hit.seriesIndex === seriesIndex) return [column, y];
  }
  return null;
};

afterEach(() => {
  charts.forEach((chart) => chart.dispose());
  charts = [];
});

describe("a line's drawn stroke as a right-click target", () => {
  const smooth = [
    {
      type: "line",
      smooth: true,
      showSymbol: false,
      data: [
        [0, 1],
        [1, 9],
        [2, 8],
        [3, 1],
      ],
    },
  ];
  const step = [
    {
      type: "line",
      step: "end",
      showSymbol: false,
      data: [
        [0, 2],
        [1, 9],
        [2, 2],
      ],
    },
  ];
  const stacked = [
    {
      type: "line",
      stack: "s",
      showSymbol: false,
      data: [
        [0, 2],
        [1, 2],
        [2, 2],
      ],
    },
    {
      type: "line",
      stack: "s",
      showSymbol: false,
      data: [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
    },
  ];

  it.each([
    ["smooth", smooth, 0, 1.5],
    ["step", step, 0, 0.5],
    ["stacked", stacked, 1, 0.5],
  ])("names a %s line between its points", (_shape, series, seriesIndex, x) => {
    const at = strokeAt(series, seriesIndex, x);
    expect(at).not.toBeNull();

    const { recorded, gesture } = render(series, "item", true);
    gesture(at as number[]);
    const hit = recorded.find((event) => event.name === "contextmenu");
    expect(isLineStrokeEvent({ ...hit, seriesIndex: hit?.seriesIndex })).toBe(true);
    expect(hit?.seriesIndex).toBe(seriesIndex);
  });

  it("names the upper of two stacked lines at its drawn height, not its own values", () => {
    const { chart, recorded, gesture } = render(stacked, "item", true);
    const column = chart.convertToPixel({ xAxisIndex: 0 }, 0.5) as number;
    const lineAt = (value: number) => {
      recorded.length = 0;
      gesture([column, chart.convertToPixel({ yAxisIndex: 0 }, value) as number]);
      return recorded.find((event) => event.name === "contextmenu")?.seriesIndex;
    };

    expect(lineAt(2 + 3)).toBe(1);
    expect(lineAt(3)).not.toBe(1);
  });

  it("names a step-after line on its riser, and none at the diagonal midpoint its path never crosses", () => {
    const { chart, recorded, gesture } = render(step, "item", true);
    const lineAt = (x: number, value: number) => {
      recorded.length = 0;
      gesture([
        chart.convertToPixel({ xAxisIndex: 0 }, x) as number,
        chart.convertToPixel({ yAxisIndex: 0 }, value) as number,
      ]);
      return recorded.find((event) => event.name === "contextmenu")?.seriesIndex;
    };

    expect(lineAt(1, 5.5)).toBe(0);
    expect(lineAt(0.5, 2)).toBe(0);
    expect(lineAt(0.5, 5.5)).toBeUndefined();
  });

  it("stays silent on a stroke while the option is off", () => {
    const at = strokeAt(smooth, 0, 1.5) as number[];
    const { recorded, gesture } = render(smooth, "item", false);
    gesture(at);
    expect(recorded.filter((event) => EVENTS.includes(event.name))).toEqual([]);
  });

  it.each(["item", "axis"])(
    "leaves every other event, tooltip included (%s trigger), as it was",
    (trigger) => {
      const series = [{ ...smooth[0], showSymbol: true }];
      const at = strokeAt(smooth, 0, 1.5) as number[];
      const { chart } = render(series, trigger, false);
      const symbol = chart.convertToPixel({ seriesIndex: 0 }, [1, 9]) as number[];
      const path = [symbol, at, [20, HEIGHT - 5]];

      const off = render(series, trigger, false);
      const on = render(series, trigger, true);
      for (const point of path) {
        off.gesture(point);
        on.gesture(point);
      }

      const unchanged = on.recorded.filter((event) => !isLineStrokeEvent(event));
      expect(on.recorded.some((event) => isLineStrokeEvent(event))).toBe(true);
      expect(unchanged).toEqual(off.recorded);
    },
  );
});
