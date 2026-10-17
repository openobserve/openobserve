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
import { buildTrendsChartOption, entitySeriesColors, shadeOf } from "./usageCharts";

describe("usageCharts", () => {
  it("keeps the base colour for the top entity and lightens the ones below it", () => {
    expect(shadeOf("#000000", 0, "#ffffff")).toBe("#000000");
    expect(shadeOf("#000000", 1, "#ffffff")).toBe("#2b2b2b");
    expect(shadeOf("#000000", 10, "#ffffff")).toBe("#d9d9d9");
    expect(shadeOf("#ffffff", 5, "#000000")).toBe("#262626");
  });

  it("leaves a colour it cannot parse untouched", () => {
    expect(shadeOf("rgb(1, 2, 3)", 2, "#ffffff")).toBe("rgb(1, 2, 3)");
  });

  it("maps each entity by name and gives the remainder its own colour", () => {
    const colors = entitySeriesColors("ingestion", ["a", "b"], "Other");
    expect(colors.map((entry) => entry.value)).toEqual(["a", "b", "Other"]);
    expect(colors[2].color).not.toBe(colors[0].color);
  });

  it("draws spend to date and a forecast that ends on the projected total", () => {
    const day = 86_400;
    const option = buildTrendsChartOption({
      rows: [0, 1, 2].map((d) => ({ ts: d * day, event: "Ingestion", cost: 10 })),
      events: ["Ingestion"],
      start: 0,
      end: 5 * day,
      bucket: day,
      now: 2 * day + 60,
      forecast: { pace: 10, paceDays: 3, projected: 50, low: 40, high: 60 },
      meterLabel: (key) => key,
      money: (v) => `$${v}`,
      slotLabel: (ts) => String(ts / day),
      labels: { spendToDate: "spend", forecast: "fc", dayTotal: "total", projected: "proj" },
    });
    const byName = (name: string) => option.series.find((s: any) => s.name === name) as any;
    expect(byName("ingestion").data).toEqual([10, 10, 10, null, null]);
    expect(byName("spend").data).toEqual([10, 20, 30, null, null]);
    expect(byName("fc").data).toEqual([null, null, 30, 40, 50]);
    expect(byName("fc").endLabel.formatter).toBe("proj $50");
  });

  it("leaves the forecast out when there is none", () => {
    const option = buildTrendsChartOption({
      rows: [],
      events: ["Ingestion"],
      start: 0,
      end: 86_400 * 3,
      bucket: 86_400,
      now: 1,
      forecast: null,
      meterLabel: (k) => k,
      money: String,
      slotLabel: String,
      labels: { spendToDate: "s", forecast: "f", dayTotal: "t", projected: "p" },
    });
    expect(option.series.map((s: any) => s.name)).toEqual(["ingestion"]);
  });
});
