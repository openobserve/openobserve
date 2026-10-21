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

import { INJECTION, RANGE, RANGE_TEXT, expectNoInjection } from "./__fixtures__/prompts";
import { buildEmptyResultPrompt, type EmptyResultInput } from "./emptyResult";

const input = (over: Partial<EmptyResultInput> = {}): EmptyResultInput => ({
  org: "default",
  streams: ["default", "k8s_events"],
  mode: "sql",
  query: "SELECT * FROM default WHERE code = 999",
  range: RANGE,
  timeZone: "UTC",
  ...over,
});

describe("buildEmptyResultPrompt", () => {
  it("SQL mode: names SQL, every stream and the absolute range, asks what excludes rows (D4b–d)", () => {
    const build = buildEmptyResultPrompt(input());
    expect(build.text).toBe(
      `This SQL query returned no rows from \`default\`, \`k8s_events\` over ${RANGE_TEXT}. The query is in the attached Query block. What in this SQL excludes rows? Suggest a change and the range to try.`,
    );
    expect(build.text).not.toMatch(/\b15m\b|adjust the filter/);
    expect(build.chips[0].data).toEqual({ language: "SQL", query: input().query });
    expect(build.title).toBe("Empty results · default, k8s_events");
  });

  it("filter mode asks which part of the filter is too narrow", () => {
    const build = buildEmptyResultPrompt(input({ mode: "filter", query: "code=999" }));
    expect(build.text).toContain("This filter query returned no rows");
    expect(build.text).toContain("Which part of the filter is too narrow?");
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(buildEmptyResultPrompt(input({ streams: [INJECTION], query: INJECTION })));
  });
});
