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

import { fitCount } from "./streamFit";

describe("fitCount", () => {
  it("shows every stream when they all fit, with no +N label", () => {
    expect(fitCount([50, 50, 50], 30, 200)).toBe(3);
  });

  it("keeps room for the +N label once a stream is left out", () => {
    expect(fitCount([50, 50, 50], 30, 140)).toBe(2);
    expect(fitCount([50, 50, 50], 30, 125)).toBe(1);
    expect(fitCount([50, 50, 50, 50], 30, 135)).toBe(2);
  });

  it("always shows at least one stream, which truncates when the row is tiny", () => {
    expect(fitCount([300, 50], 30, 100)).toBe(1);
  });

  it("falls back to one stream before the row has been measured", () => {
    expect(fitCount([50, 50, 50], 30, 0)).toBe(1);
  });

  it("returns 0 for no streams", () => {
    expect(fitCount([], 30, 500)).toBe(0);
  });
});
