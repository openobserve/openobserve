// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * useTracesTableColumns
 *
 * Returns TanStack ColumnDef[] (metadata only — no render functions).
 * Cell rendering is handled via scoped slots on <TracesTable>:
 *   #cell-{columnId}="{ item, cell }"
 *
 * Usage:
 *   const columns = useTracesTableColumns(hasLlmTraces)  // Ref<boolean>
 *   // columns is a ComputedRef<ColumnDef<Record<string,any>>[]>
 */

import { computed, type Ref } from "vue";
import { type ColumnDef } from "@tanstack/vue-table";

export function useTracesTableColumns(showLlmColumns: Ref<boolean>) {
  return computed<ColumnDef<Record<string, any>>[]>(() => {
    const base: ColumnDef<Record<string, any>>[] = [
      {
        id: "timestamp",
        header: "TIMESTAMP",
        size: 160,
      },
      {
        id: "service_operation",
        header: "SERVICE & OPERATION",
        meta: { grow: true, minWidth: 180 },
      },
      {
        id: "duration",
        header: "DURATION",
        size: 120,
      },
      {
        id: "spans",
        header: "SPANS",
        size: 100,
        meta: { align: "center" },
      },
      {
        id: "status",
        header: "STATUS",
        size: 160,
        meta: { align: "center" },
      },
    ];

    const llm: ColumnDef<Record<string, any>>[] = showLlmColumns.value
      ? [
          {
            id: "input_tokens",
            header: "INPUT TOKENS",
            size: 110,
            meta: { align: "right" },
          },
          {
            id: "output_tokens",
            header: "OUTPUT TOKENS",
            size: 110,
            meta: { align: "right" },
          },
          {
            id: "cost",
            header: "COST",
            size: 80,
            meta: { align: "right" },
          },
        ]
      : [];

    const tail: ColumnDef<Record<string, any>>[] = [
      {
        id: "service_latency",
        header: "SERVICE LATENCY",
        size: 160,
      },
    ];

    return [...base, ...llm, ...tail];
  });
}
