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
 * Provides a `columns` ref (ColumnDef[]) and a `buildColumns()` method.
 * Call `buildColumns()` explicitly whenever the column list needs to be
 * rebuilt — e.g. after loading selectedFields from localStorage, after a
 * mode switch, or after the user adds/removes/reorders a column.
 *
 * Cell rendering is handled via scoped slots on <TenstackTable>:
 *   #cell-{columnId}="{ item, cell }"
 *
 * Column order is fully driven by `selectedFields` (an ordered string[]).
 * LLM columns (input_tokens, output_tokens, cost) are injected dynamically
 * before `service_latency` in traces mode when `showLlmColumns` is true;
 * they are NOT stored in `selectedFields`.
 *
 * Usage:
 *   const { columns, buildColumns } = useTracesTableColumns()
 *   buildColumns(showLlmColumns, searchMode, selectedFields)
 */

import { ref } from "vue";
import { type ColumnDef } from "@tanstack/vue-table";
import { useStore } from "vuex";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useI18n } from "vue-i18n";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";

/** IDs of LLM columns injected at runtime — never stored in selectedFields. */
export const LLM_COLUMN_IDS = new Set([
  "input_tokens",
  "output_tokens",
  "cost",
]);

/**
 * Known column metadata. Any field name NOT in this map gets a generic
 * prettified header and default width.
 */
const KNOWN_COLUMN_META: Record<
  string,
  {
    header: string;
    size: number;
    meta: Record<string, unknown>;
    accessorFn?: (row: any) => any;
    sortable?: boolean;
  }
> = {
  service_name: {
    header: "Service",
    size: 160,
    meta: { cellClass: "tw:text-[var(--o2-text-1)]", slot: true },
  },
  operation_name: {
    header: "Operation Name",
    size: 200,
    meta: { cellClass: "tw:text-[var(--o2-text-1)]", slot: true },
  },
  duration: {
    header: "Duration",
    size: 120,
    meta: {
      sortable: true,
      slot: true,
      cellClass: "tw:text-[var(--o2-text-4)]!",
    },
  },
  spans: {
    header: "Spans",
    size: 100,
    meta: {
      align: "center",
      slot: false,
      cellClass: "tw:text-[var(--o2-text-1)]!",
    },
    accessorFn: (row: any) => row.spans,
  },
  span_kind: {
    header: "Span Kind",
    size: 120,
    meta: { align: "center", slot: false, closable: true },
    accessorFn: (row: any) =>
      SPAN_KIND_MAP[row.span_kind] ?? row.span_kind ?? "",
  },
  span_status: {
    header: "Span Status",
    size: 120,
    meta: { align: "center", slot: true, disableCellAction: true },
  },
  status: {
    header: "Status",
    size: 120,
    meta: { align: "center", slot: true, disableCellAction: true },
  },
  service_latency: {
    header: "Service Latency",
    size: 160,
    meta: { slot: true, disableCellAction: true },
  },
  input_tokens: {
    header: "Input Tokens",
    size: 130,
    meta: { align: "right", slot: true },
  },
  output_tokens: {
    header: "Output Tokens",
    size: 130,
    meta: { align: "right", slot: true },
  },
  cost: {
    header: "Cost",
    size: 130,
    meta: { align: "right", slot: true },
  },
};

function toColumnDef(fieldName: string): ColumnDef<Record<string, any>> {
  const known = KNOWN_COLUMN_META[fieldName];
  if (known) {
    return {
      id: fieldName,
      header: known.header,
      size: known.size,
      meta: { ...known.meta },
      ...(known.accessorFn ? { accessorFn: known.accessorFn } : {}),
      ...(known.sortable ? { sortable: known.sortable } : {}),
    };
  }
  // Generic: prettify field name as header, default size
  const header = fieldName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: fieldName,
    header,
    size: 160,
    meta: { slot: false, closable: true },
    accessorFn: (row: any) => row[fieldName],
  };
}

export function useTracesTableColumns() {
  /**
   * Rebuild the `columns` ref from the given parameters.
   * Call this whenever selectedFields, searchMode, or showLlmColumns changes.
   */
  const columns = ref<ColumnDef<Record<string, any>>[]>([]);
  const store = useStore();
  const { t } = useI18n();

  const buildColumns = (
    showLlmColumns: boolean,
    searchMode: "traces" | "spans",
    selectedFields: string[],
  ): ColumnDef<Record<string, any>>[] => {
    const cols: ColumnDef<Record<string, any>>[] = selectedFields.map((field) =>
      toColumnDef(field),
    );

    const timestampCol =
      store?.state?.zoConfig?.timestamp_column || "_timestamp";
    if (!selectedFields.find((col) => col === timestampCol))
      cols.unshift({
        id: timestampCol,
        header: t("traces.timestamp") + ` (${store.state.timezone})`,
        size: 210,
        meta: { slot: true, sortable: true, class: "tw:capitalize!" },
        accessorFn: (row: any) =>
          timestampToTimezoneDate(
            (row[timestampCol] ?? row["zo_sql_timestamp"]) / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS",
          ),
      });

    // Inject LLM columns just before service_latency in traces mode.
    // They are not stored in selectedFields — managed by the showLlmColumns flag.
    if (searchMode === "traces" && showLlmColumns) {
      const tailIdx = cols.findIndex((c) => c.id === "service_latency");
      const llm: ColumnDef<Record<string, any>>[] = [];

      if (!selectedFields.includes("input_tokens")) {
        llm.push(toColumnDef("input_tokens"));
      }
      if (!selectedFields.includes("output_tokens")) {
        llm.push(toColumnDef("output_tokens"));
      }
      if (!selectedFields.includes("cost")) {
        llm.push(toColumnDef("cost"));
      }

      if (tailIdx !== -1) {
        cols.splice(tailIdx, 0, ...llm);
      } else {
        cols.push(...llm);
      }
    }

    // In spans mode, all columns support sort
    if (searchMode === "spans") {
      cols.forEach((col) => {
        if (col.meta) {
          (col.meta as Record<string, unknown>).sortable = true;
        }
      });
    }

    columns.value = cols;
    return cols;
  };

  return { columns, buildColumns };
}
