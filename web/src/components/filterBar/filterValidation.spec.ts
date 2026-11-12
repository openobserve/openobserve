// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import type { TranslateFn } from "@/types/i18n";
import type { FilterCondition, FilterGroup, FilterNode } from "@/utils/query/filterBar";
import { FILTER_PROFILES, type FilterProfile } from "./filterProfiles";
import { filterIssues } from "./filterValidation";

const t = ((key: string) => key) as unknown as TranslateFn;

const condition = (id: string, field: string, values = ["x"]): FilterCondition => ({
  kind: "condition",
  id,
  connector: "AND",
  field,
  operator: "eq",
  values,
});

const group = (id: string, items: FilterNode[]): FilterGroup => ({
  kind: "group",
  id,
  connector: "AND",
  items,
});

const issues = (tree: FilterGroup, profile: FilterProfile) =>
  filterIssues(tree, { ...profile, validate: undefined }, { t, saved: null });

describe("filterIssues", () => {
  it("counts a raw part inside a group as the filter a required profile needs", () => {
    const raw: FilterNode = { kind: "raw", id: "r", connector: "AND", label: "kept" };
    const required = { ...FILTER_PROFILES.pipeline, required: true };
    expect(issues(group("root", [group("g", [raw])]), required)).toEqual([]);
    expect(issues(group("root", [group("g", [])]), required)).toEqual([
      { nodeId: null, message: "filterBar.validation.required" },
    ]);
  });

  it("flags the second condition on a field when the profile allows one per field", () => {
    const unique = { ...FILTER_PROFILES.profiles, limits: { uniqueFields: true } };
    const tree = group("root", [condition("a", "env"), group("g", [condition("b", "env")])]);
    expect(issues(tree, unique)).toEqual([
      { nodeId: "b", message: "filterBar.validation.uniqueField" },
    ]);
    expect(issues(tree, { ...unique, limits: {} })).toEqual([]);
  });
});
