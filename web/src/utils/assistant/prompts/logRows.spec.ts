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

import {
  INJECTION,
  RANGE,
  RANGE_TEXT,
  ROW_US,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import {
  MAX_EXPLAIN_ROWS,
  buildLogRowsPrompt,
  reproducingQuery,
  rowsOverCap,
  type LogRowsInput,
} from "./logRows";

const rows = (n: number, size = 0) =>
  Array.from({ length: n }, (_, i) => ({
    _timestamp: ROW_US + i,
    code: 500 + i,
    blob: "x".repeat(size),
  }));

const input = (over: Partial<LogRowsInput> = {}): LogRowsInput => ({
  org: "default",
  stream: "cart",
  rows: rows(3),
  range: RANGE,
  timeZone: "UTC",
  query: "code >= 500",
  mode: "filter",
  ...over,
});

describe("buildLogRowsPrompt", () => {
  it("pins the wording; rows and both queries are chips", () => {
    const build = buildLogRowsPrompt(input());
    expect(build.text).toBe(
      `Explain these 3 log rows from \`cart\`. They were selected over ${RANGE_TEXT} (filter mode). The query that selected them and a query that reproduces them are in the attached Query block. What do they have in common, what differs, and what is the likely cause?`,
    );
    expectPromptRules(build);
  });

  it("stages one log_row chip with the count and a reproducing query bounded in WHERE (S5)", () => {
    const build = buildLogRowsPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "log_row",
      count: 3,
      label: "Log rows · 3 · cart",
    });
    expect(build.chips[1].data).toEqual({
      language: "filter",
      query: "code >= 500",
      reproduce: `SELECT * FROM "cart" WHERE (code >= 500) AND _timestamp >= ${ROW_US} AND _timestamp <= ${ROW_US + 2}`,
    });
    expect(build.title).toBe("Log rows · 3 · cart");
  });

  it("counts only the rows that fit the chip cap, in the text, label and chip (S5)", () => {
    const build = buildLogRowsPrompt(input({ rows: rows(20, 3000) }));
    const kept = (build.chips[0].data as unknown[]).length;
    expect(kept).toBeLessThan(20);
    expect(build.chips[0].count).toBe(kept);
    expect(build.text).toContain(`Explain these ${kept} log rows`);
    expect(build.title).toBe(`Log rows · ${kept} · cart`);
  });

  it("does not repeat the SQL in the reproducing query's WHERE", () => {
    expect(reproducingQuery(input({ mode: "sql", query: "SELECT a FROM cart" }))).toBe(
      `SELECT * FROM "cart" WHERE _timestamp >= ${ROW_US} AND _timestamp <= ${ROW_US + 2}`,
    );
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildLogRowsPrompt(
      input({ stream: INJECTION, query: INJECTION, rows: [{ m: INJECTION }] }),
    );
    expectNoInjection(build);
  });

  it("caps the selection at 20 rows and 64 KB", () => {
    expect(rowsOverCap(rows(MAX_EXPLAIN_ROWS))).toBe(false);
    expect(rowsOverCap(rows(MAX_EXPLAIN_ROWS + 1))).toBe(true);
    expect(rowsOverCap([{ blob: "x".repeat(70 * 1024) }])).toBe(true);
  });
});
