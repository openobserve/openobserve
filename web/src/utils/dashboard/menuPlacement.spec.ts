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
import { placeMenu } from "./menuPlacement";

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
});
