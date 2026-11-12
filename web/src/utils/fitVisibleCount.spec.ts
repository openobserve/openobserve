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
import { fitVisibleCount } from "./fitVisibleCount";

describe("fitVisibleCount", () => {
  it("returns 0 for no items", () => {
    expect(fitVisibleCount([], 100, 4, 20)).toBe(0);
  });

  it("shows everything with no room reserved for +N when all items fit", () => {
    expect(fitVisibleCount([40, 40], 84, 4, 30)).toBe(2);
  });

  it("reserves room for +N when only some items fit", () => {
    expect(fitVisibleCount([40, 40, 40], 100, 4, 20)).toBe(1);
    expect(fitVisibleCount([40, 40, 40], 112, 4, 20)).toBe(2);
  });

  it("keeps one item when even the first is too long", () => {
    expect(fitVisibleCount([500], 100, 4, 0)).toBe(1);
    expect(fitVisibleCount([500, 40], 100, 4, 20)).toBe(1);
  });
});
