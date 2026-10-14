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
import { hasLineComment, stripSqlComments } from "@/utils/query/sqlComments";

describe("sqlComments", () => {
  it.each([
    ["status = 500 --404", "status = 500  "],
    ["status = 500 -- note", "status = 500  "],
    ["a = 1 /* c */AND b = 2", "a = 1  AND b = 2"],
    ["a = 1 -- x\nAND b = 2", "a = 1  \nAND b = 2"],
    ["msg = 'a -- b' -- c", "msg = 'a -- b'  "],
    ["msg = 'it''s /* x */'", "msg = 'it''s /* x */'"],
    ['"a--b" = 1', '"a--b" = 1'],
    ["a=1/*x*/b", "a=1 b"],
  ])("strips every comment outside a literal: %s", (raw, out) => {
    expect(stripSqlComments(raw)).toBe(out);
  });

  it.each([
    ["status = 500 --404", true],
    ["a = 1 -- x\nAND b = 2", true],
    ["msg = 'a -- b'", false],
    ["a = 1 /* -- */", false],
    ["a = 1", false],
  ])("finds a line comment outside literals and block comments: %s", (raw, found) => {
    expect(hasLineComment(raw)).toBe(found);
  });
});
