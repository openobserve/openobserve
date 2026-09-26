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

/** Distance kept between the card, the marker and the viewport edges, in CSS pixels. */
export const EXEMPLAR_CARD_GAP_PX = 12;

export type ExemplarCardPosition = Partial<
  Record<"left" | "right" | "top" | "bottom" | "display" | "maxHeight", string>
>;

/** Opens beside the marker on the roomier side and clamps so the whole card stays in the viewport. */
export function exemplarCardPosition(
  anchor: { x: number; y: number } | null | undefined,
  viewport: { width: number; height: number },
  cardWidthPx: number,
): ExemplarCardPosition {
  if (!anchor) return { display: "none" };
  const gap = EXEMPLAR_CARD_GAP_PX;
  const width = Math.min(cardWidthPx, viewport.width - 2 * gap);
  const maxStart = Math.max(gap, viewport.width - gap - width);
  const out: ExemplarCardPosition = {};
  if (anchor.x > viewport.width / 2) {
    const right = viewport.width - anchor.x + gap;
    out.right = `${Math.min(Math.max(gap, right), maxStart)}px`;
  } else {
    out.left = `${Math.min(Math.max(gap, anchor.x + gap), maxStart)}px`;
  }
  // The card's height is only known after render, so the lower half grows upward from the marker.
  // The far edge is bounded too, so a tall card scrolls inside itself instead of leaving the viewport.
  if (anchor.y > viewport.height / 2) {
    const bottom = Math.max(gap, viewport.height - anchor.y - gap * 4);
    out.bottom = `${bottom}px`;
    out.maxHeight = `${Math.max(0, viewport.height - bottom - gap)}px`;
  } else {
    const top = Math.max(gap, anchor.y - gap * 4);
    out.top = `${top}px`;
    out.maxHeight = `${Math.max(0, viewport.height - top - gap)}px`;
  }
  return out;
}
