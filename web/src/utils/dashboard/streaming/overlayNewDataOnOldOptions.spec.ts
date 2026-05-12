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

import { describe, it, expect } from "vitest";
import { overlayNewDataOnOldOptions } from "./overlayNewDataOnOldOptions";

// Helpers: timestamps in ms, boundary/query times in µs (function divides by 1000)
const ts = (min: number) => new Date(Date.UTC(2024, 0, 1, 0, min, 0)).getTime();
const tsDate = (min: number) => new Date(Date.UTC(2024, 0, 1, 0, min, 0));
const toMicro = (ms: number) => ms * 1000;
const INTERVAL_MS = 60_000; // 1 minute
const toNum = (v: any): number =>
  typeof v === "number" ? v : v instanceof Date ? v.getTime() : new Date(v).getTime();

function makeSeries(
  name: string,
  data: [Date, number | null][],
  extra?: Record<string, any>,
) {
  return { name, data, type: "line", ...extra };
}

function makeOldSeries(
  name: string,
  data: [number, number | null][],
  extra?: Record<string, any>,
) {
  // Old options after JSON clone have numeric timestamps (or ISO strings)
  return { name, data, type: "line", ...extra };
}

function makeContainerSize(width = 800, height = 400) {
  return { width, height };
}

describe("overlayNewDataOnOldOptions", () => {
  describe("edge cases and fallbacks", () => {
    it("returns oldOptions when newOptions has no series", () => {
      const old = { series: [makeOldSeries("A", [[ts(0), 1]])] };
      const result = overlayNewDataOnOldOptions(old, { series: [] });
      expect(result).toBe(old);
    });

    it("returns oldOptions when newOptions series is undefined", () => {
      const old = { series: [makeOldSeries("A", [[ts(0), 1]])] };
      const result = overlayNewDataOnOldOptions(old, {});
      expect(result).toBe(old);
    });

    it("returns newOptions when oldOptions is null", () => {
      const newOpts = { series: [makeSeries("A", [[tsDate(0), 1]])] };
      const result = overlayNewDataOnOldOptions(null, newOpts);
      expect(result).toBe(newOpts);
    });

    it("returns newOptions when oldOptions has no series", () => {
      const newOpts = { series: [makeSeries("A", [[tsDate(0), 1]])] };
      const result = overlayNewDataOnOldOptions({ series: [] }, newOpts);
      expect(result).toBe(newOpts);
    });

    it("returns newOptions when both old and new are null", () => {
      const result = overlayNewDataOnOldOptions(null, null);
      expect(result).toBeNull();
    });
  });

  describe("first load (no old data) — phantom points", () => {
    it("adds phantom point before first data point (LTR)", () => {
      const newOpts = {
        series: [makeSeries("A", [[tsDate(5), 10], [tsDate(6), 20]])],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),  // queryStart
        toMicro(ts(10)), // queryEnd
        true,            // isLTR
        undefined,
        INTERVAL_MS,     // histogramIntervalMs
      );

      // Should have phantom at ts(4) prepended AND phantom at ts(7) appended
      // Original 2 + leading phantom + trailing phantom = 4
      expect(result.series[0].data.length).toBe(4);
      const phantomTs = result.series[0].data[0][0].getTime();
      expect(phantomTs).toBe(ts(4)); // 5min - 1min = 4min
      expect(result.series[0].data[0][1]).toBeNull();
    });

    it("adds phantom point after last data point (LTR)", () => {
      const newOpts = {
        series: [makeSeries("A", [[tsDate(5), 10], [tsDate(6), 20]])],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),  // queryStart
        toMicro(ts(10)), // queryEnd
        true,
        undefined,
        INTERVAL_MS,
      );

      // Should have phantom at ts(7) appended
      expect(result.series[0].data.length).toBe(4); // original 2 + 2 phantoms
      const lastIdx = result.series[0].data.length - 1;
      const phantomTs = result.series[0].data[lastIdx][0].getTime();
      expect(phantomTs).toBe(ts(7)); // 6min + 1min = 7min
      expect(result.series[0].data[lastIdx][1]).toBeNull();
    });

    it("does not add phantom before if it would be before queryStart", () => {
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),  // queryStart = same as first data point
        toMicro(ts(10)),
        true,
        undefined,
        INTERVAL_MS,
      );

      // Phantom at ts(-1) would be before queryStart — not added
      // Only trailing phantom added
      expect(result.series[0].data.length).toBe(2);
      expect(result.series[0].data[0][0].getTime()).toBe(ts(0));
    });

    it("does not add phantom after if it would be after queryEnd", () => {
      const newOpts = {
        series: [makeSeries("A", [[tsDate(10), 10]])],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),
        toMicro(ts(10)), // queryEnd = same as last data point
        true,
        undefined,
        INTERVAL_MS,
      );

      // Phantom at ts(11) would be after queryEnd — not added
      // Only leading phantom added
      expect(result.series[0].data.length).toBe(2);
      expect(result.series[0].data[1][0].getTime()).toBe(ts(10));
    });

    it("skips phantom for series with null name", () => {
      const newOpts = {
        series: [{ name: null, data: [[tsDate(5), 10]], type: "line" }],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),
        toMicro(ts(10)),
        true,
        undefined,
        INTERVAL_MS,
      );
      expect(result.series[0].data.length).toBe(1); // unchanged
    });

    it("skips phantom for series with non-array data points", () => {
      const newOpts = {
        series: [{ name: "A", data: [100, 200], type: "line" }],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),
        toMicro(ts(10)),
        true,
        undefined,
        INTERVAL_MS,
      );
      expect(result.series[0].data.length).toBe(2); // unchanged
    });

    it("skips phantom when histogramIntervalMs is 0", () => {
      const newOpts = {
        series: [makeSeries("A", [[tsDate(5), 10]])],
      };
      const result = overlayNewDataOnOldOptions(
        { series: [] },
        newOpts,
        undefined,
        undefined,
        toMicro(ts(0)),
        toMicro(ts(10)),
        true,
        undefined,
        0, // no interval
      );
      expect(result.series[0].data.length).toBe(1); // unchanged
    });
  });

  describe("LTR overlay — merge old data after new", () => {
    const queryStart = toMicro(ts(0));
    const queryEnd = toMicro(ts(10));
    const boundary = toMicro(ts(5));

    it("appends stale old data after new data's last timestamp", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [
            [ts(0), 1], [ts(1), 2], [ts(2), 3],
            [ts(6), 6], [ts(7), 7], [ts(8), 8],
          ]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [
            [tsDate(0), 10], [tsDate(1), 20], [tsDate(2), 30],
          ]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      // New data: ts(0..2) + phantom at ts(3) + old stale: ts(6), ts(7), ts(8)
      const seriesA = result.series[0];
      // New data preserved
      expect(seriesA.data[0][1]).toBe(10);
      expect(seriesA.data[1][1]).toBe(20);
      expect(seriesA.data[2][1]).toBe(30);
      // Stale old data appended
      const staleValues = seriesA.data
        .filter((p: any) => p[1] !== null && p[1] > 5)
        .filter((p: any) => typeof p[1] === "number" && p[1] !== 10 && p[1] !== 20 && p[1] !== 30);
      expect(staleValues.length).toBe(3);
    });

    it("inserts phantom point at lastNewTime + interval", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(3), 3], [ts(5), 5]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(0), 10], [tsDate(1), 20]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // Phantom at ts(2) = ts(1) + 60s. Old has no data at ts(2), so phantom value = null
      const phantom = seriesA.data.find(
        (p: any) => {
          const t = p[0] instanceof Date ? p[0].getTime() : p[0];
          return t === ts(2);
        },
      );
      expect(phantom).toBeDefined();
      expect(phantom[1]).toBeNull();
    });

    it("uses old data value for phantom when old has data at that timestamp", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(2), 99], [ts(5), 5]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(0), 10], [tsDate(1), 20]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // Phantom at ts(2) = ts(1) + 60s. Old has value 99 at ts(2)
      const phantom = seriesA.data.find(
        (p: any) => {
          const t = p[0] instanceof Date ? p[0].getTime() : p[0];
          return t === ts(2);
        },
      );
      expect(phantom).toBeDefined();
      expect(phantom[1]).toBe(99);
    });

    it("does not append old data beyond queryEnd", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(5), 5], [ts(11), 11]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(0), 10]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // ts(11) is beyond queryEnd — should not appear
      const beyondEnd = seriesA.data.find((p: any) => {
        const t = p[0] instanceof Date ? p[0].getTime() : p[0];
        return t === ts(11);
      });
      expect(beyondEnd).toBeUndefined();
    });
  });

  describe("RTL overlay — merge old data before new", () => {
    const queryStart = toMicro(ts(0));
    const queryEnd = toMicro(ts(10));
    const boundary = toMicro(ts(5));

    it("prepends stale old data before new data's first timestamp", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [
            [ts(0), 1], [ts(1), 2], [ts(2), 3],
            [ts(8), 8], [ts(9), 9],
          ]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [
            [tsDate(8), 80], [tsDate(9), 90], [tsDate(10), 100],
          ]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // Old stale data ts(0..2) should be prepended
      const staleValues = seriesA.data.filter((p: any) => {
        const val = p[1];
        return val === 1 || val === 2 || val === 3;
      });
      expect(staleValues.length).toBe(3);
    });

    it("inserts phantom point at firstNewTime - interval (RTL)", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(5), 5]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(8), 80], [tsDate(9), 90]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // Phantom at ts(7) = ts(8) - 60s
      const phantom = seriesA.data.find(
        (p: any) => {
          const t = p[0] instanceof Date ? p[0].getTime() : p[0];
          return t === ts(7);
        },
      );
      expect(phantom).toBeDefined();
    });

    it("does not prepend old data before queryStart", () => {
      const qStart = toMicro(ts(2));
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 0], [ts(1), 1], [ts(3), 3]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(8), 80]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, qStart, queryEnd, false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // ts(0), ts(1) are before queryStart — should not appear
      const beforeStart = seriesA.data.filter((p: any) => {
        const t = p[0] instanceof Date ? p[0].getTime() : p[0];
        return t < ts(2);
      });
      expect(beforeStart.length).toBe(0);
    });
  });

  describe("stale series — series in old but not in new", () => {
    it("adds old-only series with reduced opacity", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1]]),
          makeOldSeries("B", [[ts(0), 2]], { lineStyle: { width: 2 } }),
        ],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);

      expect(result.series.length).toBe(2);
      const staleSeries = result.series.find((s: any) => s.name === "B");
      expect(staleSeries).toBeDefined();
      expect(staleSeries.lineStyle.opacity).toBe(0.3);
      expect(staleSeries.itemStyle.opacity).toBe(0.3);
    });

    it("preserves areaStyle with reduced opacity on stale series", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1]], { areaStyle: { color: "blue" } }),
        ],
      };
      const newOpts = {
        series: [makeSeries("B", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);

      const staleSeries = result.series.find((s: any) => s.name === "A");
      expect(staleSeries.areaStyle.opacity).toBe(0.3);
      expect(staleSeries.areaStyle.color).toBe("blue");
    });

    it("filters stale series data to query range", () => {
      const queryStart = toMicro(ts(2));
      const queryEnd = toMicro(ts(8));
      const oldOpts = {
        series: [
          makeOldSeries("OLD", [
            [ts(0), 0], [ts(1), 1], // before range
            [ts(3), 3], [ts(5), 5], // in range
            [ts(9), 9], [ts(11), 11], // after range
          ]),
        ],
      };
      const newOpts = {
        series: [makeSeries("NEW", [[tsDate(3), 30]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        undefined, queryStart, queryEnd, true,
      );

      const staleSeries = result.series.find((s: any) => s.name === "OLD");
      // Only ts(3) and ts(5) are within [ts(2), ts(8)]
      expect(staleSeries.data.length).toBe(2);
    });

    it("skips stale series with null name", () => {
      const oldOpts = {
        series: [
          { name: null, data: [[ts(0), 1]], type: "line" },
        ],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      // Only series A, null-named should not be added
      expect(result.series.length).toBe(1);
      expect(result.series[0].name).toBe("A");
    });
  });

  describe("yAxis nameGap preservation", () => {
    it("preserves larger old nameGap", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        yAxis: { nameGap: 50 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        yAxis: { nameGap: 30 },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.yAxis.nameGap).toBe(50);
    });

    it("uses new nameGap when it is larger", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        yAxis: { nameGap: 20 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        yAxis: { nameGap: 40 },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.yAxis.nameGap).toBe(40);
    });
  });

  describe("grid.bottom preservation", () => {
    it("preserves larger old grid.bottom", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: { bottom: 80 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: { bottom: 50 },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.grid.bottom).toBe(80);
    });

    it("uses new grid.bottom when it is larger", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: { bottom: 30 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: { bottom: 60 },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.grid.bottom).toBe(60);
    });

    it("handles grid as array", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: [{ bottom: 100 }],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: [{ bottom: 40 }],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.grid[0].bottom).toBe(100);
    });
  });

  describe("legend recalculation", () => {
    it("updates legend data to include all series names", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1]]),
          makeOldSeries("B", [[ts(0), 2]]),
        ],
        legend: { data: ["A", "B"] },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        legend: { data: ["A"] },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      // B is stale and added, so legend should include both
      expect(result.legend.data).toContain("A");
      expect(result.legend.data).toContain("B");
    });

    it("handles legend as array", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1]]),
          makeOldSeries("B", [[ts(0), 2]]),
        ],
        legend: [{ data: ["A", "B"] }],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        legend: [{ data: ["A"] }],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.legend[0].data).toContain("A");
      expect(result.legend[0].data).toContain("B");
    });
  });

  describe("graphic overlay rendering", () => {
    const queryStart = toMicro(ts(0));
    const queryEnd = toMicro(ts(10));
    const container = makeContainerSize();

    it("adds graphic overlay for LTR streaming", () => {
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, container,
        boundary, queryStart, queryEnd, true, "#5156BE",
      );

      expect(result.graphic).toBeDefined();
      expect(result.graphic.length).toBe(1);
      expect(result.graphic[0].type).toBe("rect");
      expect(result.graphic[0].style.fill).toBe("#5156BE");
      expect(result.graphic[0].style.opacity).toBe(0.05);
      expect(result.graphic[0].silent).toBe(true);
      // LTR: overlay on left side
      expect(result.graphic[0].left).toBe(50); // plotLeft
    });

    it("adds graphic overlay for RTL streaming", () => {
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, container,
        boundary, queryStart, queryEnd, false, "#5156BE",
      );

      expect(result.graphic).toBeDefined();
      expect(result.graphic[0].type).toBe("rect");
      // RTL: overlay on right side
      expect(result.graphic[0].left).toBeGreaterThan(50);
    });

    it("uses fallback grid config when _gridRect is not available", () => {
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: { left: 40, right: 20, top: 10, bottom: 50 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: { left: 40, right: 20, top: 10, bottom: 50 },
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, container,
        boundary, queryStart, queryEnd, true,
      );

      expect(result.graphic).toBeDefined();
      // Uses fallback: plotLeft = grid.left = 40
      expect(result.graphic[0].left).toBe(40);
    });

    it("uses default grey color when primaryColor is not provided", () => {
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, container,
        boundary, queryStart, queryEnd, true,
      );

      expect(result.graphic[0].style.fill).toBe("#808080");
    });

    it("does not add graphic when containerSize is 0", () => {
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, { width: 0, height: 0 },
        boundary, queryStart, queryEnd, true,
      );

      expect(result.graphic).toBeUndefined();
    });

    it("does not add graphic when boundary is 0", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, container,
        0, queryStart, queryEnd, true,
      );

      expect(result.graphic).toBeUndefined();
    });
  });

  describe("shallow copy preservation", () => {
    it("preserves function references from newOptions (formatters)", () => {
      const formatter = (val: any) => `${val}%`;
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        yAxis: { axisLabel: { formatter } },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      expect(result.yAxis.axisLabel.formatter).toBe(formatter);
    });

    it("does not mutate original newOptions series data", () => {
      const originalData: [Date, number][] = [[tsDate(0), 10]];
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1], [ts(5), 5]])],
      };
      const newOpts = {
        series: [makeSeries("A", [...originalData])],
      };

      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(5)), queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      // Original newOpts series data should not be mutated
      expect(newOpts.series[0].data.length).toBe(1);
    });
  });

  describe("null values in series data", () => {
    it("preserves genuine null y-values in new data during LTR overlay", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1], [ts(1), 2], [ts(5), 5]])],
      };
      const newOpts = {
        series: [
          makeSeries("A", [
            [tsDate(0), 10],
            [tsDate(1), null], // genuine null — should be preserved
          ]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(2)), toMicro(ts(0)), toMicro(ts(10)),
        true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      // The null y-value at ts(1) should be preserved, not replaced with old data
      const pointAt1 = seriesA.data.find(
        (d: any) => toNum(d[0]) === ts(1),
      );
      expect(pointAt1).toBeDefined();
      expect(pointAt1[1]).toBeNull();
    });

    it("preserves genuine null y-values in new data during RTL overlay", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1], [ts(5), 5], [ts(10), 10]])],
      };
      const newOpts = {
        series: [
          makeSeries("A", [
            [tsDate(5), null], // genuine null
            [tsDate(10), 100],
          ]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(5)), toMicro(ts(0)), toMicro(ts(10)),
        false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      const pointAt5 = seriesA.data.find(
        (d: any) => toNum(d[0]) === ts(5),
      );
      expect(pointAt5).toBeDefined();
      expect(pointAt5[1]).toBeNull();
    });

    it("handles series where all new data points have null values", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1], [ts(5), 5]])],
      };
      const newOpts = {
        series: [
          makeSeries("A", [
            [tsDate(0), null],
            [tsDate(1), null],
          ]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(2)), toMicro(ts(0)), toMicro(ts(10)),
        true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      expect(seriesA).toBeDefined();
      // Both null values should be preserved
      const newPoints = seriesA.data.filter(
        (d: any) => {
          const t = toNum(d[0]);
          return t === ts(0) || t === ts(1);
        },
      );
      expect(newPoints).toHaveLength(2);
      expect(newPoints[0][1]).toBeNull();
      expect(newPoints[1][1]).toBeNull();
    });

    it("handles old series with null y-values in stale data", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), null], [ts(5), 5], [ts(10), null]])],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(5), 50], [tsDate(10), 100]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(5)), toMicro(ts(0)), toMicro(ts(10)),
        false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      // Old stale point at ts(0) with null value should be prepended
      const stalePoint = seriesA.data.find(
        (d: any) => toNum(d[0]) === ts(0),
      );
      expect(stalePoint).toBeDefined();
      expect(stalePoint[1]).toBeNull();
    });
  });

  describe("series with null name (annotation series)", () => {
    it("skips annotation series during merge", () => {
      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(5), 5]]),
          { name: null, data: [[ts(0), 100]], type: "line" },
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(0), 10]]),
          { name: null, data: [[tsDate(0), 200]], type: "line" },
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(5)), toMicro(ts(0)), toMicro(ts(10)), true, undefined, INTERVAL_MS,
      );

      // Annotation series should pass through unchanged
      const annotationSeries = result.series.filter((s: any) => s.name == null);
      expect(annotationSeries.length).toBe(1);
      expect(annotationSeries[0].data[0][1]).toBe(200);
    });
  });

  describe("grid with string values (parseInt fallback)", () => {
    it("parses grid.top as string via parseInt for graphic overlay", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(5));
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: { left: 40, right: 20, top: "15px", bottom: 50 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: { left: 40, right: 20, top: "15px", bottom: 50 },
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, makeContainerSize(),
        boundary, queryStart, queryEnd, true,
      );

      expect(result.graphic).toBeDefined();
      // top parsed as parseInt("15px") = 15
      expect(result.graphic[0].top).toBe(15);
    });
  });

  describe("multiple series overlay", () => {
    it("overlays multiple series independently in LTR", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(5));

      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(5), 5], [ts(8), 8]]),
          makeOldSeries("B", [[ts(0), 10], [ts(5), 50], [ts(9), 90]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(0), 100], [tsDate(1), 200]]),
          makeSeries("B", [[tsDate(0), 1000], [tsDate(2), 2000]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      const seriesB = result.series.find((s: any) => s.name === "B");

      // A: new data at ts(0),ts(1) + phantom + stale old after ts(1)
      expect(seriesA.data[0][1]).toBe(100);
      expect(seriesA.data[1][1]).toBe(200);

      // B: new data at ts(0),ts(2) + phantom + stale old after ts(2)
      expect(seriesB.data[0][1]).toBe(1000);
      expect(seriesB.data[1][1]).toBe(2000);
    });
  });

  describe("RTL phantom with old data value", () => {
    it("uses old data value for RTL phantom when old has data at phantom timestamp", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(5));

      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(4), 44], [ts(7), 7]]),
        ],
      };
      const newOpts = {
        series: [
          makeSeries("A", [[tsDate(5), 50], [tsDate(6), 60]]),
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, false, undefined, INTERVAL_MS,
      );

      const seriesA = result.series[0];
      // Phantom at ts(4) = ts(5) - 60s. Old has value 44 at ts(4)
      const phantom = seriesA.data.find(
        (p: any) => toNum(p[0]) === ts(4),
      );
      expect(phantom).toBeDefined();
      expect(phantom[1]).toBe(44);
    });
  });

  describe("graphic overlay edge cases", () => {
    it("does not add graphic when freshFraction is 0 (LTR, boundary at queryStart)", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(0)); // boundary at start → freshFraction = 0

      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, makeContainerSize(),
        boundary, queryStart, queryEnd, true, "#5156BE", // LTR
      );

      // LTR: freshFraction = (boundaryMs - queryStartMs) / totalRange = 0 → no graphic
      expect(result.graphic).toBeUndefined();
    });

    it("does not add graphic when containerSize is not provided", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        toMicro(ts(5)), toMicro(ts(0)), toMicro(ts(10)), true, "#5156BE",
      );

      expect(result.graphic).toBeUndefined();
    });

    it("clamps overlay to plot rect boundaries", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(9)); // near-full LTR coverage

      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        _gridRect: { x: 50, y: 10, width: 700, height: 350 },
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, makeContainerSize(),
        boundary, queryStart, queryEnd, true, "#5156BE",
      );

      expect(result.graphic).toBeDefined();
      // LTR: overlay width = 90% of plotWidth ≈ 630
      expect(result.graphic[0].left).toBe(50); // clamped to plotLeft
      expect(result.graphic[0].shape.width).toBeLessThanOrEqual(700);
    });
  });

  describe("non-array data points in series", () => {
    it("skips overlay for series with plain value data (not [timestamp, value])", () => {
      const queryStart = toMicro(ts(0));
      const queryEnd = toMicro(ts(10));
      const boundary = toMicro(ts(5));

      const oldOpts = {
        series: [
          makeOldSeries("A", [[ts(0), 1], [ts(5), 5]]),
        ],
      };
      const newOpts = {
        series: [
          { name: "A", data: [10, 20, 30], type: "bar" }, // plain values
        ],
      };

      const result = overlayNewDataOnOldOptions(
        oldOpts, newOpts, undefined,
        boundary, queryStart, queryEnd, true, undefined, INTERVAL_MS,
      );

      const seriesA = result.series.find((s: any) => s.name === "A");
      // Data should remain as-is (no merge attempted)
      expect(seriesA.data).toEqual([10, 20, 30]);
    });
  });

  describe("yAxis and grid edge cases", () => {
    it("handles missing yAxis in both old and new options", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      // Should not crash and result should have no yAxis modifications
      expect(result).toBeDefined();
    });

    it("handles grid.bottom as array with multiple entries", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        grid: [{ bottom: 100 }, { bottom: 50 }],
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        grid: [{ bottom: 40 }, { bottom: 60 }],
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      // Only first grid entry is compared; old (100) > new (40) → preserved
      expect(result.grid[0].bottom).toBe(100);
      // Second entry preserved from new
      expect(result.grid[1].bottom).toBe(60);
    });

    it("handles yAxis nameGap when old has non-numeric nameGap", () => {
      const oldOpts = {
        series: [makeOldSeries("A", [[ts(0), 1]])],
        yAxis: { nameGap: "50" }, // string, not number
      };
      const newOpts = {
        series: [makeSeries("A", [[tsDate(0), 10]])],
        yAxis: { nameGap: 30 },
      };

      const result = overlayNewDataOnOldOptions(oldOpts, newOpts);
      // typeof "50" !== "number" → falls back to 0, new (30) > 0 → uses new
      expect(result.yAxis.nameGap).toBe(30);
    });
  });
});
