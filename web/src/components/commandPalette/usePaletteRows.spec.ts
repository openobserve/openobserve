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
import type { PaletteItem, PaletteScope } from "./types";

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
const dash = (id: string, label: string): PaletteItem => ({
  id,
  type: "dashboard",
  label,
  icon: "dashboard",
});
const ids = (rows: { kind: string; item?: PaletteItem; label?: string }[]) =>
  rows.map((r) => (r.kind === "header" ? r.label : r.item!.id));

const base = (over: Partial<Parameters<typeof usePaletteRows>[0]> = {}) => ({
  query: ref(""),
  scopes: ref<PaletteScope[]>([]),
  pages: ref<PaletteItem[]>([page("page:logs", "Logs"), page("page:metrics", "Metrics")]),
  actions: ref<PaletteItem[]>([action("action:newAlert", "New alert")]),
  entities: ref<PaletteItem[]>([]),
  fallback: () => null,
  frecency: () => new Map<string, number>(),
  t,
  ...over,
});

describe("usePaletteRows", () => {
  it("sections the empty state as recent, actions, pages with frecency on top", () => {
    const frecency = () =>
      new Map([
        ["page:metrics", 0.8],
        ["page:missing", 5],
        ["page:logs", 0],
      ]);
    const { rows, itemIndexes } = usePaletteRows(base({ frecency }));
    expect(ids(rows.value)).toEqual([
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
    const { rows } = usePaletteRows(base());
    expect(rows.value[0]).toMatchObject({ kind: "header", label: "palette.groups.actions" });
  });

  it("flattens to a ranked list when a query is typed", () => {
    const { rows, itemIndexes } = usePaletteRows(base({ query: ref("me") }));
    expect(rows.value.every((r) => r.kind === "item")).toBe(true);
    expect(ids(rows.value)).toEqual(["page:metrics"]);
    expect(itemIndexes.value).toEqual([0]);
  });

  it("narrows to the scope and pins its create verb first on an empty query", () => {
    const entities = ref([dash("dashboard:b", "Beta"), dash("dashboard:a", "Alpha")]);
    const actions = ref([
      action("action:newDashboard", "New dashboard"),
      action("action:newAlert", "New alert"),
    ]);
    const scopes = ref<PaletteScope[]>(["dashboard"]);
    const { rows } = usePaletteRows(
      base({ scopes, actions, entities, frecency: () => new Map([["dashboard:b", 1]]) }),
    );
    expect(ids(rows.value)).toEqual(["action:newDashboard", "dashboard:b", "dashboard:a"]);
    scopes.value = ["pages"];
    expect(ids(rows.value)).toEqual(["page:logs", "page:metrics"]);
    scopes.value = ["pages", "dashboard"];
    expect(ids(rows.value)).toEqual([
      "action:newDashboard",
      "dashboard:b",
      "dashboard:a",
      "page:logs",
      "page:metrics",
    ]);
  });

  it("keeps the scope filter while ranking a typed query", () => {
    const entities = ref([dash("dashboard:logs-overview", "Logs overview")]);
    const { rows } = usePaletteRows(
      base({ query: ref("log"), scopes: ref<PaletteScope[]>(["dashboard"]), entities }),
    );
    expect(ids(rows.value)).toEqual(["dashboard:logs-overview"]);
  });

  it("offers the fallback row only when nothing matches and the query is long enough", () => {
    const query = ref("zz");
    const fallback = (q: string): PaletteItem => ({
      id: "ai:ask",
      type: "ai",
      label: q,
      icon: "auto-awesome",
    });
    const { rows } = usePaletteRows(base({ query, fallback }));
    expect(rows.value).toEqual([]);
    query.value = "zzz";
    expect(ids(rows.value)).toEqual(["ai:ask"]);
    query.value = "log";
    expect(ids(rows.value)).toEqual(["page:logs"]);
  });
});
