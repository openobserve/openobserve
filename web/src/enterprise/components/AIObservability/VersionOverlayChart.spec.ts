// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildOverlayOptions } from "./VersionOverlayChart.vue";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        return typeof msg === "string" ? msg : key;
      },
    })),
  };
});

const seriesA = [
  { x: 0, y: 10 },
  { x: 1, y: 12 },
];
const seriesB = [
  { x: 0, y: 20 },
  { x: 1, y: 18 },
];

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

describe("service-version identity", () => {
  it("labels the y axis through the caller formatter and draws the deploy marker", async () => {
    const { default: Chart } = await import("./VersionOverlayChart.vue");
    const wrapper = mount(Chart, {
      props: {
        seriesA,
        seriesB,
        mode: "sameWallClock",
        serviceVersions: true,
        formatY: (value: number) => `${value} u`,
        marker: { x: seriesA[0].x, label: "v2" },
      },
      global: { stubs: { PanelSchemaRenderer: true } },
    });
    expect(wrapper.text()).toContain(" u");
    expect(wrapper.find('[data-test="svcver-overlay-marker"]').text()).toBe("v2");
    const label = wrapper.findAll("text").find((node) => node.text().endsWith(" u"))!;
    expect(Number(label.attributes("x"))).toBeGreaterThanOrEqual(48);
    const grid = wrapper.find("line");
    expect(Number(grid.attributes("x1"))).toBeGreaterThan(Number(label.attributes("x")));
  });
  it("starts a new path segment only at a point flagged as following a gap", async () => {
    const { default: Chart } = await import("./VersionOverlayChart.vue");
    const path = (points: { x: number; y: number; gapBefore?: boolean }[]) =>
      mount(Chart, {
        props: { seriesA: points, seriesB, mode: "sameWallClock", serviceVersions: true },
        global: { stubs: { PanelSchemaRenderer: true } },
      })
        .get('[data-test="svcver-overlay-line-a"]')
        .attributes("d")!;
    const three = [
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: 11 },
    ];
    expect(path(three).match(/M/g)).toHaveLength(1);
    expect(path([three[0], { ...three[2], gapBefore: true }]).match(/M/g)).toHaveLength(2);
  });
});
