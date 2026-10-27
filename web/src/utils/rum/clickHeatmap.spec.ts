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
  groupBySelector,
  placeGroup,
  sharePercent,
  summarizeClicks,
  toClickPoint,
} from "./clickHeatmap";

const click = (selector: string, x: number, y: number, width = 100, height = 50) => ({
  selector,
  x,
  y,
  width,
  height,
});

describe("groupBySelector", () => {
  it("counts clicks per element and ranks the busiest first", () => {
    const groups = groupBySelector([click("#a", 1, 1), click("#b", 1, 1), click("#b", 2, 2)]);
    expect(groups.map((g) => [g.selector, g.clicks])).toEqual([
      ["#b", 2],
      ["#a", 1],
    ]);
  });
});

describe("placeGroup", () => {
  it("scales the recorded offset to the element's current rect", () => {
    const [group] = groupBySelector([click("#a", 50, 25, 100, 50)]);
    const rect = { left: 200, top: 300, width: 400, height: 100 } as DOMRect;
    expect(placeGroup(group, rect, 0, 10)).toEqual([{ x: 400, y: 360 }]);
  });

  it("centres the click when the element size was not recorded", () => {
    const [group] = groupBySelector([click("#a", 5, 5, 0, 0)]);
    const rect = { left: 0, top: 0, width: 100, height: 40 } as DOMRect;
    expect(placeGroup(group, rect, 0, 0)).toEqual([{ x: 50, y: 20 }]);
  });
});

describe("toClickPoint", () => {
  it("reads position and target from JSON text columns", () => {
    expect(
      toClickPoint({
        pos: '{"x":36,"y":35}',
        tgt: '{"selector":"#lnk-docs","width":92,"height":46}',
      }),
    ).toMatchObject({ selector: "#lnk-docs", x: 36, y: 35, width: 92, height: 46 });
  });

  it("reads flat columns from older SDKs", () => {
    expect(toClickPoint({ sel: "#a", x: 1, y: 2, w: 10, h: 20 })).toMatchObject({
      selector: "#a",
      x: 1,
      y: 2,
      width: 10,
      height: 20,
    });
  });

  it("skips rows with unparseable or missing data", () => {
    expect(toClickPoint({ pos: "not json", tgt: "{}" })).toBeNull();
    expect(toClickPoint({ pos: '{"x":1,"y":2}', tgt: '{"width":5}' })).toBeNull();
  });
});

describe("insights", () => {
  const rows = [
    { ...click("#buy", 1, 1), name: "Buy now", sessionId: "s1", frustrated: true },
    { ...click("#buy", 2, 2), name: "Buy now", sessionId: "s1" },
    { ...click("#buy", 3, 3), name: "Buy", sessionId: "s2" },
    { ...click("#docs", 1, 1), name: "Docs", sessionId: "s2" },
  ];

  it("names an element by its most common label and counts distinct sessions", () => {
    const [top, other] = groupBySelector(rows);
    expect(top).toMatchObject({
      selector: "#buy",
      name: "Buy now",
      clicks: 3,
      sessions: 2,
      frustrated: 1,
    });
    expect(other).toMatchObject({ selector: "#docs", sessions: 1, frustrated: 0 });
  });

  it("summarizes the whole page", () => {
    const summary = summarizeClicks(rows, groupBySelector(rows));
    expect(summary).toMatchObject({ clicks: 4, sessions: 2, frustrated: 1 });
    expect(summary.top?.selector).toBe("#buy");
  });

  it("rounds shares to one decimal and survives an empty page", () => {
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(0, 0)).toBe(0);
  });

  it("reads name, session and frustration off a row", () => {
    const point = toClickPoint({
      pos: '{"x":1,"y":2}',
      tgt: '{"selector":"#a"}',
      name: " Docs ",
      sid: "s9",
      frus: "[]",
    });
    expect(point).toMatchObject({ name: "Docs", sessionId: "s9", frustrated: false });
    expect(
      toClickPoint({ pos: '{"x":1,"y":2}', tgt: '{"selector":"#a"}', frus: "rage_click" })
        ?.frustrated,
    ).toBe(true);
  });
});

describe("ranking and frustration edge cases", () => {
  it("breaks click ties by sessions, then frustration, then selector so the order is stable", () => {
    const rows = [
      { ...click("#b", 1, 1), sessionId: "s1" },
      { ...click("#a", 1, 1), sessionId: "s1" },
      { ...click("#c", 1, 1), sessionId: "s1" },
      { ...click("#c", 2, 2), sessionId: "s2" },
      { ...click("#d", 1, 1), sessionId: "s1", frustrated: true },
      { ...click("#d", 2, 2), sessionId: "s1" },
    ];
    expect(groupBySelector(rows).map((g) => g.selector)).toEqual(["#c", "#d", "#a", "#b"]);
  });

  it("treats an array-valued frustration column as frustrated only when it has entries", () => {
    const base = { pos: '{"x":1,"y":2}', tgt: '{"selector":"#a"}' };
    expect(toClickPoint({ ...base, frus: ["rage_click"] })?.frustrated).toBe(true);
    expect(toClickPoint({ ...base, frus: [] })?.frustrated).toBe(false);
  });
});
