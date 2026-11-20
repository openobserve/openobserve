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

import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";

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
    ["1=1", false],
    ["1=1 AND level='info'", false],
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

describe("chart SQL generated from the checked filter", () => {
  const panel: any = {
    data: { queries: [{ fields: { stream: "logs" }, joins: [] }] },
    layout: { currentQueryIndex: 0 },
    meta: {
      streamFields: {
        groupedFields: [
          {
            stream_alias: null,
            schema: [
              { name: "level", type: "Utf8" },
              { name: "message", type: "Utf8" },
              { name: "status", type: "Int64" },
              { name: "is_error", type: "Boolean" },
            ],
          },
        ],
      },
    },
  };
  const chartSql = async (where: string) => {
    const { filter, complete } = await parseWhereClauseToFilterChecked(where);
    return { complete, sql: buildCondition(filter, panel) };
  };

  it.each([
    ["level = 'info'", "(level = 'info')"],
    ["status >= 5 AND is_error = true", "(status >= 5 AND is_error = true)"],
    [
      "level = 'a' AND (status > 1 OR is_error = true)",
      "(level = 'a' AND (status > 1 OR is_error = true))",
    ],
    ["is_error IS NULL", "(is_error IS NULL)"],
    ["is_error IS NOT NULL", "(is_error IS NOT NULL)"],
    ["str_match(message, 'x')", "(str_match(message, 'x'))"],
    ["str_match_ignore_case(message, 'a')", "(str_match_ignore_case(message, 'a'))"],
    ["re_match(message, 'a.*')", "(re_match(message, 'a.*'))"],
    ["match_all('x')", "(match_all('x'))"],
    ["level IN ('a','b')", "(level IN ('a', 'b'))"],
    ["status IN (1,2)", "(status IN (1, 2))"],
    ["level NOT IN ('a','b')", "(level NOT IN ('a', 'b'))"],
    ["level LIKE 'a%'", "(level LIKE 'a%')"],
    ["level LIKE '%a'", "(level LIKE '%a')"],
    ["level LIKE '%a%'", "(str_match(level, 'a'))"],
    ["level NOT LIKE '%a%'", "(level NOT LIKE '%a%')"],
  ])("charts %s as the same filter", async (where, sql) => {
    expect(await chartSql(where)).toEqual({ complete: true, sql });
  });

  it.each([
    "is_error IS TRUE",
    "is_error IS FALSE",
    "is_error IS NOT TRUE",
    "is_error IS NOT FALSE",
    "is_error IS UNKNOWN",
    "str_match(lower(message), 'error')",
    "str_match(message, lower('x'))",
    "match_all(lower('x'))",
    "level IN (lower('a'))",
    "level IN ('a', NULL)",
    "level = NULL",
    "level LIKE 'abc'",
    "level LIKE 'a%b'",
    "level LIKE '%a_b%'",
    "level NOT LIKE 'a%'",
  ])("holds %s because the builder would change its meaning", async (where) => {
    expect((await chartSql(where)).complete).toBe(false);
  });
});
