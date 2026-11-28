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
import { keepPlacement, placeMenu } from "./menuPlacement";

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 280, height: 40 };

describe("placeMenu", () => {
  it("opens down and to the right of the click when it fits", () => {
    expect(placeMenu({ x: 100, y: 200 }, MENU, VIEWPORT)).toEqual({ left: 100, top: 200 });
  });

  it("flips to the left of the click near the right edge", () => {
    expect(placeMenu({ x: 900, y: 200 }, MENU, VIEWPORT)).toEqual({ left: 620, top: 200 });
  });

  it("flips above the click near the bottom edge", () => {
    expect(placeMenu({ x: 100, y: 790 }, MENU, VIEWPORT)).toEqual({ left: 100, top: 750 });
  });

  it("stays inside the viewport when it fits on neither side", () => {
    const wide = { width: 990, height: 900 };
    expect(placeMenu({ x: 500, y: 400 }, wide, VIEWPORT)).toEqual({ left: 8, top: 8 });
  });

  it("keeps a margin from the left and top edges", () => {
    expect(placeMenu({ x: 2, y: 3 }, MENU, VIEWPORT)).toEqual({ left: 8, top: 8 });
  });

  it("flips both ways in the bottom-right corner", () => {
    expect(placeMenu({ x: 995, y: 795 }, MENU, VIEWPORT)).toEqual({ left: 712, top: 752 });
  });
});

describe("keepPlacement", () => {
  it("a menu flipped above the cursor keeps its top when rows leave its bottom", () => {
    const placed = placeMenu({ x: 100, y: 790 }, { width: 280, height: 200 }, VIEWPORT);
    expect(placed).toEqual({ left: 100, top: 590 });
    // Shorter now: it would fit below the cursor, but it neither re-flips nor moves.
    expect(
      keepPlacement(placed.top, { x: 100, y: 790 }, { width: 280, height: 80 }, VIEWPORT),
    ).toEqual(placed);
  });

  it("a menu that grows past the bottom edge is pulled up only as far as needed", () => {
    expect(keepPlacement(700, { x: 100, y: 700 }, { width: 280, height: 150 }, VIEWPORT)).toEqual({
      left: 100,
      top: 642,
    });
  });
});
