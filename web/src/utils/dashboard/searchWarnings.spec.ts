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
import { collectSearchWarnings } from "@/utils/dashboard/searchWarnings";

// The message the backend emits when a query without an explicit LIMIT returns
// more than ZO_QUERY_DEFAULT_LIMIT rows (src/search/src/lib.rs CAPPED_RESULTS_MSG).
const CAPPED = "Warn: results are capped to meet default limit";

describe("collectSearchWarnings", () => {
  describe("empty input", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty array", []],
      // The 2D array is the real shape; a bare object carries no query entries.
      ["a non-array", {}],
    ])("returns no warnings for %s", (_name, input) => {
      expect(collectSearchWarnings(input)).toEqual([]);
    });

    it("returns no warnings when results carry no function_error", () => {
      expect(collectSearchWarnings([[{ hits: [1, 2, 3], is_partial: false }]])).toEqual([]);
    });

    it.each([
      ["an empty list", []],
      ["an empty string", ""],
      ["null", null],
    ])("ignores a function_error of %s", (_name, functionError) => {
      expect(collectSearchWarnings([[{ function_error: functionError }]])).toEqual([]);
    });
  });

  describe("streaming shape (array of chunks per query)", () => {
    it("surfaces the capped-results warning", () => {
      const meta = [[{ function_error: [CAPPED], is_partial: true }]];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED]);
    });

    it("collapses the warning repeated across chunks", () => {
      const meta = [
        [{ function_error: [CAPPED] }, { function_error: [CAPPED] }, { function_error: [CAPPED] }],
      ];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED]);
    });

    it("keeps distinct warnings from the same chunk", () => {
      const meta = [[{ function_error: [CAPPED, "vrl error: field missing"] }]];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED, "vrl error: field missing"]);
    });
  });

  describe("legacy shape (single metadata object per query)", () => {
    it("surfaces the capped-results warning", () => {
      expect(collectSearchWarnings([{ function_error: [CAPPED] }])).toEqual([CAPPED]);
    });

    it("accepts function_error as a bare string", () => {
      expect(collectSearchWarnings([{ function_error: CAPPED }])).toEqual([CAPPED]);
    });
  });

  describe("multiple queries", () => {
    it("gathers warnings across every query", () => {
      const meta = [[{ function_error: [CAPPED] }], [{ function_error: ["second query warning"] }]];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED, "second query warning"]);
    });

    it("deduplicates the same warning raised by several queries", () => {
      const meta = [[{ function_error: [CAPPED] }], [{ function_error: [CAPPED] }]];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED]);
    });

    it("skips holes left by queries that returned nothing", () => {
      const meta = [null, undefined, [{ function_error: [CAPPED] }]];
      expect(collectSearchWarnings(meta)).toEqual([CAPPED]);
    });
  });

  it("preserves first-seen order", () => {
    const meta = [[{ function_error: ["first"] }, { function_error: ["second", "first"] }]];
    expect(collectSearchWarnings(meta)).toEqual(["first", "second"]);
  });

  it("coerces non-string warnings rather than dropping them", () => {
    expect(collectSearchWarnings([[{ function_error: [42] }]])).toEqual(["42"]);
  });
});
