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

import type { HistoryPoint } from "@/services/db_monitoring";
import {
  buildHistorySeries,
  classifyPoint,
  errorRateValues,
  qpsValues,
  seriesValues,
} from "./history";

/** The rollup interval used across these tests: 15 min in microseconds. */
const INTERVAL = 15 * 60 * 1_000_000;
const T0 = 1_700_000_000_000_000;
/** Window END n intervals after T0 — the API's timestamps are window ends. */
const at = (n: number) => T0 + n * INTERVAL;

describe("classifyPoint", () => {
  it("treats a plain rollup window as measured", () => {
    expect(classifyPoint({ timestamp: at(0), calls: 10, p95_ns: 5 })).toBe("measured");
  });

  it("treats a below-top-N point carrying metrics as backfilled", () => {
    expect(classifyPoint({ timestamp: at(0), below_top_n: true, backfilled: true, calls: 3 })).toBe(
      "backfilled",
    );
  });

  it("treats a below-top-N point with no metrics as unmeasured", () => {
    expect(classifyPoint({ timestamp: at(0), below_top_n: true })).toBe("unmeasured");
  });

  it("classifies the live point ahead of its metrics", () => {
    expect(classifyPoint({ timestamp: at(0), live: true, calls: 4 })).toBe("live");
  });

  /**
   * The backfill's genuine-zero arm emits `calls: 0` and nothing else. That
   * zero is a MEASUREMENT ("we read the raw spans; it did not run"), which is
   * the one case where plotting zero is honest. Classifying it as unmeasured
   * would hide a real finding behind a band.
   */
  it("keeps a backfilled zero as a measurement, not a band", () => {
    const point: HistoryPoint = {
      timestamp: at(0),
      below_top_n: true,
      backfilled: true,
      calls: 0,
    };
    expect(classifyPoint(point)).toBe("backfilled");
    expect(buildHistorySeries([point], { intervalMicros: INTERVAL }).points[0].plottable).toBe(
      true,
    );
  });
});

describe("buildHistorySeries", () => {
  it("sorts defensively — the live point is appended after the server's sort", () => {
    const series = buildHistorySeries(
      [
        { timestamp: at(5), live: true, calls: 1 },
        { timestamp: at(1), calls: 2 },
        { timestamp: at(0), calls: 3 },
      ],
      { intervalMicros: INTERVAL },
    );
    expect(series.points.map((p) => p.timestamp)).toEqual([at(0), at(1), at(5)]);
  });

  it("merges adjacent unmeasured windows into one band", () => {
    const series = buildHistorySeries(
      [
        { timestamp: at(0), calls: 5 },
        { timestamp: at(1), below_top_n: true },
        { timestamp: at(2), below_top_n: true },
        { timestamp: at(3), below_top_n: true },
        { timestamp: at(4), calls: 6 },
      ],
      { intervalMicros: INTERVAL },
    );
    expect(series.bands).toHaveLength(1);
    expect(series.bands[0]).toMatchObject({ from: at(1), to: at(3), count: 3 });
  });

  it("keeps non-adjacent unmeasured windows as separate bands", () => {
    const series = buildHistorySeries(
      [
        { timestamp: at(0), below_top_n: true },
        { timestamp: at(1), calls: 5 },
        { timestamp: at(2), calls: 5 },
        { timestamp: at(3), below_top_n: true },
      ],
      { intervalMicros: INTERVAL },
    );
    expect(series.bands).toHaveLength(2);
  });

  it("reports backfill_capped so the caller can disclose varying fidelity", () => {
    const series = buildHistorySeries([{ timestamp: at(0), calls: 1 }], {
      intervalMicros: INTERVAL,
      backfillCapped: true,
    });
    expect(series.backfillCapped).toBe(true);
  });

  it("anchors the live segment to the last aggregated window", () => {
    const series = buildHistorySeries(
      [
        { timestamp: at(0), calls: 5 },
        { timestamp: at(1), calls: 6 },
        { timestamp: at(2), live: true, calls: 7 },
      ],
      { intervalMicros: INTERVAL },
    );
    expect(series.liveFrom).toBe(at(1));
  });

  it("reports no live anchor when the tail produced nothing", () => {
    const series = buildHistorySeries([{ timestamp: at(0), calls: 5 }], {
      intervalMicros: INTERVAL,
    });
    expect(series.liveFrom).toBeNull();
  });
});

describe("seriesValues", () => {
  /**
   * The single most important assertion in this file. A below-top-N window
   * means "ranked below the cut", and a line dipping to zero says "the query
   * stopped" — which mid-incident reads as recovered.
   */
  it("emits null, never zero, for an unmeasured window", () => {
    const series = buildHistorySeries(
      [
        { timestamp: at(0), p95_ns: 500 },
        { timestamp: at(1), below_top_n: true },
        { timestamp: at(2), p95_ns: 900 },
      ],
      { intervalMicros: INTERVAL },
    );
    const values = seriesValues(series.points, "p95_ns");
    expect(values).toEqual([500, null, 900]);
    expect(values[1]).not.toBe(0);
  });

  it("emits null for a metric the rollup never carried", () => {
    const series = buildHistorySeries([{ timestamp: at(0), calls: 5 }], {
      intervalMicros: INTERVAL,
    });
    expect(seriesValues(series.points, "p95_ns")).toEqual([null]);
  });
});

describe("qpsValues", () => {
  it("divides by the window length, not by the page's time range", () => {
    const series = buildHistorySeries([{ timestamp: at(0), calls: 900 }], {
      intervalMicros: INTERVAL,
    });
    // 900 calls over a 900-second window is exactly 1/s.
    expect(qpsValues(series.points, INTERVAL)).toEqual([1]);
  });

  it("emits null for unmeasured windows rather than a zero rate", () => {
    const series = buildHistorySeries([{ timestamp: at(0), below_top_n: true }], {
      intervalMicros: INTERVAL,
    });
    expect(qpsValues(series.points, INTERVAL)).toEqual([null]);
  });
});

describe("errorRateValues", () => {
  it("computes errors over calls", () => {
    const series = buildHistorySeries([{ timestamp: at(0), calls: 200, errors: 10 }], {
      intervalMicros: INTERVAL,
    });
    expect(errorRateValues(series.points)).toEqual([0.05]);
  });

  /** "No errors out of nothing" is not a 0% error rate. */
  it("emits null when a window had no calls", () => {
    const series = buildHistorySeries(
      [{ timestamp: at(0), below_top_n: true, backfilled: true, calls: 0 }],
      { intervalMicros: INTERVAL },
    );
    expect(errorRateValues(series.points)).toEqual([null]);
  });
});
