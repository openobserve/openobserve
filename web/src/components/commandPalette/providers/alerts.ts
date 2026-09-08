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

import type { PaletteItem } from "../types";

interface AlertRow {
  alert_id: string;
  name: string;
  folder_id?: string;
  folder_name?: string;
  alert_type?: string;
  enabled?: boolean;
  description?: string;
}

/** An alert row: id `alert:<id>`, opened on its detail page with its folder. */
export function alertToItem(row: AlertRow, group?: string): PaletteItem {
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
    group,
    route: { name: "alertDetail", params: { alert_id: row.alert_id }, query: { folder } },
  };
}
