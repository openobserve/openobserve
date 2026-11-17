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
import { withoutEntrance } from "./chartMotion";
import { convertServiceGraphToTree } from "@/utils/traces/convertTraceData";

describe("withoutEntrance", () => {
  it("zeroes the service graph tree's own series durations", () => {
    const graph = {
      nodes: [
        { id: "a", label: "a", requests: 1, errors: 0, errorRate: 0 },
        { id: "b", label: "b", requests: 1, errors: 0, errorRate: 0 },
      ],
      edges: [{ from: "a", to: "b", total_requests: 1, failed_requests: 0 }],
    };
    const { options } = convertServiceGraphToTree(graph as any, "horizontal");
    const tree = (options.series as Record<string, unknown>[])[0];
    expect(tree).toMatchObject({ animationDuration: 550, animationDurationUpdate: 750 });

    const still = withoutEntrance(options);
    expect(still).toMatchObject({ animationDuration: 0, animationDurationUpdate: 0 });
    for (const entry of still.series as Record<string, unknown>[]) {
      expect(entry).toMatchObject({ animationDuration: 0, animationDurationUpdate: 0 });
    }
    expect(tree.animationDuration).toBe(550);
  });

  it("overrides root durations and keeps the animation switch and hover state animation", () => {
    const still = withoutEntrance({
      animation: false,
      animationDuration: 1000,
      animationDurationUpdate: 300,
      stateAnimation: { duration: 300 },
      series: { type: "line", animationDuration: 400, data: [1] },
    });
    expect(still).toMatchObject({
      animation: false,
      animationDuration: 0,
      animationDurationUpdate: 0,
      stateAnimation: { duration: 300 },
      series: { type: "line", animationDuration: 0, animationDurationUpdate: 0, data: [1] },
    });
  });

  it("adds no series to options that have none and leaves empty entries", () => {
    expect(withoutEntrance({ title: { text: "x" } })).not.toHaveProperty("series");
    expect(withoutEntrance({ series: [null] }).series).toEqual([null]);
  });
});
