// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildOverlayOptions } from "./VersionOverlayChart.vue";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

describe("VersionOverlayChart elapsed-time coordinates", () => {
  it("draws a 0.11-day interval eleven times wider than a 0.01-day interval", () => {
    const chart = echarts.init(null, undefined, {
      renderer: "svg",
      ssr: true,
      width: 1200,
      height: 300,
    });
    try {
      chart.setOption(
        buildOverlayOptions(
          [
            { x: 1.12, y: 10 },
            { x: 1.13, y: 12 },
          ],
          [
            { x: 4.02, y: 20 },
            { x: 4.13, y: 18 },
          ],
          "1.0",
          "2.0",
          "Days since rollout",
        ),
      );
      const px = (x: number) => chart.convertToPixel({ xAxisIndex: 0 }, x) as number;
      const short = px(1.13) - px(1.12);
      const long = px(4.13) - px(4.02);
      expect(short).toBeGreaterThan(0);
      expect(long / short).toBeCloseTo(11, 8);
      // A shared elapsed time has one coordinate, regardless of version.
      expect(chart.convertToPixel({ seriesIndex: 0 }, [2, 10])[0]).toBeCloseTo(
        chart.convertToPixel({ seriesIndex: 1 }, [2, 20])[0],
        8,
      );
    } finally {
      chart.dispose();
    }
  });

  it("retains each arm's own x positions, including gaps and a shared origin, without mutating points", () => {
    const a = [
      { x: 3, y: 12 },
      { x: 0, y: 10 },
    ];
    const options = buildOverlayOptions(
      a,
      [
        { x: 0, y: 20 },
        { x: 0.5, y: 18 },
      ],
      "1.0",
      "2.0",
      "Hours since rollout",
    );
    expect(options.series).toMatchObject([
      {
        name: "1.0",
        data: [
          [0, 10],
          [3, 12],
        ],
      },
      {
        name: "2.0",
        data: [
          [0, 20],
          [0.5, 18],
        ],
      },
    ]);
    expect(a).toEqual([
      { x: 3, y: 12 },
      { x: 0, y: 10 },
    ]);
  });
});
