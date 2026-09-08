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

import savedviewsService from "@/services/saved_views";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface SavedViewRow {
  view_id: string;
  view_name: string;
}

export function savedViewToItem(row: SavedViewRow, subtitle: string, group?: string): PaletteItem {
  return {
    id: `savedView:${row.view_id}`,
    type: "savedView",
    label: row.view_name,
    subtitle,
    icon: "bookmark",
    keywords: [row.view_id],
    group,
    route: { name: "logs", query: { view_id: row.view_id } },
  };
}

export function createSavedViewsProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "logs");
  return {
    id: "savedViews",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("logs"),
    list: async (signal) => {
      const res = await savedviewsService.get(ctx.org, signal);
      const rows: SavedViewRow[] = res?.data?.views ?? [];
      const subtitle = String(ctx.t("palette.scopes.savedView"));
      return rows
        .filter((r) => r.view_id && r.view_name)
        .map((r) => savedViewToItem(r, subtitle, group));
    },
  };
}
