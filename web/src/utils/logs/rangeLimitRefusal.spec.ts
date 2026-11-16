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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkRangeRefusal } from "./rangeLimitRefusal";
import { getConsumableRelativeTime } from "@/utils/date";

const HOUR_US = 3_600_000_000;

describe("linkRangeRefusal (R2, O1)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("refuses a relative link longer than the stream limit and offers the limit", () => {
    const r = getConsumableRelativeTime("7d")!;
    const datetime = {
      type: "relative",
      relativeTimePeriod: "7d",
      startTime: r.startTime,
      endTime: r.endTime,
    };
    expect(linkRangeRefusal(datetime, 24, "default")).toMatchObject({
      period: "7d",
      allowed: "1d",
      allowedPeriod: "24h",
      stream: "default",
    });
  });

  it("refuses an absolute link by its own bounds", () => {
    const end = Date.parse("2026-11-15T00:00:00Z") * 1000;
    const datetime = { type: "absolute", startTime: end - 48 * HOUR_US, endTime: end };
    expect(linkRangeRefusal(datetime, 24, "s")).toMatchObject({
      asked: { startUs: end - 48 * HOUR_US, endUs: end },
      period: null,
    });
  });

  it("lets a range within the limit, or a stream with no limit, through", () => {
    const r = getConsumableRelativeTime("1h")!;
    const inside = {
      type: "relative",
      relativeTimePeriod: "1h",
      startTime: r.startTime,
      endTime: r.endTime,
    };
    expect(linkRangeRefusal(inside, 24, "s")).toBeNull();
    const week = getConsumableRelativeTime("7d")!;
    const wide = {
      type: "relative",
      relativeTimePeriod: "7d",
      startTime: week.startTime,
      endTime: week.endTime,
    };
    expect(linkRangeRefusal(wide, 0, "s")).toBeNull();
    expect(linkRangeRefusal(wide, -1, "s")).toBeNull();
  });
});
