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
import { HEX_HALF_HEIGHT, HEX_HALF_WIDTH, hexLayout, type LayoutParams } from "./hexLayout";

const keysFor = (sizes: number[]) =>
  sizes.map((size, g) => Array.from({ length: size }, (_, i) => `c/ns-${g}/pod-${i}`));

const params = (sizes: number[], over: Partial<LayoutParams> = {}): LayoutParams => ({
  entity: "pods",
  group: "node",
  groups: keysFor(sizes),
  width: 1280,
  height: 800,
  ...over,
});

const SIZES_5000 = Array.from({ length: 50 }, (_, i) => 60 + ((i * 37) % 81)).map((s, i, all) =>
  i === all.length - 1 ? 5000 - all.slice(0, -1).reduce((a, b) => a + b, 0) : s,
);

describe("hexLayout (AC 52)", () => {
  it("lays out 5,000 rows in 50 groups within 50 ms", () => {
    expect(SIZES_5000.reduce((a, b) => a + b, 0)).toBe(5000);
    hexLayout(params([3, 4]));
    const start = performance.now();
    const layout = hexLayout(params(SIZES_5000));
    const elapsed = performance.now() - start;
    expect(layout.x).toHaveLength(5000);
    expect(layout.frames).toHaveLength(50);
    expect(elapsed).toBeLessThanOrEqual(50);
  });

  it("never overlaps two hexes, and every hex lies inside its group frame", () => {
    const sizes = [41, 17, 9, 3, 1, 1, 120, 2];
    const layout = hexLayout(params(sizes));
    const n = layout.x.length;
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        min = Math.min(min, Math.hypot(layout.x[i] - layout.x[j], layout.y[i] - layout.y[j]));
      }
    }
    // Adjacent unit hexes sit exactly one hex width apart.
    expect(min).toBeGreaterThanOrEqual(2 * HEX_HALF_WIDTH - 1e-9);
    let index = 0;
    sizes.forEach((size, g) => {
      const f = layout.frames[g];
      for (let k = 0; k < size; k++, index++) {
        expect(layout.x[index] - HEX_HALF_WIDTH).toBeGreaterThanOrEqual(f.left);
        expect(layout.x[index] + HEX_HALF_WIDTH).toBeLessThanOrEqual(f.right);
        expect(layout.y[index] + HEX_HALF_HEIGHT).toBeLessThanOrEqual(f.top);
        expect(f.labelY).toBeGreaterThan(layout.y[index] + HEX_HALF_HEIGHT);
        expect(layout.y[index] - HEX_HALF_HEIGHT).toBeGreaterThanOrEqual(f.bottom);
      }
    });
  });

  it("keeps frames apart and inside the bounds", () => {
    const layout = hexLayout(params([30, 20, 10, 5, 5, 5]));
    const { frames, bounds } = layout;
    for (const f of frames) {
      expect(f.left).toBeGreaterThanOrEqual(bounds.minX);
      expect(f.right).toBeLessThanOrEqual(bounds.maxX);
      expect(f.bottom).toBeGreaterThanOrEqual(bounds.minY);
      expect(f.top).toBeLessThanOrEqual(bounds.maxY);
    }
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const [a, b] = [frames[i], frames[j]];
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom >= b.top || b.bottom >= a.top;
        expect(apart).toBe(true);
      }
    }
  });

  it("fills a group row by row into a near-square block", () => {
    const layout = hexLayout(params([100], { group: "none" }));
    expect(layout.frames).toHaveLength(0);
    const w = layout.bounds.maxX - layout.bounds.minX;
    const h = layout.bounds.maxY - layout.bounds.minY;
    expect(w / h).toBeGreaterThan(0.75);
    expect(w / h).toBeLessThan(1.35);
    expect(layout.y[1]).toBe(layout.y[0]);
    expect(layout.x[1]).toBeGreaterThan(layout.x[0]);
  });

  it("packs blocks left to right before starting a new shelf", () => {
    const layout = hexLayout(params([4, 4, 4, 4]));
    const [a, b] = layout.frames;
    expect(b.left).toBeGreaterThan(a.right);
    expect(b.top).toBe(a.top);
  });

  it("is memoized on entity, group, the ordered row keys and the container size", () => {
    const first = hexLayout(params([5, 3]));
    expect(hexLayout(params([5, 3]))).toBe(first);
    expect(hexLayout(params([5, 3], { width: 900 }))).not.toBe(first);
    const reordered = params([5, 3]);
    reordered.groups[0] = [...reordered.groups[0]].reverse();
    expect(hexLayout(reordered)).not.toBe(hexLayout(params([5, 3])));
  });
});
