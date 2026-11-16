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
import { shortList } from "./shortList";

describe("shortList", () => {
  it.each([
    [[], ""],
    [["dev"], "dev"],
    [["dev", "prod"], "dev and prod"],
    [["dev", "prod", "qa"], "dev and 2 more"],
    [["a", "b", "c", "d", "e"], "a and 4 more"],
    [["dev", "", " "], "dev"],
  ])("lists %j as %s", (names, expected) => {
    expect(shortList(names, 1, "en", (count) => `${count} more`)).toBe(expected);
  });
});
