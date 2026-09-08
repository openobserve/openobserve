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

import dashboardService from "@/services/dashboards";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import { resolveGroup, type EntityProviderContext } from "./context";

interface DashboardRow {
  dashboard_id: string;
  title: string;
  folder_id?: string;
  folder_name?: string;
  description?: string;
}

/** A dashboard row: id `dashboard:<folder>/<id>`, opened on its view page. */
export function dashboardToItem(row: DashboardRow, group?: string): PaletteItem {
  const folder = row.folder_id || "default";
  return {
    id: `dashboard:${folder}/${row.dashboard_id}`,
    type: "dashboard",
    label: row.title,
    subtitle: row.folder_name || folder,
    icon: "dashboard",
    keywords: [row.dashboard_id, row.folder_name ?? "", row.description ?? ""].filter(Boolean),
    group,
    route: { path: "/dashboards/view", query: { dashboard: row.dashboard_id, folder } },
  };
}

/** One cross-folder call: an empty folder id lists every dashboard the user can see. */
export function createDashboardsProvider(ctx: EntityProviderContext): EntityProvider {
  const group = resolveGroup(ctx.railKeys, "dashboards");
  return {
    id: "dashboards",
    groups: group ? [group] : [],
    enabled: () => ctx.hasRoute("dashboards"),
    list: async (signal) => {
      const res = await dashboardService.list(0, 1000, "name", false, "", ctx.org, "", "", signal);
      const rows: DashboardRow[] = res?.data?.dashboards ?? [];
      return rows.filter((r) => r.dashboard_id && r.title).map((r) => dashboardToItem(r, group));
    },
  };
}
