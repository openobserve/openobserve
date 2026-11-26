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

import { healthColumnSortValue, healthIssues, hasThresholdedReading } from "./healthIssues";
import type { DbmRowMetrics } from "./instanceMetrics";

const m = (over: Partial<DbmRowMetrics> & { ratio?: number | null }): DbmRowMetrics =>
  ({
    saturation: {
      state: over.ratio == null ? "no-limit" : "measured",
      ratio: over.ratio ?? null,
      used: 1,
      limit: null,
    },
    cacheHitRatio: null,
    deadlocks: null,
    replicationLag: null,
    connectionPoints: [],
    unmatchedReason: null,
    ...over,
  }) as unknown as DbmRowMetrics;

describe("health column sort", () => {
  it("ranks a critical 10% row above a healthy 60% row", () => {
    const critical = m({ ratio: 0.1, deadlocks: 2 });
    const healthy = m({ ratio: 0.6 });
    expect(healthColumnSortValue(critical)).toBeGreaterThan(healthColumnSortValue(healthy));
  });

  it("ranks errors above warnings, then more issues, then higher share", () => {
    const err = m({ ratio: 0.95 });
    const warn = m({ ratio: 0.5, cacheHitRatio: 0.5 });
    const two = m({ ratio: 0.95, cacheHitRatio: 0.5 });
    expect(healthColumnSortValue(err)).toBeGreaterThan(healthColumnSortValue(warn));
    expect(healthColumnSortValue(two)).toBeGreaterThan(healthColumnSortValue(err));
    expect(healthColumnSortValue(m({ ratio: 0.8 }))).toBeGreaterThan(
      healthColumnSortValue(m({ ratio: 0.2 })),
    );
  });

  it("puts rows with no reading first", () => {
    expect(healthColumnSortValue(undefined)).toBeGreaterThan(
      healthColumnSortValue(m({ ratio: 2 })),
    );
  });
});

describe("hasThresholdedReading", () => {
  it("is false for a connection count with no limit and nothing else", () => {
    expect(hasThresholdedReading(m({}))).toBe(false);
    expect(healthIssues(m({}))).toEqual([]);
    expect(hasThresholdedReading(m({ cacheHitRatio: 0.99 }))).toBe(true);
  });
});
