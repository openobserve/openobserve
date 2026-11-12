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

import { describe, expect, it, vi } from "vitest";
import { DISTRIBUTION_ROW_LIMIT } from "./chartTypeGroups";
import { hitRawRowCap, rawRowLimitHelp, rawSampleNote } from "./rawRowCap";

vi.mock("./chartTypeGroups", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isRawValueChart: (type: unknown) => type === "raw-test",
}));

const panel = (config: any = {}, customQuery = false) => ({
  queries: [{ customQuery, config }],
});
const rows = (count: number) => [Array.from({ length: count }, (_, i) => ({ y: i }))];

describe("raw row cap", () => {
  it("reports a sample when a builder query with no limit returns the capped row count", () => {
    expect(hitRawRowCap(panel(), rows(DISTRIBUTION_ROW_LIMIT))).toBe(true);
  });

  it("does not report a sample below the cap, with a limit set, or for custom SQL", () => {
    expect(hitRawRowCap(panel(), rows(DISTRIBUTION_ROW_LIMIT - 1))).toBe(false);
    expect(hitRawRowCap(panel({ limit: 50000 }), rows(DISTRIBUTION_ROW_LIMIT))).toBe(false);
    expect(hitRawRowCap(panel({}, true), rows(DISTRIBUTION_ROW_LIMIT))).toBe(false);
    expect(hitRawRowCap(panel(), [])).toBe(false);
  });

  it("builds a silent text note naming the cap", () => {
    const note = rawSampleNote();
    expect(note).toMatchObject({ type: "text", silent: true });
    expect(typeof note.style.text).toBe("string");
  });

  it("shows the effective cap under Query Limit only for a raw-value chart left at 0", () => {
    expect(rawRowLimitHelp("raw-test", 0)).toContain("10,000");
    expect(rawRowLimitHelp("raw-test", null)).toContain("10,000");
    expect(rawRowLimitHelp("raw-test", 500)).toBeUndefined();
    expect(rawRowLimitHelp("line", 0)).toBeUndefined();
  });
});
