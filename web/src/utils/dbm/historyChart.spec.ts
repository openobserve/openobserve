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

import { buildSamplesOption } from "./historyChart";

const INTERVAL = 15 * 60 * 1_000_000;
const T0 = 1_700_000_000_000_000;
const at = (n: number) => T0 + n * INTERVAL;

const theme = {
  calls: "#4",
  errors: "#5",
  axisLabel: "#7",
  splitLine: "#8",
};

const formatNs = (value: number | null | undefined) => (value == null ? "—" : `${value}ns`);

/** Reach into the option's series array without leaking `any` into the tests. */
const seriesOf = (option: Record<string, unknown>) => option.series as Record<string, unknown>[];

describe("buildSamplesOption", () => {
  const samples = [
    { timestamp: at(0), durationNs: 100, isError: false },
    { timestamp: at(1), durationNs: 900, isError: true },
  ];

  it("separates errored samples into their own series", () => {
    const option = buildSamplesOption(samples, theme, formatNs, String, {
      ok: "ok",
      error: "error",
    });
    const series = seriesOf(option);
    expect(series.find((s) => s.name === "ok")?.data).toEqual([[at(0), 100]]);
    expect(series.find((s) => s.name === "error")?.data).toEqual([[at(1), 900]]);
  });

  /** Spread across time AND duration — the distribution, not only the tail. */
  it("plots on a time x-axis so the spread over the window is visible", () => {
    const option = buildSamplesOption(samples, theme, formatNs, String, {
      ok: "ok",
      error: "error",
    });
    expect((option.xAxis as Record<string, unknown>).type).toBe("time");
    expect(seriesOf(option).every((s) => s.type === "scatter")).toBe(true);
  });

  /**
   * The click pivot maps a clicked datum back to its sample by matching
   * `[timestamp, durationNs]`, so the point must stay a bare pair — a styled
   * `{ value }` object would break the lookup silently.
   */
  it("emits bare [timestamp, duration] pairs so the trace pivot can match them", () => {
    const option = buildSamplesOption(samples, theme, formatNs, String, {
      ok: "ok",
      error: "error",
    });
    for (const entry of seriesOf(option)) {
      for (const point of entry.data as unknown[]) {
        expect(Array.isArray(point)).toBe(true);
      }
    }
  });
});
