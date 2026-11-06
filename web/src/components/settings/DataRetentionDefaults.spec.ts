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
import { makeDataRetentionDefaultsSchema } from "./DataRetentionDefaults.schema";

const schema = makeDataRetentionDefaultsSchema((key) => key);
const acceptsDefault = (value: unknown) => schema.safeParse({ default: value, types: [] }).success;
const acceptsRow = (type: string, days: unknown) =>
  schema.safeParse({ default: "", types: [{ type, days }] }).success;

describe("DataRetentionDefaults schema", () => {
  it("accepts an empty default, 0 and at least 3 days with no upper limit", () => {
    for (const value of ["", null, undefined, 0, "0", 3, "3", 180, 100000]) {
      expect(acceptsDefault(value)).toBe(true);
    }
  });

  it("rejects values below 3 days, negatives and fractions", () => {
    for (const value of [1, 2, "2", -1, 3.5, "abc"]) {
      expect(acceptsDefault(value)).toBe(false);
      expect(acceptsRow("logs", value)).toBe(false);
    }
  });

  it("requires days on a row, and accepts only the configurable types", () => {
    expect(acceptsRow("metrics", 180)).toBe(true);
    expect(acceptsRow("profiles", 3)).toBe(true);
    expect(acceptsRow("metrics", "")).toBe(false);
    for (const type of [
      "metadata",
      "index",
      "service_graph",
      "enrichment_tables",
      "file_list",
      "",
    ]) {
      expect(acceptsRow(type, 30)).toBe(false);
    }
  });
});
