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
import { nextTick, ref } from "vue";
import type { FilterCondition, FilterGroup, FilterNode } from "@/utils/query/filterBar";
import {
  enclosingGroupIds,
  groupSummary,
  useFilterBarFolds,
  type FilterGroupSummaryText,
} from "./useFilterBarFolds";

const cond = (id: string, connector: "AND" | "OR" = "AND"): FilterCondition => ({
  kind: "condition",
  id,
  connector,
  field: id,
  operator: "eq",
  values: ["1"],
});
const grp = (id: string, items: FilterNode[], connector: "AND" | "OR" = "AND"): FilterGroup => ({
  kind: "group",
  id,
  connector,
  items,
});

const text = (connectorMode: FilterGroupSummaryText["connectorMode"]): FilterGroupSummaryText => ({
  describe: (node) => (node.kind === "raw" ? node.label : `${node.field} = ${node.values[0]}`),
  more: (count) => `${count} more`,
  connectorMode,
});

// root(L1) > g2 > g3 > g4 > g5
const tree = (): FilterGroup =>
  grp("root", [
    cond("a"),
    grp("g2", [cond("b"), grp("g3", [cond("c"), grp("g4", [cond("d"), grp("g5", [cond("e")])])])]),
  ]);

describe("groupSummary", () => {
  it("writes two items, nested groups as (…), then the next connector and the rest", () => {
    const group = grp("g", [cond("a"), grp("n", [cond("x")], "OR"), cond("b", "OR"), cond("c")]);
    expect(groupSummary(group, text("per-item"))).toBe("a = 1 OR (…) OR 2 more");
  });

  it("reads AND everywhere in an and-only bar and has no tail for short groups", () => {
    const group = grp("g", [cond("a"), { kind: "raw", id: "r", connector: "OR", label: "raw" }]);
    expect(groupSummary(group, text("and-only"))).toBe("a = 1 AND raw");
  });
});

describe("useFilterBarFolds", () => {
  it("folds groups from level 4 down when a tree loads, but not trees it emitted itself", async () => {
    const model = ref(tree());
    const folds = useFilterBarFolds(model);
    expect([...folds.folded.value]).toEqual(["g4", "g5"]);

    folds.setFolded("g4", false);
    const own = { ...model.value, items: [...model.value.items] };
    folds.markOwn(own);
    model.value = own;
    await nextTick();
    expect([...folds.folded.value]).toEqual(["g5"]);

    model.value = tree();
    await nextTick();
    expect([...folds.folded.value]).toEqual(["g4", "g5"]);
  });

  it("reveals a node by unfolding every group around it", () => {
    const model = ref(tree());
    const folds = useFilterBarFolds(model);
    expect(enclosingGroupIds(model.value, "e")).toEqual(["g2", "g3", "g4", "g5"]);
    folds.reveal("e");
    expect(folds.folded.value.size).toBe(0);
  });
});
