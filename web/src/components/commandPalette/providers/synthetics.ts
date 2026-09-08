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

import syntheticsService from "@/services/synthetics";
import { syntheticsResultsRoute } from "@/utils/synthetics/routes";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface CheckRow {
  id: string | number;
  name: string;
  type?: string;
  target?: string;
  folder_id?: string;
  enabled?: boolean;
  tags?: string[];
}

/** A synthetic-check row: id `synthetic:<id>`, opened on its results page. */
export function syntheticToItem(row: CheckRow, org: string, group?: string): PaletteItem {
  const id = String(row.id);
  const folder = row.folder_id || "default";
  const parts = [row.type?.toUpperCase(), row.target, row.enabled === false ? "paused" : ""];
  return {
    id: `synthetic:${id}`,
    type: "synthetic",
    label: row.name,
    subtitle: parts.filter(Boolean).join(" · "),
    icon: "radar",
    keywords: [id, row.target ?? "", row.type ?? "", ...(row.tags ?? [])].filter(Boolean),
    group,
    route: syntheticsResultsRoute({ orgIdentifier: org, folderId: folder }, id, { name: row.name }),
  };
}

/** Synthetic checks across all folders; the route exists only when synthetics is enabled. */
export function createSyntheticsProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "experience", "synthetics");
  return {
    id: "synthetics",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("synthetic-monitor-results"),
    list: async (signal) => {
      const res = await syntheticsService.listByFolderId(ctx.org, "all", signal);
      const data = res?.data ?? {};
      const rows: CheckRow[] = data.checks ?? data.monitors ?? [];
      return rows
        .filter((r) => r.id != null && r.name)
        .map((r) => syntheticToItem(r, ctx.org, group));
    },
  };
}
