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
import { getEmptyBreakdownFilter } from "@/utils/logs/breakdownFilter";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";

const bare = (f: string) => f;

describe("getEmptyBreakdownFilter", () => {
  it("matches NULL and empty string rows on include", () => {
    expect(getEmptyBreakdownFilter("severity", "include", bare)).toBe(
      "(severity is null OR severity = '')",
    );
  });

  it("drops NULL and empty string rows on exclude", () => {
    expect(getEmptyBreakdownFilter("severity", "exclude", bare)).toBe(
      "(severity is not null AND severity != '')",
    );
  });

  it("quotes a field that needs quoting in every position", () => {
    const quoted = quoteSqlIdentifierIfNeeded("log level");
    expect(quoted).toBe('"log level"');
    expect(getEmptyBreakdownFilter("log level", "include", quoteSqlIdentifierIfNeeded)).toBe(
      `(${quoted} is null OR ${quoted} = '')`,
    );
    expect(getEmptyBreakdownFilter("log level", "exclude", quoteSqlIdentifierIfNeeded)).toBe(
      `(${quoted} is not null AND ${quoted} != '')`,
    );
  });
});
