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
import { convertMapsData } from "./convertMapsData";

const query = {
  fields: { name: { alias: "country" }, value_for_maps: { alias: "value" } },
};

const schema = (config: any = { map_type: { type: "world" } }, queries = [query]) => ({
  type: "maps",
  queries,
  config,
});

describe("convertMapsData", () => {
  it("returns no options without a name and value field", () => {
    expect(convertMapsData({ queries: [{ fields: {} }], config: {} }, [[]])).toEqual({
      options: null,
    });
  });

  it("renders the world map when map_type is missing", () => {
    const result: any = convertMapsData(schema({}), [[{ country: "US", value: 3 }]]);
    expect(result.options.series[0].map).toBe("world");
  });

  it("keeps pan and zoom off unless enable_roam is set", () => {
    const rows = [[{ country: "US", value: 3 }]];
    expect((convertMapsData(schema(), rows) as any).options.series[0].roam).toBe(false);
    expect(
      (convertMapsData(schema({ enable_roam: true }), rows) as any).options.series[0].roam,
    ).toBe(true);
  });

  it("leaves the background to the theme and drops the fixed white tooltip", () => {
    const result: any = convertMapsData(schema(), [[{ country: "US", value: 3 }]]);
    expect(result.options.backgroundColor).toBe("transparent");
    expect(result.options.tooltip.backgroundColor).toBeUndefined();
  });

  it("joins names case-insensitively and through aliases, summing rows that land on one region", () => {
    const result: any = convertMapsData(schema(), [
      [
        { country: "US", value: 2 },
        { country: "united states", value: "3" },
        { country: "South Korea", value: 4 },
      ],
    ]);
    expect(result.options.series[0].data).toEqual([
      { name: "United States", value: 5 },
      { name: "Korea", value: 4 },
    ]);
    expect(result.extras.regionJoin).toBeNull();
  });

  it("builds the colour scale from matched regions only and reports the rest", () => {
    const result: any = convertMapsData(schema(), [
      [
        { country: "US", value: 10 },
        { country: "CA", value: 20 },
        { country: "Atlantis", value: 9000 },
        { country: null, value: 1 },
      ],
    ]);
    expect(result.options.visualMap.min).toBe(10);
    expect(result.options.visualMap.max).toBe(20);
    expect(result.options.series[0].data).toHaveLength(2);
    expect(result.extras.regionJoin).toEqual({ unmatched: ["Atlantis"], unmatchedTotal: 1 });
  });

  it("scales against region totals summed across queries", () => {
    const result: any = convertMapsData(schema(undefined, [query, query]), [
      [
        { country: "US", value: 10 },
        { country: "DE", value: 4 },
      ],
      [{ country: "US", value: 15 }],
    ]);
    expect(result.options.visualMap.min).toBe(4);
    expect(result.options.visualMap.max).toBe(25);
  });

  it("scales a single region from zero", () => {
    const result: any = convertMapsData(schema(), [[{ country: "US", value: 7 }]]);
    expect(result.options.visualMap.min).toBe(0);
    expect(result.options.visualMap.max).toBe(7);
  });

  it("draws an empty map but still reports names when nothing joins", () => {
    const result: any = convertMapsData(schema(), [[{ country: "Atlantis", value: 1 }]]);
    expect(result.options.series).toEqual([]);
    expect(result.options.visualMap).toEqual([]);
    expect(result.extras.regionJoin.unmatched).toEqual(["Atlantis"]);
  });

  it("formats the tooltip and the colour legend with the panel unit", () => {
    const result: any = convertMapsData(schema({ unit: "bytes", decimals: 0 }), [
      [{ country: "US", value: 2048 }],
    ]);
    expect(result.options.tooltip.formatter({ name: "<b>US</b>", value: 2048 })).toBe(
      "&lt;b&gt;US&lt;/b&gt;: 2KB",
    );
    expect(result.options.visualMap.formatter(1024)).toBe("1KB");
  });

  it("leaves the colour legend format alone without a unit, whatever the decimals", () => {
    const result: any = convertMapsData(schema({ decimals: 2, unit: "default" }), [
      [{ country: "US", value: 2048 }],
    ]);
    expect(result.options.visualMap.formatter).toBeUndefined();
    expect(result.options.tooltip.formatter({ name: "Chad", value: NaN })).toBe("Chad: -");
  });
});
