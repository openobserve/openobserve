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
  <div
    class="bg-surface-base flex h-full min-h-0 flex-col"
    :data-test="`${dataTestPrefix}-data-view`"
  >
    <OTable
      :data="tableRows"
      :columns="columns"
      :row-key="rowKeyOf"
      :loading="loading && !tableRows.length"
      :streaming="loading && tableRows.length > 0"
      :empty-message="t('panel.dataViewEmpty')"
      :show-global-filter="false"
      pagination="none"
      virtual-scroll
      window-row-model
      :row-height="22"
      horizontal-scroll
      :data-test="`${dataTestPrefix}-data-view-table`"
    />
    <div
      v-if="isCapped"
      class="text-text-secondary border-border-default shrink-0 border-t px-2 py-1 text-xs"
      :data-test="`${dataTestPrefix}-data-view-capped`"
    >
      {{
        t("panel.dataViewCapped", {
          shown: MAX_ROWS.toLocaleString(),
          total: result.rows.length.toLocaleString(),
        })
      }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { flattenPanelResult } from "@/composables/dashboard/usePanelActions";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  data: any;
  queryType?: string;
  loading?: boolean;
  dataTestPrefix: string;
}>();

// Flattening copies every point of a dense PromQL range result, so very large results are cut.
const MAX_ROWS = 100000;

const { t } = useI18nTyped();

const result = computed(() => flattenPanelResult(props.data, props.queryType));

const isCapped = computed(() => result.value.rows.length > MAX_ROWS);

const tableRows = computed(() =>
  isCapped.value ? result.value.rows.slice(0, MAX_ROWS) : result.value.rows,
);

// Query rows carry no unique field, so the position is the identity.
const rowIndex = computed(() => new WeakMap(tableRows.value.map((row, index) => [row, index])));

const rowKeyOf = (row: Record<string, any>) => String(rowIndex.value.get(row));

const isNumericColumn = (key: string) => {
  const sample = result.value.rows.find((row) => row[key] != null)?.[key];
  return typeof sample === "number";
};

const columns = computed<OTableColumnDef[]>(() =>
  result.value.columns.map((key) => ({
    id: key,
    header: raw(key),
    // accessorFn, not accessorKey: aliases may contain dots, which TanStack reads as a path.
    accessorFn: (row: Record<string, any>) => row[key],
    meta: { align: isNumericColumn(key) ? "right" : "left" },
  })),
);
</script>
