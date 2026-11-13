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
import { formatTypedTime, parseTypedTime } from "./parseTypedTime";

describe("parseTypedTime", () => {
  it.each([
    ["0930", "09:30:00"],
    ["930", "09:30:00"],
    ["9:5", "09:05:00"],
    ["23:59:59", "23:59:59"],
  ])("reads %s as %s", (typed, time) => {
    expect(formatTypedTime(parseTypedTime(typed)!)).toBe(time);
  });

  it.each(["25:00", "12:60", "12:00:60", "ab", "12:00:00.250", "12345"])("refuses %s", (typed) => {
    expect(parseTypedTime(typed)).toBeNull();
  });
});
