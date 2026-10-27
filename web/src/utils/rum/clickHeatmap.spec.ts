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
  placeGroup,
  sharePercent,
  sortElements,
  toElementGroup,
  type ElementGroup,
} from "./clickHeatmap";

const group = (selector: string, over: Partial<ElementGroup> = {}): ElementGroup => ({
  selector,
  name: "",
  clicks: 1,
  sessions: 1,
  rage: 0,
  dead: 0,
  error: 0,
  frustrated: 0,
  ...over,
});

describe("toElementGroup", () => {
  it("reads a ranking row and coerces numeric strings", () => {
    expect(
      toElementGroup({
        selector: "#buy",
        name: " Buy now ",
        clicks: "12",
        sessions: 5,
        rage: "2",
        dead: 3,
        err: 1,
        frustrated: "4",
      }),
    ).toEqual({
      selector: "#buy",
      name: "Buy now",
      clicks: 12,
      sessions: 5,
      rage: 2,
      dead: 3,
      error: 1,
      frustrated: 4,
    });
  });

  it("drops rows with no selector and zeroes missing counts", () => {
    expect(toElementGroup({ selector: "", clicks: 3 })).toBeNull();
    expect(toElementGroup({ clicks: 3 })).toBeNull();
    expect(toElementGroup({ selector: "#a" })).toMatchObject({ clicks: 0, name: "", error: 0 });
  });
});

describe("sortElements", () => {
  it("ranks by clicks, then sessions, then frustrated clicks, then selector", () => {
    const sorted = sortElements([
      group("#z", { clicks: 5, sessions: 2, frustrated: 0 }),
      group("#b", { clicks: 5, sessions: 3, frustrated: 0 }),
      group("#c", { clicks: 5, sessions: 3, frustrated: 2 }),
      group("#a", { clicks: 5, sessions: 3, frustrated: 2 }),
      group("#top", { clicks: 9 }),
    ]);
    expect(sorted.map((g) => g.selector)).toEqual(["#top", "#a", "#c", "#b", "#z"]);
  });

  it("does not mutate its input", () => {
    const input = [group("#b"), group("#a")];
    sortElements(input);
    expect(input.map((g) => g.selector)).toEqual(["#b", "#a"]);
  });
});

describe("placeGroup", () => {
  const rect = { left: 200, top: 300, width: 400, height: 100 } as DOMRect;

  it("glows at the element centre in page coordinates", () => {
    const spot = placeGroup(group("#a", { clicks: 10 }), 10, rect, 0, 10);
    expect(spot).toMatchObject({ x: 400, y: 360, weight: 1 });
  });

  it("dims quieter elements but never below the floor", () => {
    expect(placeGroup(group("#a", { clicks: 1 }), 100, rect, 0, 0).weight).toBeCloseTo(0.307);
    expect(placeGroup(group("#a", { clicks: 0 }), 0, rect, 0, 0).weight).toBe(0.3);
  });

  it("clamps the glow radius to the element size within bounds", () => {
    const tiny = { left: 0, top: 0, width: 10, height: 10 } as DOMRect;
    const huge = { left: 0, top: 0, width: 2000, height: 10 } as DOMRect;
    expect(placeGroup(group("#a"), 1, tiny, 0, 0).radius).toBe(28);
    expect(placeGroup(group("#a"), 1, huge, 0, 0).radius).toBe(90);
  });
});

describe("sharePercent", () => {
  it("rounds shares to one decimal and survives an empty page", () => {
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(0, 0)).toBe(0);
  });
});
