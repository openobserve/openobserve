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
import { formatAxisTickValue } from "./axisTickFormat";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { buildValueAxis, buildYAxis } from "./promql/shared/axisBuilder";
import { convertPromQLData } from "./convertPromQLData";

const ticks = (values: number[], unit: string, decimals?: number) =>
  values.map((v) => formatAxisTickValue(v, unit, "", decimals));

describe("formatAxisTickValue", () => {
  it("raises precision when rounding would make adjacent ticks collide", () => {
    expect(ticks([500, 1000, 1500, 2000], "milliseconds", 0)).toEqual([
      "500ms",
      "1s",
      "1.5s",
      "2s",
    ]);
    expect(ticks([0, 0.25, 0.5, 0.75, 1], "", 0)).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
  });

  it("keeps the configured decimals whenever rounding is exact", () => {
    const cases: [number, string, number | undefined][] = [
      [1000, "milliseconds", 0],
      [1500, "milliseconds", 2],
      [2048, "bytes", 0],
      [40, "percent", 0],
      [12, "celsius", 1],
      [3, "", undefined],
      [1234, "currency-dollar", 0],
    ];
    for (const [value, unit, decimals] of cases) {
      expect(formatAxisTickValue(value, unit, "", decimals)).toBe(
        formatUnitValue(getUnitValue(value, unit, "", decimals ?? 2)),
      );
    }
  });

  it("caps the extra precision at three decimals", () => {
    expect(formatAxisTickValue(1 / 3, "", "", 0)).toBe("0.333");
  });

  it("leaves text units alone", () => {
    expect(formatAxisTickValue(true, "boolean", "", 0)).toBe(
      formatUnitValue(getUnitValue(true, "boolean", "", 0)),
    );
  });
});

describe("value axes use it", () => {
  const panel = {
    type: "line",
    queries: [{ fields: { y: [] } }],
    config: { unit: "milliseconds", decimals: 0 },
  };

  it("PromQL y axis and value axis", () => {
    expect(buildYAxis(panel, 0, { state: { theme: "light" } }).axisLabel.formatter(1500)).toBe(
      "1.5s",
    );
    expect(buildValueAxis(panel, { state: { theme: "light" } }).axisLabel.formatter(1500)).toBe(
      "1.5s",
    );
  });

  it("PromQL line through the real converter", async () => {
    const promPanel = {
      id: "p",
      type: "line",
      queryType: "promql",
      queries: [
        {
          query: "up",
          customQuery: true,
          fields: { stream: "up", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
          config: { promql_legend: "" },
        },
      ],
      config: { show_legends: true, unit: "milliseconds", decimals: 0 },
    };
    const data = [
      {
        resultType: "matrix",
        result: [
          {
            metric: { job: "a" },
            values: [
              [1704067200, "500"],
              [1704067800, "1500"],
            ],
          },
        ],
      },
    ];
    const result: any = await convertPromQLData(
      promPanel,
      data,
      {
        state: {
          theme: "light",
          timezone: "UTC",
          zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
          selectedOrganization: { identifier: "default" },
        },
      },
      { value: { offsetWidth: 800, offsetHeight: 400 } },
      { value: null },
      { value: [] },
      null,
      [],
      false,
    );
    const yAxis = [result.options.yAxis].flat()[0];
    expect([1000, 1500].map((v) => yAxis.axisLabel.formatter(v))).toEqual(["1s", "1.5s"]);
  });
});
