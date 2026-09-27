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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { alertHistoryQuery } from "./alerts.queries";
import alerts from "./alerts";

vi.mock("./alerts", () => ({
  default: { getHistory: vi.fn().mockResolvedValue({ data: { hits: [], total: 0 } }) },
}));

const ORG = "test-org";
// 5 s past a minute boundary, in microseconds, so +20 s stays inside the same bucket.
const END_US = 1_700_000_045_000_000;
const START_US = END_US - 5 * 60 * 1_000_000;
const BUCKETED_END_US = Math.floor(END_US / 60_000_000) * 60_000_000;

describe("alertHistoryQuery", () => {
  beforeEach(() => {
    vi.mocked(alerts.getHistory).mockClear();
  });

  it("buckets the window in the key so two opens inside the same minute share one entry", () => {
    const first = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US,
      end_time: END_US,
    });
    // 20 s later: a different raw `now`, the same minute.
    const second = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US + 20_000_000,
      end_time: END_US + 20_000_000,
    });
    expect(first.queryKey).toEqual(second.queryKey);
    expect(JSON.stringify(first.queryKey)).toContain(String(BUCKETED_END_US));
  });

  it("requests the caller's exact window — a bucketed end hides the current minute's evaluations", async () => {
    const options = alertHistoryQuery(ORG, {
      alert_id: "a1",
      start_time: START_US,
      end_time: END_US,
    });
    await (options.queryFn as any)();
    expect(alerts.getHistory).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ start_time: START_US, end_time: END_US }),
    );
  });
});
