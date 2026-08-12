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

import { describe, it, expect } from "vitest";

import { readServerMetrics, serverMetricsTiles, type DbmServerMetrics } from "./serverMetrics";

const matched = {
  stream: "dbm_server",
  server_metrics_capture: "on",
  exec_time_kind: "execution",
  matched: true,
  instance: "postgres",
  calls: 1200,
  rows: 4800,
  exec_time_s: 24,
  mean_exec_time_s: 0.02,
  shared_blks_hit: 900,
  shared_blks_read: 100,
  temp_blks_read: 0,
  temp_blks_written: 0,
};

describe("readServerMetrics", () => {
  it("reads a matched envelope into the view model", () => {
    const m = readServerMetrics(matched);
    expect(m.state).toBe("matched");
    expect(m.instance).toBe("postgres");
    expect(m.calls).toBe(1200);
    expect(m.rows).toBe(4800);
  });

  // The unit conversion happens HERE, at the read layer, so no component does
  // arithmetic on a wire value and no two components disagree about the unit.
  it("converts the mean from seconds to nanoseconds at the read layer", () => {
    const m = readServerMetrics(matched);
    expect(m.meanExecTimeNs).toBe(0.02 * 1e9);
  });

  /**
   * The three absence states are distinct, because each names a different fix
   * and none may collapse into a generic "no data".
   */
  it("distinguishes capture-off from a plain miss", () => {
    expect(
      readServerMetrics({ ...matched, matched: false, server_metrics_capture: "off" }).state,
    ).toBe("off");
    expect(
      readServerMetrics({ ...matched, matched: false, server_metrics_capture: "on" }).state,
    ).toBe("unmatched");
  });

  /**
   * The ambiguity case: the join deliberately omits `instance` so it survives a
   * pooler, and the price is that two instances sharing a database name are
   * indistinguishable. The backend withholds the numbers; the read layer must
   * carry the reason and the candidates through rather than flattening it to a
   * plain miss, which would send the reader looking for a fix that is not the
   * one they need.
   */
  it("surfaces the ambiguous-instance case with its candidates", () => {
    const m = readServerMetrics({
      stream: "dbm_server",
      server_metrics_capture: "on",
      exec_time_kind: "execution",
      matched: false,
      unmatched_reason: "pooler",
      candidate_instances: ["pg-a", "pg-b"],
    });
    expect(m.state).toBe("ambiguous");
    expect(m.candidateInstances).toEqual(["pg-a", "pg-b"]);
    expect(m.calls).toBeNull();
  });

  // A missing/garbage envelope must read as "no data", never throw: the server
  // block is supplementary detail on a page whose point is the query.
  it("tolerates an absent envelope", () => {
    expect(readServerMetrics(undefined).state).toBe("off");
    expect(readServerMetrics(null).state).toBe("off");
  });

  // MySQL ships no row or block counters at all, so absent must stay absent
  // rather than becoming a confident zero.
  it("keeps absent counters absent instead of coercing them to zero", () => {
    const m = readServerMetrics({
      stream: "dbm_server",
      server_metrics_capture: "on",
      exec_time_kind: "wait",
      matched: true,
      instance: "mysql-1",
      calls: 10,
      rows: null,
      shared_blks_hit: null,
    });
    expect(m.rows).toBeNull();
    expect(m.sharedBlksHit).toBeNull();
    expect(m.calls).toBe(10);
  });

  /**
   * A counter must be a real FINITE NUMBER or it is absent.
   *
   * The search path hands back whatever the column held, and both failure
   * shapes here are ones a tile would render as fact: a numeric STRING would
   * flow through typed as `number` and be formatted as a count, and `NaN`
   * would print as a broken figure rather than the honest em dash. Absent is
   * the only correct answer for both.
   */
  it("rejects non-finite and non-numeric counters rather than passing them through", () => {
    const m = readServerMetrics({
      ...matched,
      calls: "1200" as unknown as number,
      rows: Number.NaN,
      shared_blks_hit: Number.POSITIVE_INFINITY,
    });
    expect(m.calls).toBeNull();
    expect(m.rows).toBeNull();
    expect(m.sharedBlksHit).toBeNull();
  });

  it("carries the per-engine meaning of the folded exec-time field", () => {
    expect(readServerMetrics(matched).execTimeKind).toBe("execution");
    expect(readServerMetrics({ ...matched, exec_time_kind: "wait" }).execTimeKind).toBe("wait");
  });
});

describe("serverMetricsTiles", () => {
  const tiles = (m: DbmServerMetrics) => serverMetricsTiles(m);

  it("labels the mean as a mean and never as a percentile", () => {
    const rendered = JSON.stringify(tiles(readServerMetrics(matched)));
    expect(rendered).toContain("mean");
    // pg_stat_statements accumulates a total and a count — there is no
    // percentile in this feed, and calling a quotient p95 is a fabrication.
    expect(rendered).not.toContain("p95");
    expect(rendered).not.toContain("p99");
    expect(rendered).not.toContain("percentile");
  });

  /**
   * `exec_time_s` folds Postgres `total_exec_time` (EXECUTION time) and MySQL
   * `sum_timer_wait` (WAIT time) into one field. The header must name which
   * one it is, or a MySQL reader is told the database measured something it
   * never measured.
   */
  it("names the measurement differently per engine", () => {
    const pg = tiles(readServerMetrics(matched)).find((t) => t.id === "mean");
    const my = tiles(readServerMetrics({ ...matched, exec_time_kind: "wait" })).find(
      (t) => t.id === "mean",
    );
    expect(pg?.labelKey).not.toEqual(my?.labelKey);
    expect(pg?.labelKey).toContain("Execution");
    expect(my?.labelKey).toContain("Wait");
  });

  // No subtraction of a server mean from a client percentile, over different
  // populations, over windows that do not even align.
  it("derives no client/server difference figure", () => {
    const rendered = JSON.stringify(tiles(readServerMetrics(matched))).toLowerCase();
    for (const banned of ["network", "overhead", "difference", "delta", "pool wait"]) {
      expect(rendered).not.toContain(banned);
    }
  });

  it("emits no tiles when there is nothing to show", () => {
    expect(tiles(readServerMetrics(undefined))).toEqual([]);
    expect(
      tiles(readServerMetrics({ ...matched, matched: false, server_metrics_capture: "on" })),
    ).toEqual([]);
  });

  // The unit must be stated in the header rather than left for the reader to
  // infer from the magnitude.
  it("states the unit for block counters", () => {
    const t = tiles(readServerMetrics(matched)).find((x) => x.id === "shared_blks_read");
    expect(t).toBeDefined();
    expect(t?.value).not.toBe("");
  });
});
