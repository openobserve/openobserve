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

import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import useResizer from "./useResizer";

function container(width = 1000) {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width });
  return ref(el);
}

function drag(onMouseDown: (e: MouseEvent) => void, fromX: number, toX: number) {
  onMouseDown(new MouseEvent("mousedown", { clientX: fromX }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: toX }));
  document.dispatchEvent(new MouseEvent("mouseup"));
}

describe("useResizer", () => {
  it("reads function limits at drag time, not at setup", () => {
    // Regression: OSplitter's limits change after mount (collapsed [100,100]
    // widening to [55,85]); a snapshot clamp snapped the first drag to 100.
    let min = 100;
    let max = 100;
    const onResize = vi.fn();
    const { onMouseDown } = useResizer({
      direction: "horizontal",
      initialValue: 70,
      minValue: () => min,
      maxValue: () => max,
      unit: "%",
      containerRef: container(),
      throttleMs: 0,
      onResize,
    });

    min = 55;
    max = 85;
    // -10px of a 1000px container = -1%.
    drag(onMouseDown, 100, 90);

    expect(onResize).toHaveBeenCalledWith(69);
  });

  it("still clamps against plain numeric limits", () => {
    const onResize = vi.fn();
    const { onMouseDown } = useResizer({
      direction: "horizontal",
      initialValue: 70,
      minValue: 68,
      maxValue: 85,
      unit: "%",
      containerRef: container(),
      throttleMs: 0,
      onResize,
    });

    // -100px of 1000px = -10% -> 60, clamped up to the 68 floor.
    drag(onMouseDown, 200, 100);

    expect(onResize).toHaveBeenCalledWith(68);
  });
});
