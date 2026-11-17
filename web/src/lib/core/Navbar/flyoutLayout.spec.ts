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
import { flyoutTop, needsColumns } from "./flyoutLayout";

const box = (over: Partial<Parameters<typeof flyoutTop>[0]> = {}) => ({
  tileTop: 300,
  height: 200,
  viewportHeight: 800,
  margin: 8,
  ...over,
});

describe("flyoutTop", () => {
  it.each([
    ["stays at the tile top when it fits below", box(), 300],
    ["centres a tall flyout that no longer fits below its tile", box({ height: 600 }), 100],
    ["pins a flyout taller than the window to the top margin", box({ height: 900 }), 8],
    [
      "keeps a short flyout on its tile when centring would lose it",
      box({ tileTop: 720, height: 78 }),
      714,
    ],
    ["never starts above the top margin when the tile is scrolled out", box({ tileTop: -30 }), 8],
  ])("%s", (_name, input, expected) => {
    expect(flyoutTop(input)).toBe(expected);
  });
});

describe("needsColumns", () => {
  it("is true when one column does not fit below the tile and there are two sections", () => {
    expect(needsColumns(box({ height: 600 }), 2)).toBe(true);
  });

  it("is false when the column fits below the tile", () => {
    expect(needsColumns(box({ height: 200 }), 2)).toBe(false);
  });

  it("is false with a single section however tall it is", () => {
    expect(needsColumns(box({ height: 600 }), 1)).toBe(false);
  });

  it("treats a tile scrolled above the margin as starting at the margin", () => {
    expect(needsColumns(box({ tileTop: -100, height: 790 }), 2)).toBe(true);
    expect(needsColumns(box({ tileTop: -100, height: 700 }), 2)).toBe(false);
  });
});
