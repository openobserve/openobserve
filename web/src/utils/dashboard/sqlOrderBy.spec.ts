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
import { firstTopLevelOrderByKey, hasTopLevelOrderBy } from "./sqlOrderBy";

describe("hasTopLevelOrderBy", () => {
  it("ignores ORDER BY inside literals, quoted identifiers, comments and parentheses", () => {
    expect(hasTopLevelOrderBy(`SELECT 'order by' AS s FROM t`)).toBe(false);
    expect(hasTopLevelOrderBy(`SELECT 'x' as "sort order by" FROM "pt"`)).toBe(false);
    expect(hasTopLevelOrderBy(`SELECT 1 as "a ""order by"" b" FROM t`)).toBe(false);
    expect(hasTopLevelOrderBy(`SELECT * FROM t -- order by y`)).toBe(false);
    expect(hasTopLevelOrderBy(`SELECT row_number() OVER (ORDER BY y) FROM t`)).toBe(false);
    expect(hasTopLevelOrderBy(`SELECT "order" FROM t ORDER BY "order"`)).toBe(true);
  });
});

describe("firstTopLevelOrderByKey", () => {
  it("returns the first sort key when it is a plain or quoted column", () => {
    expect(firstTopLevelOrderByKey(`SELECT * FROM t ORDER BY cat DESC LIMIT 5`)).toBe("cat");
    expect(firstTopLevelOrderByKey(`SELECT * FROM t ORDER BY "c""at" desc, v`)).toBe('c"at');
    expect(firstTopLevelOrderByKey(`SELECT * FROM t order by cat -- newest`)).toBe("cat");
    expect(firstTopLevelOrderByKey(`SELECT * FROM t ORDER BY cat NULLS LAST`)).toBe("cat");
  });

  it("returns null without a top-level ORDER BY or with an expression key", () => {
    expect(firstTopLevelOrderByKey(`SELECT * FROM t`)).toBeNull();
    expect(firstTopLevelOrderByKey(`SELECT * FROM t ORDER BY lower(cat)`)).toBeNull();
    expect(firstTopLevelOrderByKey(`SELECT * FROM t ORDER BY t.cat`)).toBeNull();
    expect(firstTopLevelOrderByKey(`SELECT * FROM (SELECT * FROM t ORDER BY cat)`)).toBeNull();
  });
});
