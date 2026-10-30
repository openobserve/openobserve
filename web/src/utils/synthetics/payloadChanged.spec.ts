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
import type { BrowserCheck } from "@/types/synthetics";
import { browserCheckChanged } from "./payloadChanged";

function check(schedule: Partial<BrowserCheck["schedule"]> = {}): BrowserCheck {
  return {
    name: "Cloud login",
    url: "https://app.test",
    enabled: true,
    tags: [],
    journey: [],
    schedule: {
      type: "interval",
      intervalValue: 5,
      intervalUnit: "minutes",
      startType: "later",
      startDate: "2026-10-01",
      startTime: "09:00",
      timezone: "UTC",
      ...schedule,
    },
    locations: ["us-east"],
    notifications: { destinations: [] },
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
  };
}

describe("browserCheckChanged", () => {
  it("is unchanged for the same check", () => {
    expect(browserCheckChanged(check(), check())).toBe(false);
  });

  it("counts a scheduled start date, time or timezone edit as a change", () => {
    expect(browserCheckChanged(check({ startDate: "2026-10-02" }), check())).toBe(true);
    expect(browserCheckChanged(check({ startTime: "10:30" }), check())).toBe(true);
    expect(browserCheckChanged(check({ timezone: "Asia/Kolkata" }), check())).toBe(true);
  });

  it("ignores the clock-derived start of two Schedule Now builds", () => {
    const now = { startType: "now" as const, startDate: undefined, startTime: undefined };
    expect(browserCheckChanged(check(now), check(now))).toBe(false);
  });
});
