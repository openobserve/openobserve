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
import {
  SYMBOL_SIZE_MAX,
  getScatterBaseOpacity,
  getScatterSymbolOpacity,
  getScatterSymbolSize,
  isScatterSymbolSizeValid,
} from "./scatterPointStyle";

describe("getScatterSymbolSize", () => {
  it("keeps 5 px when unset, cleared or invalid", () => {
    for (const config of [undefined, {}, { symbol_size: null }, { symbol_size: "" }]) {
      expect(getScatterSymbolSize(config)).toBe(5);
    }
    expect(getScatterSymbolSize({ symbol_size: 0 })).toBe(5);
    expect(getScatterSymbolSize({ symbol_size: -3 })).toBe(5);
    expect(getScatterSymbolSize({ symbol_size: NaN })).toBe(5);
    expect(getScatterSymbolSize({ symbol_size: SYMBOL_SIZE_MAX + 1 })).toBe(5);
  });

  it("uses a positive symbol_size", () => {
    expect(getScatterSymbolSize({ symbol_size: 14 })).toBe(14);
    expect(getScatterSymbolSize({ symbol_size: 2.5 })).toBe(2.5);
  });
});

describe("getScatterSymbolOpacity", () => {
  it("is undefined when unset, cleared or invalid, so the chart default applies", () => {
    for (const config of [undefined, {}, { symbol_opacity: null }, { symbol_opacity: "" }]) {
      expect(getScatterSymbolOpacity(config)).toBeUndefined();
    }
    expect(getScatterSymbolOpacity({ symbol_opacity: NaN })).toBeUndefined();
  });

  it("converts the percentage to a 0-1 opacity", () => {
    expect(getScatterSymbolOpacity({ symbol_opacity: 0 })).toBe(0);
    expect(getScatterSymbolOpacity({ symbol_opacity: 45 })).toBe(0.45);
    expect(getScatterSymbolOpacity({ symbol_opacity: 100 })).toBe(1);
  });

  it("clamps values outside 0-100", () => {
    expect(getScatterSymbolOpacity({ symbol_opacity: 150 })).toBe(1);
    expect(getScatterSymbolOpacity({ symbol_opacity: -20 })).toBe(0);
  });
});

describe("isScatterSymbolSizeValid", () => {
  it("accepts unset and positive sizes up to the max, fractions included", () => {
    [null, undefined, "", 0.5, 5, SYMBOL_SIZE_MAX].forEach((size) =>
      expect(isScatterSymbolSizeValid(size)).toBe(true),
    );
  });

  it("rejects 0, negatives, sizes above the max and non-numbers", () => {
    [0, -3, SYMBOL_SIZE_MAX + 1, NaN, "abc"].forEach((size) =>
      expect(isScatterSymbolSizeValid(size)).toBe(false),
    );
  });
});

describe("getScatterBaseOpacity", () => {
  it("is the set opacity, else the 0.8 ECharts draws by default", () => {
    expect(getScatterBaseOpacity({ symbol_opacity: 30 })).toBe(0.3);
    expect(getScatterBaseOpacity({})).toBe(0.8);
    expect(getScatterBaseOpacity(undefined)).toBe(0.8);
  });
});
