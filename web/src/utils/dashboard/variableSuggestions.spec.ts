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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { getVariableSuggestions } from "@/utils/dashboard/variableSuggestions";

describe("getVariableSuggestions", () => {
  const t = i18n.global.t as unknown as TranslateFn;
  const suggest = (variables: any[], context = { tabId: "t1", panelId: "p1" }) =>
    getVariableSuggestions(variables, t, context);

  it("offers a single-value variable once, labelled by its type", () => {
    expect(
      suggest([
        { name: "cdu", type: "query_values", multiSelect: false },
        { name: "env", type: "constant" },
        { name: "q", type: "textbox" },
        { name: "pick", type: "custom" },
      ]),
    ).toEqual([
      { name: "cdu", description: "Query values" },
      { name: "env", description: "Constant" },
      { name: "q", description: "Text box" },
      { name: "pick", description: "Custom" },
    ]);
  });

  it("adds every list format the resolver supports for a multi-select variable", () => {
    expect(suggest([{ name: "rack", type: "query_values", multiSelect: true }])).toEqual([
      { name: "rack", description: "Query values · a, b" },
      { name: "rack:csv", description: "Commas: a,b" },
      { name: "rack:pipe", description: "Pipes: a|b" },
      { name: "rack:doublequote", description: 'Double quotes: "a","b"' },
      { name: "rack:singlequote", description: "Single quotes: 'a','b'" },
    ]);
  });

  it("skips ad hoc filters, duplicates, and variables scoped to another tab or panel", () => {
    const names = suggest([
      { name: "adhoc", type: "dynamic_filters" },
      { name: "a", type: "constant", scope: "global" },
      { name: "a", type: "constant", scope: "global" },
      { name: "here", type: "constant", scope: "tabs", tabs: ["t1"] },
      { name: "elsewhere", type: "constant", scope: "tabs", tabs: ["t2"] },
      { name: "mine", type: "constant", scope: "panels", panels: ["p1"] },
      { name: "theirs", type: "constant", scope: "panels", panels: ["p2"] },
    ]).map((s) => s.name);

    expect(names).toEqual(["a", "here", "mine"]);
  });

  it("keeps scoped variables when no tab or panel is given", () => {
    const scoped = [{ name: "here", type: "constant", scope: "tabs", tabs: ["t1"] }];
    expect(getVariableSuggestions(scoped, t).map((s) => s.name)).toEqual(["here"]);
  });

  it("returns nothing without variables", () => {
    expect(suggest(undefined as any)).toEqual([]);
  });
});
