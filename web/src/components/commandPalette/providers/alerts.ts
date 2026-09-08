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

import alertsService from "@/services/alerts";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem } from "../types";
import type { EntityProviderContext } from "./context";

interface AlertRow {
  alert_id: string;
  name: string;
  folder_id?: string;
  folder_name?: string;
  alert_type?: string;
  enabled?: boolean;
  description?: string;
}

export function alertToItem(row: AlertRow): PaletteItem {
  const folder = row.folder_id || "default";
  const state = row.enabled === false ? "paused" : "";
  return {
    id: `alert:${row.alert_id}`,
    type: "alert",
    label: row.name,
    subtitle: [row.folder_name || folder, state].filter(Boolean).join(" · "),
    icon: "shield-alert-outline",
    keywords: [
      row.alert_id,
      row.folder_name ?? "",
      row.alert_type ?? "",
      row.description ?? "",
    ].filter(Boolean),
    route: { name: "alertDetail", params: { alert_id: row.alert_id }, query: { folder } },
  };
}

/** v2 list without a folder returns every alert with its folder attached. */
export function createAlertsProvider(ctx: EntityProviderContext): EntityProvider {
  return {
    id: "alerts",
    scope: "alert",
    enabled: () => ctx.hasRoute("alertDetail"),
    list: async (signal) => {
      const res = await alertsService.listByFolderId(
        0,
        1000,
        "name",
        false,
        "",
        ctx.org,
        undefined,
        undefined,
        undefined,
        undefined,
        signal,
      );
      const rows: AlertRow[] = res?.data?.list ?? [];
      return rows.filter((r) => r.alert_id && r.name).map(alertToItem);
    },
  };
}
