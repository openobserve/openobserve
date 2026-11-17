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
import { isCompleteSearch } from "./searchComplete";

describe("isCompleteSearch", () => {
  const hits = [{ total_requests: 10, error_count: 0 }];

  it("accepts a whole response, with or without empty error fields", () => {
    expect(isCompleteSearch({ hits })).toBe(true);
    expect(isCompleteSearch({ hits: [], is_partial: false })).toBe(true);
    expect(isCompleteSearch({ hits, function_error: [], error: "" })).toBe(true);
  });

  it("rejects a partial response that still carries rows", () => {
    expect(isCompleteSearch({ hits, is_partial: true })).toBe(false);
  });

  it("rejects a response carrying a function error as a string or a list", () => {
    expect(isCompleteSearch({ hits, function_error: "Query duration is modified" })).toBe(false);
    expect(isCompleteSearch({ hits, function_error: ["", "partial data"] })).toBe(false);
  });

  it("rejects a response carrying a query error", () => {
    expect(isCompleteSearch({ hits, error: "Search stopped" })).toBe(false);
  });

  it("rejects a response with no rows array", () => {
    expect(isCompleteSearch(undefined)).toBe(false);
    expect(isCompleteSearch({})).toBe(false);
    expect(isCompleteSearch({ hits: null })).toBe(false);
  });
});
