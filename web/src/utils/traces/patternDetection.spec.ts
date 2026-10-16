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
import { buildPatternConsolidatedTree } from "./patternDetection";

const span = (id: string, service: string, durationMs: number, children: any[] = []) => ({
  spanId: id,
  serviceName: service,
  durationMs,
  spans: children,
});

describe("buildPatternConsolidatedTree", () => {
  it("consolidates a 20,000-level chain alternating two services", () => {
    const root: any = span("s0", "a", 20_000);
    let tail = root;
    for (let i = 1; i < 20_000; i++) {
      const child = span(`s${i}`, i % 2 ? "b" : "a", 20_000 - i);
      tail.spans.push(child);
      tail = child;
    }
    const patterns = buildPatternConsolidatedTree([root]);
    expect([...patterns.keys()].sort()).toEqual(["a", "a→b", "b", "b→a"]);
    expect(patterns.get("a→b")!.metrics.count).toBe(10_000);
    expect(patterns.get("b→a")!.metrics.count).toBe(9_999);
    expect(patterns.get("a")!.metrics.count).toBe(10_000);
    expect(patterns.get("a")!.metrics.max).toBe(20_000);
    expect(patterns.get("b")!.metrics.min).toBe(1);
  });

  it("keeps the visit order and metrics of a branching tree", () => {
    const tree = [
      span("r", "a", 100, [span("x", "b", 40, [span("y", "a", 10)]), span("z", "c", 30)]),
    ];
    const patterns = buildPatternConsolidatedTree(tree);
    expect([...patterns.keys()]).toEqual(["a→b", "b→a", "a→c", "a", "b", "c"]);
    expect(patterns.get("a")!.spanIds).toEqual(["r", "y"]);
    expect(patterns.get("a")!.metrics).toMatchObject({ count: 2, min: 10, max: 100 });
    expect(patterns.get("a→b")!.spanIds).toEqual(["x"]);
    expect(patterns.get("a→c")!.metrics).toMatchObject({ count: 1, min: 30, max: 30 });
  });
});
