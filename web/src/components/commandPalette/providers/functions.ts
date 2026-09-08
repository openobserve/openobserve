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

import transformService from "@/services/jstransform";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface FunctionRow {
  name: string;
  function?: string;
}

export function functionToItem(row: FunctionRow, subtitle: string, group?: string): PaletteItem {
  return {
    id: `function:${row.name}`,
    type: "function",
    label: row.name,
    subtitle,
    icon: "function",
    keywords: ["vrl"],
    group,
    route: { name: "functionList", query: { action: "update", name: row.name } },
  };
}

/** Warm from the store when the functions page already loaded them; otherwise one list call. */
export function createFunctionsProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "data", "pipeline");
  return {
    id: "functions",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("functionList"),
    list: async (signal) => {
      const subtitle = String(ctx.t("palette.scopes.function"));
      const warm: FunctionRow[] = ctx.store.state.organizationData?.functions ?? [];
      if (warm.length > 0)
        return warm.filter((r) => r.name).map((r) => functionToItem(r, subtitle, group));
      const res = await transformService.list(1, 1000, "name", false, "", ctx.org, signal);
      const rows: FunctionRow[] = res?.data?.list ?? [];
      return rows.filter((r) => r.name).map((r) => functionToItem(r, subtitle, group));
    },
  };
}
