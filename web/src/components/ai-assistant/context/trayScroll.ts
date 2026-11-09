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

export interface ScrollBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface EdgeFade {
  start: boolean;
  end: boolean;
}

export interface WheelDelta {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

const LINE_PX = 16;
const FADE = "1.5rem";

/** Which edges of a horizontal scroller hide content past them. */
export function edgeFadeOf(box: ScrollBox): EdgeFade {
  const max = box.scrollWidth - box.clientWidth;
  return { start: box.scrollLeft > 1, end: max - box.scrollLeft > 1 };
}

export function edgeMask(fade: EdgeFade): string | undefined {
  if (!fade.start && !fade.end) return undefined;
  const start = fade.start ? `transparent 0, #000 ${FADE}` : "#000 0";
  const end = fade.end ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

/** Horizontal pixels a mostly vertical wheel moves the row by; 0 leaves the wheel to the page. */
export function wheelToScroll(wheel: WheelDelta, box: ScrollBox): number {
  if (Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return 0;
  const max = box.scrollWidth - box.clientWidth;
  if (max <= 0) return 0;
  let unit = 1;
  if (wheel.deltaMode === 1) unit = LINE_PX;
  else if (wheel.deltaMode === 2) unit = box.clientWidth;
  const next = Math.min(max, Math.max(0, box.scrollLeft + wheel.deltaY * unit));
  return next - box.scrollLeft;
}
