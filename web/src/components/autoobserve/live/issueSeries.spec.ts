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
import {
  ISSUE_LEAD_MS,
  ISSUE_MAX_SPAN_MS,
  ISSUE_STEP_MS,
  hasRows,
  issueSeriesSql,
  issueWindow,
  toIssueSeries,
} from "./issueSeries";

const STEP = ISSUE_STEP_MS;
const T0 = Date.UTC(2026, 10, 10, 16, 45);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);

describe("issueWindow", () => {
  const H = 3_600_000;
  const D = 24 * H;
  it.each([
    [
      "an open incident runs to the last full bucket",
      null,
      true,
      T0 + 2 * H + 7 * 60_000,
      T0 + 2 * H,
      false,
    ],
    ["the detection bucket stays while it fills", null, true, T0 + 2 * 60_000, T0 + STEP, false],
    [
      "an ended incident stops an hour after its end",
      T0 + 20 * H,
      false,
      T0 + 3 * D,
      T0 + 21 * H,
      true,
    ],
    [
      "an end within the last hour still grows",
      T0 + H,
      false,
      T0 + H + 30 * 60_000,
      T0 + H + 30 * 60_000,
      false,
    ],
    [
      "a resolved incident with no end stops at the longest span",
      null,
      false,
      T0 + 30 * D,
      T0 - ISSUE_LEAD_MS + ISSUE_MAX_SPAN_MS,
      true,
    ],
  ])("%s", (_name, endMs, open, nowMs, end, fixed) => {
    const w = issueWindow(T0 * 1000, nowMs, endMs === null ? null : endMs * 1000, open);
    expect(w.startMs).toBe(T0 - ISSUE_LEAD_MS);
    expect([w.endMs, w.fixed]).toEqual([end, fixed]);
  });

  it("past seven days keeps the end, so now or the recovery stays on the chart", () => {
    const w = issueWindow(T0 * 1000, T0 + 10 * D, null, true);
    expect(w.endMs).toBe(T0 + 10 * D);
    expect(w.endMs - w.startMs).toBe(ISSUE_MAX_SPAN_MS);
  });
});

describe("toIssueSeries", () => {
  const w = {
    startMs: T0 - 4 * STEP,
    endMs: T0 + 4 * STEP,
    detectedMs: T0 + 5 * 60_000,
    fixed: false,
  };

  it("counts the usual level only from the first stored row, so an unknown start is never quiet", () => {
    const s = toIssueSeries(
      [
        { t: iso(T0 - 2 * STEP), n: 40 },
        { t: iso(T0 - STEP), n: 20 },
      ],
      w,
    );
    expect(s.firstRowIndex).toBe(2);
    expect(s.usual).toBe(30);
    const none = toIssueSeries([{ t: iso(T0 + 2 * STEP), n: 40 }], w);
    expect(none.firstRowIndex).toBe(6);
    expect(none.usual).toBeNull();
  });

  it("fills buckets the search left out with zero, since an absent bucket had no rows", () => {
    const s = toIssueSeries(
      [
        { t: iso(T0 - 4 * STEP), n: 10 },
        { t: iso(T0 - 3 * STEP), n: 30 },
        { t: iso(T0 - STEP), n: 20 },
      ],
      w,
    );
    expect(s.points).toEqual([10, 30, 0, 20, 0, 0, 0, 0]);
    expect(s.detectedIndex).toBe(4);
    expect(s.peak).toBe(30);
    expect(s.usual).toBe(15);
    expect(s.since).toBe(0);
    expect(hasRows(s)).toBe(true);
  });

  it("reads microsecond bucket times and ignores rows outside the window", () => {
    const s = toIssueSeries(
      [
        { t: (T0 + STEP) * 1000, n: 7 },
        { t: iso(T0 + 40 * STEP), n: 99 },
        { t: "not a time", n: 5 },
      ],
      w,
    );
    expect(s.points[5]).toBe(7);
    expect(s.peak).toBe(7);
  });

  it("a window with no rows has no rows, and no usual level when it starts at detection", () => {
    const s = toIssueSeries([], { startMs: T0, endMs: T0 + STEP, detectedMs: T0, fixed: true });
    expect(hasRows(s)).toBe(false);
    expect(s.usual).toBeNull();
  });
});

it("the SQL counts rows per 15 minutes and quotes the stream name", () => {
  expect(issueSeriesSql('pay"api')).toBe(
    `SELECT histogram(_timestamp, '15 minute') AS t, count(*) AS n FROM "payapi" GROUP BY t ORDER BY t`,
  );
});
