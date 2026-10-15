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
import { indexesNearX, lineSeriesAtPoint, type LineSeriesPixels } from "./lineSeriesAtPoint";

const flat: LineSeriesPixels = {
  seriesIndex: 0,
  points: [
    [0, 100],
    [100, 100],
    [200, 100],
  ],
};
const spike: LineSeriesPixels = {
  seriesIndex: 2,
  points: [
    [0, 100],
    [100, 20],
    [200, 100],
  ],
};

describe("lineSeriesAtPoint", () => {
  it("finds the line a click lands on between its points, with the nearer point", () => {
    expect(lineSeriesAtPoint([75, 40], [flat, spike])).toEqual({ seriesIndex: 2, dataIndex: 1 });
    expect(lineSeriesAtPoint([30, 101], [flat, spike])).toEqual({ seriesIndex: 0, dataIndex: 0 });
  });

  it("finds nothing away from every line", () => {
    expect(lineSeriesAtPoint([50, 300], [flat, spike])).toBeNull();
  });

  it("does not bridge a gap the chart leaves undrawn", () => {
    const gapped: LineSeriesPixels = { seriesIndex: 1, points: [[0, 50], null, [200, 50]] };
    expect(lineSeriesAtPoint([100, 50], [gapped])).toBeNull();
    expect(lineSeriesAtPoint([2, 51], [gapped])).toEqual({ seriesIndex: 1, dataIndex: 0 });
  });

  it("takes the first of two lines drawn on top of each other", () => {
    const twin = { ...flat, seriesIndex: 3 };
    expect(lineSeriesAtPoint([50, 100], [flat, twin])?.seriesIndex).toBe(0);
  });

  it("reports the data index of a window that starts past the series' first point", () => {
    expect(lineSeriesAtPoint([75, 40], [{ ...spike, offset: 500 }])).toEqual({
      seriesIndex: 2,
      dataIndex: 501,
    });
  });
});

describe("indexesNearX", () => {
  const every10 = (index: number) => index * 10;

  it("takes the points within reach of the cursor plus one either side", () => {
    expect(indexesNearX(100, 505, every10, 6)).toEqual([49, 52]);
  });

  it("clamps to the series' ends", () => {
    expect(indexesNearX(3, -50, every10, 6)).toEqual([0, 0]);
    expect(indexesNearX(3, 500, every10, 6)).toEqual([2, 2]);
  });

  it("gives up on a series whose x cannot be placed, or that has no points", () => {
    expect(indexesNearX(10, 50, () => NaN)).toBeNull();
    expect(indexesNearX(0, 50, every10)).toBeNull();
  });
});
