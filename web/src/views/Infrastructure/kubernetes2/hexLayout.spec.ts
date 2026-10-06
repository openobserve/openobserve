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
import { observed } from "./__fixtures__/mapInventory";
import {
  HEX_HALF_HEIGHT,
  HEX_HALF_WIDTH,
  hexLayout,
  middleTruncate,
  shelfCandidates,
  shortGroupNames,
  type LayoutParams,
} from "./hexLayout";
import { fit } from "./hexViewport";
import type { PodRow } from "./kubernetesModel";
import { groupRows } from "./mapFill";

const keysFor = (sizes: number[]) =>
  sizes.map((size, g) => Array.from({ length: size }, (_, i) => `c/ns-${g}/pod-${i}`));

const params = (sizes: number[], over: Partial<LayoutParams> = {}): LayoutParams => ({
  entity: "pods",
  group: "node",
  groups: keysFor(sizes),
  width: 1280,
  height: 800,
  bottomInset: 0,
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
        expect(f.headerBottom).toBeGreaterThanOrEqual(layout.y[index] + HEX_HALF_HEIGHT);
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

  it("is memoized on entity, group, the ordered row keys, the container size and the inset", () => {
    const first = hexLayout(params([5, 3]));
    expect(hexLayout(params([5, 3]))).toBe(first);
    expect(hexLayout(params([5, 3], { width: 900 }))).not.toBe(first);
    expect(hexLayout(params([5, 3], { height: 500 }))).not.toBe(hexLayout(params([5, 3])));
    expect(hexLayout(params([5, 3], { bottomInset: 56 }))).not.toBe(hexLayout(params([5, 3])));
    const reordered = params([5, 3]);
    reordered.groups[0] = [...reordered.groups[0]].reverse();
    expect(hexLayout(reordered)).not.toBe(hexLayout(params([5, 3])));
  });
});

// mulberry32: a seeded generator, so the brute-force comparison is repeatable.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const INSET = 56;

const scaleOf = (span: { spanX: number; spanY: number }, width: number, height: number) =>
  fit({ minX: 0, maxX: span.spanX, minY: -span.spanY, maxY: 0 }, width, height, INSET).scale;

// The spec's own greedy shelf packer, so the brute force does not share the code under test.
function packAt(frames: { w: number; h: number }[], shelf: number) {
  let [x, y, row, spanX] = [0, 0, 0, 0];
  for (const f of frames) {
    if (x > 0 && x + f.w > shelf + 1e-9) [x, y, row] = [0, y + row + 1, 0];
    spanX = Math.max(spanX, x + f.w);
    row = Math.max(row, f.h);
    x += f.w + 1;
  }
  return { spanX, spanY: y + row };
}

function bruteForce(p: LayoutParams) {
  const frames = hexLayout(p).frames.map((f) => ({ w: f.right - f.left, h: f.top - f.bottom }));
  const widths = frames.map((f) => f.w);
  const widest = Math.max(...widths);
  const sums = new Set<number>();
  let best = 0;
  for (let i = 0; i < widths.length; i++) {
    let sum = -1;
    for (let j = i; j < widths.length; j++) {
      sum += widths[j] + 1;
      if (sum < widest - 1e-9) continue;
      sums.add(Math.round(sum * 1e6));
      best = Math.max(best, scaleOf(packAt(frames, sum), p.width, p.height));
    }
  }
  return { best, candidates: sums.size };
}

describe("hexLayout fills the canvas (AC 82)", () => {
  it("puts four node groups on the first shelf of a 920×470 canvas, at scale ≥ 24.2", () => {
    const layout = hexLayout(
      params([12, 10, 9, 9, 1], { width: 920, height: 470, bottomInset: INSET }),
    );
    expect(layout.frames.filter((f) => f.top === layout.frames[0].top)).toHaveLength(4);
    expect(fit(layout.bounds, 920, 470, INSET).scale).toBeGreaterThanOrEqual(24.2);
  });

  it("matches a brute force over every run sum for 500 random block sets", () => {
    const random = seeded(42);
    for (let set = 0; set < 500; set++) {
      const count = 2 + Math.floor(random() * 39);
      const sizes = Array.from({ length: count }, () => 1 + Math.floor(random() * 120));
      for (const [width, height] of [
        [920, 470],
        [1230, 600],
        [343, 500],
      ]) {
        const p = params(sizes, { width, height, bottomInset: INSET });
        const chosen = fit(hexLayout(p).bounds, width, height, INSET).scale;
        const { best, candidates } = bruteForce(p);
        expect(chosen).toBeGreaterThanOrEqual((candidates <= 200 ? 0.999 : 0.95) * best);
      }
    }
  });

  it("beats a prefix-only search on blocks of 65, 15 and 14 at 343×500", () => {
    const p = params([65, 15, 14], { width: 343, height: 500 });
    expect(fit(hexLayout(p).bounds, 343, 500).scale).toBeGreaterThanOrEqual(16.9);
    const frames = hexLayout(p).frames.map((f) => ({ w: f.right - f.left, h: f.top - f.bottom }));
    const first = packAt(frames, frames[0].w);
    const prefix = fit({ minX: 0, maxX: first.spanX, minY: -first.spanY, maxY: 0 }, 343, 500).scale;
    expect(prefix).toBeLessThan(12.5);
  });

  it("samples 200 run sums for 1,500 groups without listing all of them", () => {
    const widths = Array.from({ length: 1500 }, (_, i) => 8 + ((i * 7) % 13) * 0.5);
    const widest = Math.max(...widths);
    const total = widths.reduce((a, b) => a + b, 0) + widths.length - 1;
    let smallest = Infinity;
    for (let i = 0; i < widths.length; i++) {
      let sum = -1;
      for (let j = i; j < widths.length && sum < widest; j++) sum += widths[j] + 1;
      if (sum >= widest) smallest = Math.min(smallest, sum);
    }
    const picked = shelfCandidates(widths);
    expect(picked).toHaveLength(200);
    expect(picked[0]).toBeCloseTo(smallest, 9);
    expect(picked[199]).toBeCloseTo(total, 6);
    for (let k = 1; k < 200; k++) expect(picked[k]).toBeGreaterThanOrEqual(picked[k - 1]);
  });

  it("samples exactly 200 run sums, keeping the smallest and largest", () => {
    const widths = Array.from({ length: 40 }, (_, i) => 8 + i * 0.37);
    const all = new Set<number>();
    for (let i = 0; i < widths.length; i++) {
      let sum = -1;
      for (let j = i; j < widths.length; j++) all.add((sum += widths[j] + 1));
    }
    const sorted = [...all].filter((w) => w >= Math.max(...widths)).sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(200);
    const picked = shelfCandidates(widths);
    expect(picked).toHaveLength(200);
    expect(picked[0]).toBeCloseTo(sorted[0], 9);
    expect(picked[199]).toBeCloseTo(sorted[sorted.length - 1], 9);
  });

  it("insets hexes half a unit from their frame", () => {
    const layout = hexLayout(params([1, 1], { width: 1000, height: 600 }));
    const [a, b] = layout.frames;
    expect(layout.x[0] - HEX_HALF_WIDTH - a.left).toBeCloseTo(0.5, 9);
    expect(b.left - a.right).toBeCloseTo(1, 9);
  });

  it("frames grouped nodes too, one frame per group, apart and around their hexes (AC 96)", () => {
    const sizes = [2, 1, 1];
    const layout = hexLayout(params(sizes, { entity: "nodes", group: "label.zone" }));
    expect(layout.frames).toHaveLength(3);
    let index = 0;
    sizes.forEach((size, g) => {
      const f = layout.frames[g];
      for (let k = 0; k < size; k++, index++) {
        expect(layout.x[index] - HEX_HALF_WIDTH).toBeGreaterThanOrEqual(f.left);
        expect(layout.x[index] + HEX_HALF_WIDTH).toBeLessThanOrEqual(f.right);
        expect(layout.y[index] + HEX_HALF_HEIGHT).toBeLessThanOrEqual(f.headerBottom);
        expect(layout.y[index] - HEX_HALF_HEIGHT).toBeGreaterThanOrEqual(f.bottom);
      }
    });
    expect(hexLayout(params([4], { entity: "nodes", group: "none" })).frames).toHaveLength(0);
  });
});

describe("hexLayout minimum card width in pixels", () => {
  it("widens every card to the requested pixels at the resulting fit", () => {
    const sizes = Array.from({ length: 27 }, (_, i) => (i < 5 ? 3 : 1));
    const base = params(sizes, { group: "workload", width: 1230, height: 600, bottomInset: INSET });
    const narrow = hexLayout(base);
    const narrowScale = fit(narrow.bounds, 1230, 600, INSET).scale;
    expect(narrow.frames.some((f) => (f.right - f.left) * narrowScale < 175)).toBe(true);
    const wide = hexLayout({ ...base, minFramePx: 175, minBandPx: 16 });
    const scale = fit(wide.bounds, 1230, 600, INSET).scale;
    for (const f of wide.frames)
      expect((f.right - f.left) * scale).toBeGreaterThanOrEqual(175 - 1e-6);
    expect(2 * scale).toBeGreaterThanOrEqual(16);
  });

  it("does not widen when wider cards would shrink the header band below the title minimum", () => {
    const sizes = Array.from({ length: 27 }, (_, i) => (i < 5 ? 3 : 1));
    const base = params(sizes, { group: "workload", width: 343, height: 414, bottomInset: INSET });
    const widths = (l: ReturnType<typeof hexLayout>) => l.frames.map((f) => f.right - f.left);
    const plain = widths(hexLayout(base));
    expect(widths(hexLayout({ ...base, minFramePx: 175, minBandPx: 16 }))).toEqual(plain);
  });
});

describe("hexLayout at a fixed scale (narrow canvas)", () => {
  it("packs at the given scale, two cards per row, each at least the requested pixels", () => {
    const sizes = Array.from({ length: 27 }, (_, i) => (i < 5 ? 3 : 1));
    const layout = hexLayout(
      params(sizes, {
        group: "workload",
        width: 343,
        height: 400,
        fixedScale: 17,
        minFramePx: 145,
      }),
    );
    const pad = 0.04 * 343;
    expect(layout.bounds.maxX * 17).toBeLessThanOrEqual(343 - 2 * pad + 1e-6);
    for (const f of layout.frames)
      expect((f.right - f.left) * 17).toBeGreaterThanOrEqual(145 - 1e-6);
    const rows = new Map<number, number>();
    for (const f of layout.frames) rows.set(f.top, (rows.get(f.top) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBe(2);
  });
});

describe("hexLayout at high cardinality (AC 99)", () => {
  const pod = (i: number, labels: Record<string, string>, workload: number): PodRow =>
    ({
      key: `c/ns/p${i}`,
      kind: "pod",
      name: `p${i}`,
      namespace: "ns",
      warnings: [],
      workload: { kind: "Deployment", name: `svc-${workload}` },
      object: observed(labels),
    }) as unknown as PodRow;
  const PODS = Array.from({ length: 5000 }, (_, i) =>
    pod(
      i,
      {
        build: `b${i % 2000}`,
        app: `app-${i % 300}`,
        tier: ["web", "db", "cache"][i % 3],
        zone: `z${i % 3}`,
        team: `t${i % 12}`,
        env: i % 2 ? "prod" : "staging",
      },
      i % 300,
    ),
  );
  // minFramePx/minBandPx as K8sHexMap passes them for workload grouping.
  const timed = (group: "label.build" | "workload", pods = PODS) => {
    hexLayout(params([3, 4]));
    const start = performance.now();
    const { groups } = groupRows(pods, group);
    const layout = hexLayout({
      entity: "pods",
      group,
      groups: groups.map((g) => g.rows.map((r) => r.key)),
      width: 1230,
      height: 600,
      bottomInset: INSET,
      ...(group === "workload" ? { minFramePx: 175, minBandPx: 16 } : {}),
    });
    return { elapsed: performance.now() - start, layout };
  };

  it("lays out 1,500 workload groups of 5,000 pods, widened, within 50 ms", () => {
    const pods = PODS.map((p, i) => ({
      ...p,
      workload: { kind: "Deployment", name: `w-${i % 1500}` },
    }));
    const { elapsed, layout } = timed("workload", pods as PodRow[]);
    expect(layout.frames).toHaveLength(1500);
    expect(elapsed).toBeLessThanOrEqual(50);
  });

  it("lays out a 2,000-value label group as 100 cards within 50 ms", () => {
    const { elapsed, layout } = timed("label.build");
    expect(layout.frames).toHaveLength(100);
    expect(elapsed).toBeLessThanOrEqual(50);
  });

  it("lays out 300 workload groups uncapped within 50 ms", () => {
    const { elapsed, layout } = timed("workload");
    expect(layout.frames).toHaveLength(300);
    expect(elapsed).toBeLessThanOrEqual(50);
  });
});

describe("group titles (AC 83)", () => {
  const sixPx = (text: string) => text.length * 6;

  it("strips the suffix every node name shares from a dot", () => {
    expect(shortGroupNames(["ip-10-0-11-39.ec2.internal", "ip-10-0-13-37.ec2.internal"])).toEqual([
      "ip-10-0-11-39",
      "ip-10-0-13-37",
    ]);
  });

  it("strips no prefix, and leaves one name or names with no shared dotted suffix alone", () => {
    const gke = ["gke-prod-default-pool-1a2b3c4d-xk9z", "gke-prod-default-pool-1a2b3c4d-m2q8"];
    expect(shortGroupNames(gke)).toEqual(gke);
    expect(shortGroupNames(["solo.ec2.internal"])).toEqual(["solo.ec2.internal"]);
    expect(shortGroupNames(["a.x", "b.y"])).toEqual(["a.x", "b.y"]);
    expect(shortGroupNames([".x", "a.x"])).toEqual([".x", "a.x"]);
  });

  it("middle-truncates to fit, keeping the distinguishing tail", () => {
    const [a, b] = ["gke-prod-default-pool-1a2b3c4d-xk9z", "gke-prod-default-pool-1a2b3c4d-m2q8"];
    const ta = middleTruncate(a, 72, sixPx);
    const tb = middleTruncate(b, 72, sixPx);
    expect(ta).toMatch(/^gke-.+….*xk9z$/);
    expect(sixPx(ta)).toBeLessThanOrEqual(72);
    expect(ta).not.toBe(tb);
    expect(middleTruncate("short", 72, sixPx)).toBe("short");
  });
});
