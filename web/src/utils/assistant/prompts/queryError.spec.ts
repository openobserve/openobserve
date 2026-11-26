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
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { buildQueryErrorPrompt, errorPlainText, type QueryErrorInput } from "./queryError";

const input = (over: Partial<QueryErrorInput> = {}): QueryErrorInput => ({
  org: "default",
  streams: ["default"],
  language: "SQL",
  query: "SELEC * FROM default",
  error: "Search SQL not supported: sql parser error: Expected an SQL statement, found: SELEC",
  range: RANGE,
  timeZone: "UTC",
  ...over,
});

describe("buildQueryErrorPrompt", () => {
  it("pins the wording: language, stream and range; the error and query are chips", () => {
    const build = buildQueryErrorPrompt(input());
    expect(build.text).toBe(
      `This SQL query failed on \`default\` over ${RANGE_TEXT}. The error is in the attached Query error block. The query is in the attached Query block. What should I change?`,
    );
    expect(build.chips.map((c) => c.kind)).toEqual(["query_error", "query"]);
    expect(build.chips[0].label).toBe("Query error · Search SQL not supported: sql parser er…");
    expectPromptRules(build);
  });

  it("extracts HTML error text through a detached document, never running it (D10)", () => {
    const html = '<b>Bad</b> query<br><img src=x onerror="window.__pwned=1"><script>x()</script>';
    expect(errorPlainText(html)).toBe("Bad query");
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildQueryErrorPrompt(
      input({ streams: [INJECTION], language: INJECTION, query: INJECTION, error: INJECTION }),
    );
    expectNoInjection(build);
    expect(build.text.startsWith("This query failed over")).toBe(true);
  });
});
