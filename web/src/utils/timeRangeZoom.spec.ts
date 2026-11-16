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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { toZonedTime } from "date-fns-tz";
import { convertLogData } from "@/utils/logs/convertLogData";
import { histogramDateTimezone } from "@/utils/timezone";
import { instantFromShiftedMs, snapZoomToBuckets } from "./timeRangeZoom";

const KOLKATA = "Asia/Kolkata";

describe("drag-zoom values from a zone-shifted chart", () => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("recovers the true instants of a range across the browser's DST gap", () => {
    // New York springs forward on 2026-03-08 at 02:00; Kolkata 01:00–04:00 that day spans it on the chart's clock.
    const start = Date.UTC(2026, 2, 7, 19, 30);
    const end = Date.UTC(2026, 2, 7, 22, 30);
    const shiftedStart = toZonedTime(start, KOLKATA).getTime();
    const shiftedEnd = toZonedTime(end, KOLKATA).getTime();
    expect(instantFromShiftedMs(shiftedStart, KOLKATA)).toBe(start * 1000);
    expect(instantFromShiftedMs(shiftedEnd, KOLKATA)).toBe(end * 1000);
  });

  it("recovers instants on either side of the browser's DST fall-back", () => {
    for (const hour of [4, 5, 6, 7]) {
      const instant = Date.UTC(2026, 10, 1, hour, 15);
      const shifted = toZonedTime(instant, KOLKATA).getTime();
      expect(instantFromShiftedMs(shifted, KOLKATA)).toBe(instant * 1000);
    }
  });

  it("recovers the instant when the browser zone is the app zone", () => {
    process.env.TZ = KOLKATA;
    const instant = Date.UTC(2026, 10, 11, 7, 12, 30);
    expect(instantFromShiftedMs(toZonedTime(instant, KOLKATA).getTime(), KOLKATA)).toBe(
      instant * 1000,
    );
  });
});

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SPIKE = 6;

// The Logs histogram as built in the app: bucket keys → useHistogram's xData → convertLogData → ECharts.
const renderHistogram = (
  zone: string,
  intervalMs: number,
  first = Date.UTC(2026, 10, 15, 18, 0),
  spike = SPIKE,
) => {
  const keys = Array.from({ length: 12 }, (_, i) =>
    new Date(first + i * intervalMs).toISOString().slice(0, 19),
  );
  const counts = keys.map((_, i) => (i === spike ? 122 : 3));
  const xData = keys.map((key) => histogramDateTimezone(key, zone));
  const { options } = convertLogData(xData, counts, {
    title: "",
    unparsed_x_data: keys,
    timezone: zone,
  });
  const chart = echarts.init(null as any, null, {
    renderer: "svg",
    ssr: true,
    width: 800,
    height: 120,
  });
  chart.setOption(options);
  const bar = (chart as any).getModel().getSeriesByIndex(0).getData().getItemLayout(spike);
  const valueAt = (px: number) => chart.convertFromPixel({ xAxisIndex: 0 }, px) as number;
  // A drag from the bar's left edge to its right edge, as ECharts hands it to the page.
  const brush = { start: valueAt(bar.x), end: valueAt(bar.x + bar.width) };
  const originMs = Number(options.series[0].data[0][0]);
  chart.dispose();
  return { brush, originMs, bucketStartMs: first + spike * intervalMs };
};

describe("drag-zoom over a Logs histogram bar [Bug 1, Bug 2]", () => {
  let originalTz: string | undefined;
  beforeEach(() => {
    originalTz = process.env.TZ;
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each([
    ["Asia/Kolkata", "UTC", HOUR_MS],
    ["Asia/Kolkata", "Asia/Kolkata", MINUTE_MS],
    ["America/New_York", "Europe/Berlin", 5 * MINUTE_MS],
    ["UTC", "UTC", MINUTE_MS],
  ])(
    "lands on the bar's own bucket (zone %s, browser %s, %d ms buckets)",
    (zone, browser, interval) => {
      process.env.TZ = browser;
      const { brush, originMs, bucketStartMs } = renderHistogram(zone, interval);
      const asInstant = (shiftedMs: number) => instantFromShiftedMs(shiftedMs, zone) / 1000;

      // Unsnapped, the window straddles the bucket start: half of it is the bucket before.
      expect(asInstant(Math.floor(brush.start))).toBeLessThan(bucketStartMs);
      expect(asInstant(Math.floor(brush.end))).toBeLessThan(bucketStartMs + interval);

      const snapped = snapZoomToBuckets(brush.start, brush.end, interval, originMs);
      expect(asInstant(snapped.start)).toBe(bucketStartMs);
      expect(asInstant(snapped.end)).toBe(bucketStartMs + interval);
    },
  );

  it.each(["UTC", "America/New_York", "Asia/Kolkata"])(
    "lands on a daily bar past a DST change in the chart zone (browser %s)",
    (browser) => {
      process.env.TZ = browser;
      const zone = "America/New_York";
      // Mar 1–12, 2026 UTC days; New York springs forward on Mar 8, before the Mar 9 bar.
      const { brush, originMs, bucketStartMs } = renderHistogram(
        zone,
        DAY_MS,
        Date.UTC(2026, 2, 1),
        8,
      );
      const asInstant = (shiftedMs: number) => instantFromShiftedMs(shiftedMs, zone) / 1000;

      const snapped = snapZoomToBuckets(brush.start, brush.end, DAY_MS, originMs, zone);
      expect(new Date(asInstant(snapped.start)).toISOString()).toBe("2026-03-09T00:00:00.000Z");
      expect(asInstant(snapped.start)).toBe(bucketStartMs);
      expect(asInstant(snapped.end)).toBe(bucketStartMs + DAY_MS);
    },
  );
});

describe("snapZoomToBuckets", () => {
  const origin = Date.UTC(2026, 10, 16, 0, 0);

  it("takes whole buckets from the bar under each edge, bars centred on their start", () => {
    const at = (minutes: number) => origin + minutes * MINUTE_MS;
    expect(snapZoomToBuckets(at(4.6), at(7.2), MINUTE_MS, origin)).toEqual({
      start: at(5),
      end: at(8),
    });
    expect(snapZoomToBuckets(at(4.4), at(4.45), MINUTE_MS, origin)).toEqual({
      start: at(4),
      end: at(5),
    });
  });

  it("aligns to epoch multiples when no origin is given", () => {
    const start = Date.UTC(2026, 10, 16, 0, 59, 40, 724);
    const end = Date.UTC(2026, 10, 16, 3, 20, 10, 5);
    expect(snapZoomToBuckets(start, end, HOUR_MS)).toEqual({
      start: Date.UTC(2026, 10, 16, 1),
      end: Date.UTC(2026, 10, 16, 4),
    });
  });

  it("never carries pixel milliseconds into the range", () => {
    const start = Date.UTC(2026, 10, 16, 20, 1, 49, 724);
    const end = Date.UTC(2026, 10, 16, 20, 7, 3, 311);
    for (const interval of [1000, 10_000, MINUTE_MS, 5 * MINUTE_MS, HOUR_MS]) {
      const snapped = snapZoomToBuckets(start, end, interval);
      expect(snapped.start % 1000).toBe(0);
      expect(snapped.end % 1000).toBe(0);
      expect(snapped.end).toBeGreaterThan(snapped.start);
    }
  });

  it("snaps to whole seconds when the bucket is under a second or unknown", () => {
    const start = Date.UTC(2026, 10, 16, 20, 1, 49, 724);
    const end = Date.UTC(2026, 10, 16, 20, 1, 52, 311);
    const whole = {
      start: Date.UTC(2026, 10, 16, 20, 1, 49),
      end: Date.UTC(2026, 10, 16, 20, 1, 53),
    };
    expect(snapZoomToBuckets(start, end, 100)).toEqual(whole);
    expect(snapZoomToBuckets(start, end, 0)).toEqual(whole);
    expect(snapZoomToBuckets(start, end, Number.NaN)).toEqual(whole);
  });

  it("keeps at least one second for a click-sized drag inside one second", () => {
    const at = Date.UTC(2026, 10, 16, 20, 1, 49, 100);
    expect(snapZoomToBuckets(at, at + 50, 100)).toEqual({
      start: Date.UTC(2026, 10, 16, 20, 1, 49),
      end: Date.UTC(2026, 10, 16, 20, 1, 50),
    });
  });
});
