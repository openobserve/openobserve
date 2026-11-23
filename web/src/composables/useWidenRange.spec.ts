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
import { periodToLabel } from "./useWidenRange";

describe("useWidenRange", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    localStorage.setItem("timezone", "UTC");
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem("timezone");
  });

  it("labels rolling periods as before", () => {
    expect(periodToLabel("15m")).toBe("Past 15 Minutes");
    expect(periodToLabel("absolute")).toBe("");
  });

  it("labels a calendar period by its name, never as a NaN count", () => {
    expect(periodToLabel("calendar:month:-1")).toBe("Last month");
    expect(periodToLabel("calendar:day:0")).toBe("Today");
    expect(periodToLabel("calendar:quarter:-2")).toBe("Q2 2026");
    expect(periodToLabel("calendar:month:-1")).not.toContain("NaN");
  });
});
