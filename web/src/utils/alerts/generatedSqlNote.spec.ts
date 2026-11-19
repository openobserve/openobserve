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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { generatedSqlNote } from "./generatedSqlNote";

const t = i18n.global.t as unknown as TranslateFn;
const AGG = 'SELECT "svc", avg(v) AS alert_agg_value FROM "s" GROUP BY "svc"';

describe("generatedSqlNote", () => {
  it.each([
    [
      "per group, stored in another unit",
      {
        sql: AGG,
        grouped: true,
        value: 500,
        unit: "milliseconds",
        stored: 500000,
        storedUnit: "microseconds",
      },
      ["500 ms (500,000 µs)", "alert_agg_value", "each group"],
    ],
    ["one result", { sql: AGG, grouped: false, value: 0.85 }, ["0.85", "alert_agg_value"]],
    ["rows", { sql: 'SELECT * FROM "s" WHERE a = 1', grouped: false, value: 50 }, ["50", "rows"]],
  ])("%s", (_, input, parts) => {
    const text = generatedSqlNote(input, t) ?? "";
    parts.forEach((part) => expect(text).toContain(part));
  });

  it("says nothing before a threshold is set", () => {
    expect(generatedSqlNote({ sql: AGG, grouped: true, value: null }, t)).toBeNull();
  });
});
