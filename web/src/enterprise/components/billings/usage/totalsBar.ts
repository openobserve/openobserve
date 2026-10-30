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

import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { TABLE_INDEX_COL_SIZE } from "@/lib/core/Table/OTable.types";

const PX_PER_REM = 16;

/** The totals bar's grid, derived from the table's own column sizes so the two cannot drift apart. */
export function totalsGridTemplate(
  columns: OTableColumnDef<any>[],
  visibility: Record<string, boolean> = {},
  showIndex = true,
): string {
  const tracks = columns
    .filter((column) => visibility[column.id ?? ""] !== false)
    .map((column) =>
      column.meta?.autoWidth || typeof column.size !== "number"
        ? "minmax(0, 1fr)"
        : `${column.size / PX_PER_REM}rem`,
    );
  return [showIndex ? `${TABLE_INDEX_COL_SIZE / PX_PER_REM}rem` : null, ...tracks]
    .filter(Boolean)
    .join(" ");
}
