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

interface SavedViewRow {
  view_id: string;
  view_name: string;
}

/** A saved-view row: id `savedView:<id>`, opened through the Logs `view_id` deep link. */
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
