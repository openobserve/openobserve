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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createTrellisHelpers,
} from "@/utils/dashboard/sql/shared/trellisConfig";
import { getTrellisGrid } from "@/utils/dashboard/calculateGridForSubPlot";

vi.mock("@/utils/dashboard/chartDimensionUtils", () => ({
  calculateWidthText: vi.fn(() => 60),
  calculateDynamicNameGap: vi.fn(() => 25),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => ({ value: String(v ?? ""), unit: "" })),
}));

vi.mock("@/utils/dashboard/calculateGridForSubPlot", () => ({
  getTrellisGrid: vi.fn(() => ({
    gridArray: [{ left: "5%", top: "5%", width: "90%", height: "40%" }],
    gridWidth: 800,
    gridHeight: 200,
    gridNoOfCol: 1,
    panelHeight: 400,
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  deepCopy: vi.fn((v) => JSON.parse(JSON.stringify(v))),
}));

function makeDeps(overrides: Partial<any> = {}): any {
  return {
    options: {
      xAxis: [
        {
          data: ["Jan", "Feb"],
          axisLabel: { rotate: 0, width: 120 },
          axisTick: { length: 5 },
          nameGap: 25,
          name: "",
          nameTextStyle: { fontSize: 12 },
        },
      ],
      // yAxis is a single object (not array) before trellis is applied;
      // updateTrellisConfig wraps it: options.yAxis = [options.yAxis]
      yAxis: {
        data: [],
        axisLabel: { width: 80 },
        nameGap: 25,
        name: "",
        nameTextStyle: { fontSize: 12 },
      },
      series: [{ name: "s1", data: [1, 2] }],
      grid: {},
      legend: { show: true },
    },
    panelSchema: {
      type: "bar",
      config: {
        unit: "default",
        unit_custom: "",
        decimals: 2,
        trellis: { layout: null },
      },
    },
    chartPanelRef: { value: { offsetWidth: 800, offsetHeight: 400 } },
    chartPanelStyle: {},
    yAxisKeys: ["y1"],
    xAxisKeys: ["x1"],
    isHorizontalChart: false,
    convertedTimeStampToDataFormat: "",
    defaultGrid: { containLabel: true },
    getAxisDataFromKey: vi.fn((key: string) => {
      if (key === "y1") return [10, 20, 30];
      return ["Jan", "Feb"];
    }),
    getAnnotationMarkLine: vi.fn(() => null),
    getSeriesMarkArea: vi.fn(() => null),
    largestLabel: vi.fn((data: any) => data?.[0] ?? ""),
    ...overrides,
  };
}

describe("createTrellisHelpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getTrellisGrid to default mock
    vi.mocked(getTrellisGrid).mockReturnValue({
      gridArray: [{ left: "5%", top: "5%", width: "90%", height: "40%" }],
      gridWidth: 800,
      gridHeight: 200,
      gridNoOfCol: 1,
      panelHeight: 400,
    } as any);
  });

  it("createTrellisHelpers returns updateTrellisConfig function", () => {
    const deps = makeDeps();
    const helpers = createTrellisHelpers(deps);
    expect(typeof helpers.updateTrellisConfig).toBe("function");
  });

  it("updateTrellisConfig does nothing when series array is empty", () => {
    const deps = makeDeps({
      options: {
        xAxis: [
          {
            data: ["Jan", "Feb"],
            axisLabel: { rotate: 0, width: 120 },
            axisTick: { length: 5 },
            nameGap: 25,
            name: "",
            nameTextStyle: { fontSize: 12 },
          },
        ],
        yAxis: {
          data: [],
          axisLabel: { width: 80 },
          nameGap: 25,
          name: "",
          nameTextStyle: { fontSize: 12 },
        },
        series: [],
        grid: {},
        legend: { show: true },
      },
    });
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    // Should return early without modifying grid when series is empty
    const originalGrid = deps.options.grid;
    updateTrellisConfig();
    expect(deps.options.grid).toBe(originalGrid);
    expect(getTrellisGrid).not.toHaveBeenCalled();
  });

  it("updateTrellisConfig does not throw when series is populated", () => {
    const deps = makeDeps();
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    expect(() => updateTrellisConfig()).not.toThrow();
  });

  it("updateTrellisConfig sets options.grid to gridArray from getTrellisGrid", () => {
    const expectedGridArray = [
      { left: "5%", top: "5%", width: "90%", height: "40%" },
    ];
    vi.mocked(getTrellisGrid).mockReturnValue({
      gridArray: expectedGridArray,
      gridWidth: 800,
      gridHeight: 200,
      gridNoOfCol: 1,
      panelHeight: 400,
    } as any);

    const deps = makeDeps();
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    updateTrellisConfig();
    expect(deps.options.grid).toBe(expectedGridArray);
  });

  it("updateTrellisConfig calls getTrellisGrid with panel dimensions", () => {
    const deps = makeDeps();
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    updateTrellisConfig();
    expect(getTrellisGrid).toHaveBeenCalledWith(
      800, // offsetWidth
      400, // offsetHeight
      expect.any(Number), // series count
      expect.any(Number), // yAxisNameGap
      expect.any(Number), // customCols
      undefined, // axis_width
    );
  });

  it("updateTrellisConfig uses vertical layout (1 column) when trellis.layout is vertical", () => {
    const deps = makeDeps({
      panelSchema: {
        type: "bar",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          trellis: { layout: "vertical" },
        },
      },
    });
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    updateTrellisConfig();
    // customCols should be 1 for vertical layout
    expect(getTrellisGrid).toHaveBeenCalledWith(
      800,
      400,
      expect.any(Number),
      expect.any(Number),
      1, // customCols = 1 for vertical
      undefined,
    );
  });

  it("updateTrellisConfig uses custom columns when layout is custom and num_of_columns is set", () => {
    const deps = makeDeps({
      panelSchema: {
        type: "bar",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          trellis: { layout: "custom", num_of_columns: 3 },
        },
      },
    });
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    updateTrellisConfig();
    expect(getTrellisGrid).toHaveBeenCalledWith(
      800,
      400,
      expect.any(Number),
      expect.any(Number),
      3, // customCols = 3
      undefined,
    );
  });

  it("updateTrellisConfig throws when chartPanelRef.value is null", () => {
    const deps = makeDeps({
      chartPanelRef: { value: null },
    });
    const { updateTrellisConfig } = createTrellisHelpers(deps);
    // The function catches internally and falls back - chartPanelRef.value being null
    // triggers a throw inside the try block, which is caught internally.
    // The catch block tries to access chartPanelRef.value.offsetHeight which will throw again.
    // So this should not throw to the caller if caught, but fallback grid is set.
    // From reading the source: catch block does: chartPanelStyle.height = chartPanelRef.value.offsetHeight + "px"
    // which will throw again when chartPanelRef.value is null.
    // That secondary throw is NOT caught, so it propagates to the caller.
    expect(() => updateTrellisConfig()).toThrow();
  });
});
