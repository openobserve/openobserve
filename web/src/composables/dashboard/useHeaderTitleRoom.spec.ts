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
import { nextTitleRoom, TITLE_MIN_PX } from "./useHeaderTitleRoom";

const fresh = { crowded: false, roomAt: 0 };

describe("nextTitleRoom", () => {
  it("leaves a title with room alone", () => {
    expect(nextTitleRoom(fresh, { headerWidth: 1400, titleWidth: 300, titleRoom: 200 })).toEqual(
      fresh,
    );
  });

  it("leaves a short title alone even when its box is small", () => {
    expect(nextTitleRoom(fresh, { headerWidth: 1280, titleWidth: 40, titleRoom: 40 })).toEqual(
      fresh,
    );
  });

  it("flags a title squeezed to 21px at 1280 and records the width it needs (V25)", () => {
    const next = nextTitleRoom(fresh, { headerWidth: 1190, titleWidth: 144, titleRoom: 21 });
    expect(next).toEqual({ crowded: true, roomAt: 1190 + 144 - 21 });
  });

  it("asks for at most the minimum width for a long title", () => {
    const next = nextTitleRoom(fresh, { headerWidth: 1190, titleWidth: 600, titleRoom: 21 });
    expect(next.roomAt).toBe(1190 + TITLE_MIN_PX - 21);
  });

  it("stays crowded while the title box is wide but the header is still short of room", () => {
    const crowded = { crowded: true, roomAt: 1313 };
    expect(nextTitleRoom(crowded, { headerWidth: 1300, titleWidth: 144, titleRoom: 900 })).toBe(
      crowded,
    );
  });

  it("clears once the header reaches the recorded width", () => {
    const crowded = { crowded: true, roomAt: 1313 };
    expect(nextTitleRoom(crowded, { headerWidth: 1313, titleWidth: 144, titleRoom: 900 })).toEqual(
      fresh,
    );
  });
});
