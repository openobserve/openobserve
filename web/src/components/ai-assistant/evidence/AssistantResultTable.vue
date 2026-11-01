<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="min-w-0 overflow-x-auto" :data-test="dataTest">
    <OTable
      :data="tableRows"
      :columns="tableColumns"
      row-key="__row"
      pagination="none"
      sorting="none"
      :default-columns="false"
      :show-global-filter="false"
      :frame="false"
      :scroll-label="label"
      horizontal-scroll
      dense
      max-height="20rem"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const TIME_COLUMNS: ReadonlySet<string> = new Set(["_timestamp", "timestamp"]);

const props = defineProps<{
  rows: Record<string, string>[];
  /** Column order; the first row's keys when absent. */
  columns?: string[];
  label: I18nText;
  dataTest: string;
}>();

const keys = computed(() =>
  props.columns?.length
    ? props.columns
    : Array.from(new Set(props.rows.flatMap((row) => Object.keys(row)))).slice(0, 20),
);

// Row values are untrusted text; the table renders them as text nodes, never as HTML.
const tableRows = computed(() =>
  props.rows.map((row, index) => ({ ...row, __row: String(index) })),
);

const tableColumns = computed<OTableColumnDef[]>(() =>
  keys.value.map((key) => ({
    id: key,
    header: raw(key),
    accessorFn: (row: Record<string, string>) => cellOf(key, row[key]),
    meta: { cellOverflowTooltip: true },
  })),
);

// Search times are microseconds; the org zone formats them like the Logs table beside the panel.
function cellOf(key: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (!TIME_COLUMNS.has(key) || !/^\d{13,17}$/.test(value)) return value;
  const n = Number(value);
  const ms = n > 1e14 ? Math.round(n / 1000) : n;
  return formatOrgTime(ms, { precision: "second", absolute: true });
}
</script>
