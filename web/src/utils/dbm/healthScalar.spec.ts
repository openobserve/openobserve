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

import { absentMetrics, type DbmRowMetrics } from "./instanceMetrics";
import { healthScalar, healthSortValue } from "./healthScalar";

const rowMetrics = (over: Partial<DbmRowMetrics> = {}): DbmRowMetrics => ({
  state: "matched",
  saturation: { state: "measured", used: 20, limit: 100, ratio: 0.2 },
  cacheHitRatio: null,
  replicationLag: null,
  deadlocks: null,
  connectionSeries: [],
  connectionPoints: [],
  unmatchedReason: null,
  ...over,
});

// ── the scalar ───────────────────────────────────────────────────────────────
//
// The existing `load` column sorts `total_time_ns`, which is VOLUME: a healthy
// instance serving ten times the traffic outranks a saturated one that is
// melting. This scalar answers the other question — how close to a ceiling is
// this instance — and it must never answer it by inventing a ceiling.

describe("healthScalar", () => {
  it("reports the measured connection saturation as the scalar", () => {
    expect(healthScalar(rowMetrics())).toMatchObject({ state: "measured", ratio: 0.2 });
  });

  // A number a user cannot explain is worse than no number. The scalar names
  // the ratio it came from so the cell can say "connections" beside it, and so
  // adding a second ratio later cannot silently change what the figure means.
  it("names which ratio produced the figure", () => {
    expect(healthScalar(rowMetrics()).driver).toBe("connections");
  });

  it("carries a saturation over the limit rather than capping it at 1", () => {
    // Being over the limit is precisely the thing worth sorting to the top.
    expect(
      healthScalar(
        rowMetrics({ saturation: { state: "measured", used: 120, limit: 100, ratio: 1.2 } }),
      ).ratio,
    ).toBeCloseTo(1.2, 10);
  });

  // Every MySQL instance is permanently here: mysqlreceiver publishes no
  // max_connections, so there is a count and no denominator. Dividing by a
  // high-water mark or by an attempt counter would fabricate the ceiling, and
  // a fabricated 4% would sort a saturated MySQL host to the bottom.
  it("reports no-limit rather than a ratio when the engine publishes no ceiling", () => {
    const scalar = healthScalar(
      rowMetrics({ saturation: { state: "no-limit", used: 400, limit: null, ratio: null } }),
    );
    expect(scalar.state).toBe("no-limit");
    expect(scalar.ratio).toBeNull();
  });

  it("does not name a driver when it produced no ratio", () => {
    const scalar = healthScalar(
      rowMetrics({ saturation: { state: "no-limit", used: 400, limit: null, ratio: null } }),
    );
    expect(scalar.driver).toBeNull();
  });

  it("reports absent when the instance matched but sent no connection reading", () => {
    const scalar = healthScalar(
      rowMetrics({ saturation: { state: "absent", used: null, limit: null, ratio: null } }),
    );
    expect(scalar).toMatchObject({ state: "absent", ratio: null, driver: null });
  });

  // A row whose metrics never arrived is not an instance at 0% saturation.
  it("reports absent for a row the metrics read could not resolve", () => {
    expect(healthScalar(absentMetrics("unmatched", "pooler")).state).toBe("absent");
  });

  it("reports absent when the join is switched off", () => {
    expect(healthScalar(absentMetrics("disabled", null)).state).toBe("absent");
  });

  // The page renders rows before the metrics read lands, and a breakdown child
  // carries none at all.
  it("reports absent when there are no metrics on the row at all", () => {
    expect(healthScalar(undefined).state).toBe("absent");
  });
});

// ── the sort ─────────────────────────────────────────────────────────────────
//
// Descending is "most saturated first". The one rule that is not obvious: an
// instance whose health is UNKNOWN must not be hidden at the bottom of that
// sort. A fleet page whose answer to "which needs attention" buries every
// unreadable instance below every healthy one is the failure this whole slice
// is about.

describe("healthSortValue", () => {
  it("ranks a more saturated instance above a less saturated one", () => {
    const hot = healthSortValue(
      rowMetrics({ saturation: { state: "measured", used: 95, limit: 100, ratio: 0.95 } }),
    );
    const calm = healthSortValue(rowMetrics());
    expect(hot).toBeGreaterThan(calm);
  });

  // Unknown health outranks every measured healthy instance under a descending
  // sort. "I cannot see this instance" is a finding, not a clean bill.
  it("sorts an instance with no reading ABOVE every measured one", () => {
    const unknown = healthSortValue(absentMetrics("unmatched", "no-receiver"));
    const saturated = healthSortValue(
      rowMetrics({ saturation: { state: "measured", used: 100, limit: 100, ratio: 1 } }),
    );
    expect(unknown).toBeGreaterThan(saturated);
  });

  it("sorts an over-limit instance above every measured one below the limit", () => {
    const over = healthSortValue(
      rowMetrics({ saturation: { state: "measured", used: 150, limit: 100, ratio: 1.5 } }),
    );
    const under = healthSortValue(
      rowMetrics({ saturation: { state: "measured", used: 99, limit: 100, ratio: 0.99 } }),
    );
    expect(over).toBeGreaterThan(under);
    // ...and still below unknown, which remains the top of the column.
    expect(healthSortValue(absentMetrics("no-data", null))).toBeGreaterThan(over);
  });

  // A MySQL instance can never produce a ratio, so ranking it by its raw count
  // would put a 400-connection MySQL host above a Postgres host at 99% of its
  // limit — comparing a count with a share. It joins the unknowns instead.
  it("sorts a count with no published limit with the unknowns, not by its count", () => {
    const mysql = healthSortValue(
      rowMetrics({ saturation: { state: "no-limit", used: 400, limit: null, ratio: null } }),
    );
    const unknown = healthSortValue(absentMetrics("no-data", null));
    expect(mysql).toBe(unknown);
  });

  it("gives every row a finite number, so the comparator cannot produce NaN", () => {
    for (const value of [
      healthSortValue(rowMetrics()),
      healthSortValue(absentMetrics("no-data", null)),
      healthSortValue(undefined),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
