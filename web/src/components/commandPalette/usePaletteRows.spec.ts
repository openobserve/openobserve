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

import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { raw } from "@/types/i18n";
import { usePaletteRows } from "./usePaletteRows";
import type { PaletteItem } from "./types";

const t = raw as any;
const page = (id: string, label: string): PaletteItem => ({
  id,
  type: "page",
  label,
  icon: "search",
});
const action = (id: string, label: string): PaletteItem => ({
  id,
  type: "action",
  label,
  icon: "add",
});

describe("usePaletteRows", () => {
  const pages = ref([page("page:logs", "Logs"), page("page:metrics", "Metrics")]);
  const actions = ref([action("action:newAlert", "New alert")]);

  it("sections the empty state as recent, actions, pages with frecency on top", () => {
    const query = ref("");
    const frecency = () =>
      new Map([
        ["page:metrics", 0.8],
        ["page:missing", 5],
        ["page:logs", 0],
      ]);
    const { rows, itemIndexes } = usePaletteRows({ query, pages, actions, frecency, t });
    expect(rows.value.map((r) => (r.kind === "header" ? r.label : r.item.id))).toEqual([
      "palette.groups.recent",
      "page:metrics",
      "palette.groups.actions",
      "action:newAlert",
      "palette.groups.pages",
      "page:logs",
      "page:metrics",
    ]);
    expect(itemIndexes.value).toEqual([1, 3, 5, 6]);
  });

  it("omits the recent section when nothing has been used", () => {
    const { rows } = usePaletteRows({
      query: ref(""),
      pages,
      actions,
      frecency: () => new Map(),
      t,
    });
    expect(rows.value[0]).toMatchObject({ kind: "header", label: "palette.groups.actions" });
  });

  it("flattens to a ranked list when a query is typed", () => {
    const query = ref("me");
    const { rows, itemIndexes } = usePaletteRows({
      query,
      pages,
      actions,
      frecency: () => new Map(),
      t,
    });
    expect(rows.value.every((r) => r.kind === "item")).toBe(true);
    expect(rows.value.map((r) => r.kind === "item" && r.item.id)).toEqual(["page:metrics"]);
    expect(itemIndexes.value).toEqual([0]);
  });
});
