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

import { isTimeStamp } from "@/utils/dashboard/dateTimeUtils";
import { raw } from "@/types/i18n";

import { buildHistorySeries, errorRateValues, qpsValues, seriesValues } from "./history";
import {
  buildHistoryRows,
  buildInjectedHistoryData,
  buildLatencyPanelSchema,
  buildVolumePanelSchema,
} from "./historyPanelSchema";

const INTERVAL = 15 * 60 * 1_000_000;
const T0 = 1_700_000_000_000_000;
const at = (n: number) => T0 + n * INTERVAL;

const names = {
  p50: raw("p50"),
  p95: raw("p95"),
  p99: raw("p99"),
  qps: raw("Calls per second"),
  errorRate: raw("Failed calls"),
  time: raw("Time"),
};

const latency = () =>
  buildLatencyPanelSchema({ p50: names.p50, p95: names.p95, p99: names.p99, time: names.time });
const volume = () =>
  buildVolumePanelSchema({ qps: names.qps, errorRate: names.errorRate, time: names.time });

/** Reach into the schema without leaking `any` through every assertion. */
const config = (schema: Record<string, unknown>) => schema.config as Record<string, unknown>;
const firstQuery = (schema: Record<string, unknown>) =>
  (schema.queries as Record<string, unknown>[])[0];
const fieldsOf = (schema: Record<string, unknown>) =>
  firstQuery(schema).fields as Record<string, { alias: string }[]>;

describe("buildLatencyPanelSchema", () => {
  /**
   * Rollup metrics on this page are nanoseconds (`end_time - start_time`
   * undivided). A wrong unit makes the chart read 1000x off the headline stats
   * directly above it.
   */
  it("declares nanoseconds so the axis matches the page's other duration figures", () => {
    expect(config(latency()).unit).toBe("nanoseconds");
  });

  it("declares one y field per percentile so all three plot on one axis", () => {
    expect(fieldsOf(latency()).y.map((f) => f.alias)).toEqual(["p50", "p95", "p99"]);
  });

  /** A connected line across an unmeasured window claims we measured it. */
  it("never connects across a gap", () => {
    expect(config(latency()).connect_nulls).toBe(false);
  });

  it("shows a bottom legend, since three percentiles are indistinguishable without one", () => {
    expect(config(latency()).show_legends).toBe(true);
    expect(config(latency()).legends_position).toBe("bottom");
  });

  /**
   * Regression: the three percentiles all rendered the SAME colour, because the
   * schema asked for `palette-classic` + `fixedColor` — a combination the
   * renderer silently discards (getSeriesColor returns null for that mode and
   * never reads fixedColor). `fixed` is not the fix either: it collapses every
   * series onto fixedColor[0]. Only the by-series mode gives one colour per
   * percentile, so assert the mode rather than a colour list nothing consumes.
   */
  it("gives each percentile its own colour", () => {
    const color = config(latency()).color as { mode: string; fixedColor?: string[] };
    expect(color.mode).toBe("palette-classic-by-series");
    expect(color.fixedColor).toBeUndefined();
  });

  /**
   * Both volume series are pinned by name: failures are red because that is
   * meaning, and calls is pinned too because name-hashing picked magenta for
   * ordinary throughput.
   *
   * Regression guard on the second bug here: `colorBySeries` colours reach
   * ECharts VERBATIM (getSeriesColor returns customMapping.color with no
   * resolution, unlike the palette), so an unresolved `--color-*` token name
   * paints the bars black. Assert a real colour value, never a token name.
   */
  it("pins both volume series to resolved colour values, not token names", () => {
    const color = config(volume()).color as {
      colorBySeries: { value: string; color: string }[];
    };
    expect(color.colorBySeries.map((e) => e.value)).toEqual([names.qps, names.errorRate]);
    for (const entry of color.colorBySeries) {
      expect(entry.color.startsWith("--")).toBe(false);
      expect(entry.color.length).toBeGreaterThan(0);
    }
  });

  /**
   * The injected-data path short-circuits the fetch, but the renderer's
   * `hasAtLeastOneQuery()` gate still runs first — an empty query string falls
   * through to the empty state instead of drawing.
   */
  it("carries a non-empty query so the renderer's has-a-query gate passes", () => {
    expect(String(firstQuery(latency()).query).length).toBeGreaterThan(0);
    expect(firstQuery(latency()).customQuery).toBe(true);
  });
});

describe("buildVolumePanelSchema", () => {
  /**
   * A call RATE is routinely sub-1 (once a minute is 0.017/s), so rounding to
   * whole numbers would collapse every such bar label to "0".
   */
  it("is a bar chart keeping enough precision for a sub-1 call rate", () => {
    expect(volume().type).toBe("bar");
    expect(config(volume()).unit).toBe("numbers");
    expect(config(volume()).decimals).toBe(2);
  });

  it("declares the call rate and the failure rate as two y fields", () => {
    expect(fieldsOf(volume()).y.map((f) => f.alias)).toEqual(["qps", "error_rate"]);
  });
});

describe("buildHistoryRows", () => {
  const series = buildHistorySeries(
    [
      { timestamp: at(0), calls: 10, errors: 1, p50_ns: 10, p95_ns: 100, p99_ns: 200 },
      { timestamp: at(1), below_top_n: true },
      { timestamp: at(2), calls: 20, errors: 0, p50_ns: 12, p95_ns: 120, p99_ns: 240 },
    ],
    { intervalMicros: INTERVAL },
  );

  const rows = () =>
    buildHistoryRows(series.points, {
      p50: seriesValues(series.points, "p50_ns"),
      p95: seriesValues(series.points, "p95_ns"),
      p99: seriesValues(series.points, "p99_ns"),
    });

  it("emits one row per window, aligned with the points", () => {
    expect(rows()).toHaveLength(series.points.length);
    expect(rows().map((r) => r.ts)).toEqual([at(0), at(1), at(2)]);
  });

  /**
   * The one bug the history module exists to prevent: an unmeasured window
   * means "this query ranked below the top-N cut here", and a zero says "the
   * query stopped running" — mid-incident that reads as recovered.
   */
  it("keeps an unmeasured window null rather than coercing it to zero", () => {
    expect(rows()[1].p95).toBeNull();
  });

  /**
   * The x column must stay a 16-digit MICROsecond value: that is exactly what
   * `isTimeStamp` matches to promote the axis to a real time axis. A
   * millisecond value is 13 digits and renders as a category axis of unreadable
   * integers instead.
   */
  it("emits a microsecond timestamp the converter recognises as a time axis", () => {
    expect(
      isTimeStamp(
        rows().map((r) => r.ts),
        null,
      ),
    ).toBe(true);
  });

  it("carries the volume series under their own aliases", () => {
    const volumeRows = buildHistoryRows(series.points, {
      qps: qpsValues(series.points, INTERVAL),
      error_rate: errorRateValues(series.points),
    });
    expect(Object.keys(volumeRows[0]).sort()).toEqual(["error_rate", "qps", "ts"]);
  });
});

describe("buildInjectedHistoryData", () => {
  const window = { startTime: at(0), endTime: at(3) };
  const envelope = () => buildInjectedHistoryData([{ ts: at(0), p95: 1 }], window);

  it("nests the rows one level deep, as one entry per query", () => {
    expect(envelope().data).toEqual([[{ ts: at(0), p95: 1 }]]);
  });

  /**
   * `sqlTimeSeriesConverter` dereferences `timeRangeGap.seconds` WITHOUT
   * optional-chaining, so omitting it throws mid-conversion and the panel
   * renders blank rather than erroring visibly.
   */
  it("carries timeRangeGap, which the time-axis converter dereferences unguarded", () => {
    const query = (envelope().metadata.queries as Record<string, unknown>[])[0];
    expect(query.timeRangeGap).toEqual({ seconds: 0 });
  });

  it("passes the queried window through so the axis pins to it", () => {
    const query = (envelope().metadata.queries as Record<string, unknown>[])[0];
    expect(query.startTime).toBe(window.startTime);
    expect(query.endTime).toBe(window.endTime);
  });

  /** The missing-value filler calls `.map()` on each query's slot. */
  it("makes resultMetaData a 2D array", () => {
    expect(envelope().resultMetaData).toEqual([[]]);
    expect(Array.isArray(envelope().resultMetaData[0])).toBe(true);
  });
});
