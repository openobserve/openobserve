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

import { panelBuild, pickerTimeMs } from "./panelDoors";

const MS = Date.UTC(2026, 9, 14, 13, 42, 0);

describe("pickerTimeMs", () => {
  it("reads a Date built from µs, as dashboards build them, as ms", () => {
    expect(pickerTimeMs(new Date(MS * 1000))).toBe(MS);
  });

  it("keeps a Date built from ms", () => {
    expect(pickerTimeMs(new Date(MS))).toBe(MS);
  });

  it("reads µs and ms numbers and ISO strings", () => {
    expect(pickerTimeMs(MS * 1000)).toBe(MS);
    expect(pickerTimeMs(MS)).toBe(MS);
    expect(pickerTimeMs(new Date(MS).toISOString())).toBe(MS);
  });

  it("rejects missing, invalid and non-positive values", () => {
    expect(pickerTimeMs(undefined)).toBeUndefined();
    expect(pickerTimeMs("not a date")).toBeUndefined();
    expect(pickerTimeMs(new Date(Number.NaN))).toBeUndefined();
    expect(pickerTimeMs(0)).toBeUndefined();
  });
});

describe("panelBuild", () => {
  it("states the dashboard's µs picker range in the prompt", async () => {
    const payload = await panelBuild(() => ({
      org: "default",
      panel: { id: "p1", title: "Errors", queries: [] },
      time: { start_time: new Date(MS * 1000), end_time: new Date((MS + 15 * 60_000) * 1000) },
      timeZone: "UTC",
    }))();
    expect(JSON.stringify(payload)).toContain("2026-10-14 13:42:00–13:57:00 UTC");
  });
});
