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
import { EXEMPLAR_CARD_GAP_PX, exemplarCardPosition } from "./exemplarCardPosition";

const VIEWPORT = { width: 1500, height: 1000 };
const CARD = 320;
const px = (v: string | undefined) => Number(String(v).replace("px", ""));

describe("exemplarCardPosition", () => {
  it("hides without an anchor", () => {
    expect(exemplarCardPosition(null, VIEWPORT, CARD)).toEqual({ display: "none" });
  });

  it("opens to the right of a marker on the left half", () => {
    const pos = exemplarCardPosition({ x: 300, y: 200 }, VIEWPORT, CARD);
    expect(px(pos.left)).toBe(312);
    expect(pos.right).toBeUndefined();
  });

  it("opens to the left of a marker on the right half and never past the right edge", () => {
    const pos = exemplarCardPosition({ x: 1490, y: 200 }, VIEWPORT, CARD);
    expect(px(pos.right)).toBeGreaterThanOrEqual(EXEMPLAR_CARD_GAP_PX);
    expect(VIEWPORT.width - px(pos.right) - CARD).toBeGreaterThanOrEqual(EXEMPLAR_CARD_GAP_PX);
  });

  it("keeps a narrow viewport's card fully inside on both sides", () => {
    const narrow = { width: 360, height: 700 };
    for (const x of [20, 170, 190, 340]) {
      const pos = exemplarCardPosition({ x, y: 100 }, narrow, CARD);
      const width = Math.min(CARD, narrow.width - 2 * EXEMPLAR_CARD_GAP_PX);
      const left = pos.left !== undefined ? px(pos.left) : narrow.width - px(pos.right) - width;
      expect(left).toBeGreaterThanOrEqual(EXEMPLAR_CARD_GAP_PX);
      expect(left + width).toBeLessThanOrEqual(narrow.width - EXEMPLAR_CARD_GAP_PX);
    }
  });

  it("grows upward from a marker in the lower half", () => {
    const pos = exemplarCardPosition({ x: 300, y: 950 }, VIEWPORT, CARD);
    expect(pos.top).toBeUndefined();
    expect(px(pos.bottom)).toBeGreaterThanOrEqual(EXEMPLAR_CARD_GAP_PX);
  });

  it("bounds the far edge so a tall card anchored near the midline stays inside", () => {
    for (const y of [480, 520]) {
      const pos = exemplarCardPosition({ x: 300, y }, VIEWPORT, CARD);
      const near = pos.top !== undefined ? px(pos.top) : px(pos.bottom);
      expect(px(pos.maxHeight)).toBeLessThanOrEqual(VIEWPORT.height - near - EXEMPLAR_CARD_GAP_PX);
      expect(near + px(pos.maxHeight)).toBeLessThanOrEqual(VIEWPORT.height - EXEMPLAR_CARD_GAP_PX);
    }
  });
});
