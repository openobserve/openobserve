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

import { parseWhereClauseToFilterChecked } from "./sqlUtils";

describe("parseWhereClauseToFilterChecked with the real SQL parser", () => {
  it.each([
    ["NOT (level = 'info')", false],
    ["status BETWEEN 400 AND 450", false],
    ["level = 'error' OR NOT (service = 'api')", false],
    ["NOT str_match(message, 'info')", false],
    ["lower(level) = 'info'", false],
    ["level = 'info'", true],
    ["level = 'info' AND status > 5", true],
    ["level = lower('A')", false],
    ["a = b", false],
    ['level = "info"', false],
    ["level = 'x' AND a = b", false],
    ["1=1", true],
    ["status > 5", true],
    ["status >= -5", true],
    ["is_error = true", true],
    ["level != ''", true],
    ["str_match(message, 'x')", true],
    ["level IN ('a','b')", true],
    ["level LIKE 'x%'", true],
    ["a.level = 'x'", true],
    ["level IS NULL", true],
    ["\"level\" = 'x'", true],
  ])("%s -> complete=%s", async (where, complete) => {
    expect((await parseWhereClauseToFilterChecked(where)).complete).toBe(complete);
  });
});
