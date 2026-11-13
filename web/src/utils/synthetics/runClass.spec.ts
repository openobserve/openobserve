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
import { statusFromRunClass, utcClock } from "./runClass";

describe("statusFromRunClass", () => {
  it.each([
    [1, "passed"],
    [2, "partial"],
    [3, "failed"],
    [4, "not_measured"],
    [5, "misconfigured"],
  ])("should badge run class %i as %s", (runClass, status) => {
    expect(statusFromRunClass(runClass, "error")).toBe(status);
  });

  it("should fall back to last_check_status without a run class", () => {
    expect(statusFromRunClass(0, "error")).toBe("error");
    expect(statusFromRunClass(undefined, "passed")).toBe("passed");
    expect(statusFromRunClass(null, "warning")).toBe("warning");
    expect(statusFromRunClass(9, "unknown")).toBe("unknown");
  });
});

describe("utcClock", () => {
  it("should print hours and minutes in UTC", () => {
    expect(utcClock(Date.UTC(2026, 10, 3, 10, 36, 59) * 1000)).toBe("10:36 UTC");
  });
});
