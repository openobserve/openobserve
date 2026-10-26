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

import { afterEach, describe, expect, it, vi } from "vitest";
import store from "@/stores";
import { getConsumableRelativeTime } from "@/utils/date";
import { resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { periodToMicros, relativeWindow } from "@/utils/logs/estimateScanMb";

describe("calendar periods resolve in the store's timezone", () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem("timezone");
  });

  it("queries the window the picker shows when the store and stored zones differ", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T03:00:00Z"));
    localStorage.setItem("timezone", "America/New_York");
    store.state.timezone = "Asia/Tokyo";

    const picker = resolveCalendarPeriod("calendar:day:-1", store.state.timezone);
    expect(picker).toEqual({
      startTime: Date.parse("2026-10-25T15:00:00Z") * 1000,
      endTime: Date.parse("2026-10-26T14:59:59.999Z") * 1000,
    });
    expect(getConsumableRelativeTime("calendar:day:-1")).toEqual(picker);
    expect(relativeWindow("calendar:day:-1", Date.now() * 1000)).toEqual({
      startUs: picker!.startTime,
      endUs: picker!.endTime,
    });
    expect(periodToMicros("calendar:day:-1")).toBe(picker!.endTime - picker!.startTime);
  });
});
