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

export function useTracesTableColumns(
  showLlmColumns: Ref<boolean>,
  searchMode: Ref<"traces" | "spans">,
) {
  return computed<ColumnDef<Record<string, any>>[]>(() => {
    if (searchMode.value === "spans") {
      return [
        {
          id: "timestamp",
          header: "Timestamp",
          size: 160,
          meta: { sortable: true, slot: true },
          sortable: true,
        },
        {
          id: "service",
          header: "Service",
          size: 160,
          meta: {
            cellClass: "tw:text-[var(--o2-text-1)]",
            slot: true,
          },
        },
        {
          id: "operation_name",
          header: "Operation Name",
          size: 200,
          meta: {
            cellClass: "tw:text-[var(--o2-text-1)]",
            slot: true,
          },
        },
        {
          id: "duration",
          header: "Duration",
          size: 120,
          meta: { sortable: true, slot: true },
          sortable: true,
        },
        {
          id: "status",
          header: "Status",
          size: 120,
          meta: { align: "center", slot: true },
        },
        {
          id: "status_code",
          header: "Status Code",
          size: 140,
          meta: { align: "center", slot: true },
        },
        {
          id: "method",
          header: "Method",
          size: 140,
          meta: { align: "center", slot: true },
        },
      ];
    }

    const base: ColumnDef<Record<string, any>>[] = [
      {
        id: "timestamp",
        header: "Timestamp",
        size: 160,
        meta: { sortable: true, slot: true },
      },
      {
        id: "service",
        header: "Service",
        size: 180,
        meta: {
          cellClass: "tw:text-[var(--o2-text-1)]",
          slot: true,
        },
      },
      {
        id: "operation_name",
        header: "Operation Name",
        size: 200,
        meta: {
          cellClass: "tw:text-[var(--o2-text-1)]",
          slot: true,
        },
      },
      {
        id: "duration",
        header: "Duration",
        size: 120,
        meta: {
          sortable: true,
          slot: true,
          cellClass: "tw:text-[var(--o2-text-4)]!",
        },
      },
      {
        id: "spans",
        header: "Spans",
        size: 100,
        meta: {
          align: "center",
          slot: false,
          closable: true,
          cellClass: "tw:text-[var(--o2-text-1)]!",
        },
        accessorFn: (row: any) => row.spans,
      },
      {
        id: "status",
        header: "Status",
        size: 120,
        meta: { align: "center", slot: true },
      },
    ];

    const llm: ColumnDef<Record<string, any>>[] = showLlmColumns.value
      ? [
          {
            id: "input_tokens",
            header: "Input Tokens",
            size: 130,
            meta: { align: "right", slot: true },
          },
          {
            id: "output_tokens",
            header: "Output Tokens",
            size: 130,
            meta: { align: "right", slot: true },
          },
          {
            id: "cost",
            header: "Cost",
            size: 130,
            meta: { align: "right", slot: true },
          },
        ]
      : [];

    const tail: ColumnDef<Record<string, any>>[] = [
      {
        id: "service_latency",
        header: "Service Latency",
        size: 160,
        meta: { slot: true },
      },
    ];

    return [...base, ...llm, ...tail];
  });
}
