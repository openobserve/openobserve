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

<!-- Every meter's gross, discount and billed cost; a row opens that meter's breakdown. -->
<template>
  <div class="flex h-full min-h-0 flex-col" data-test="billings-usagemetertable-root">
    <OTable
      :data="rows"
      :columns="columns"
      row-key="key"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      show-index
      :default-columns="false"
      class="min-h-0 flex-1"
      :row-class="rowClass"
      :loading="loading"
      data-test="billings-usagemetertable-table"
      @row-click="onRowClick"
    >
      <template #cell-label="{ row }">
        <div class="flex min-w-0 flex-col">
          <span class="flex items-center gap-2 font-medium">
            <span
              class="rounded-default h-2.5 w-2.5 shrink-0"
              :style="{ backgroundColor: colorOf(row.key) }"
            />
            <span class="truncate">{{ row.label }}</span>
          </span>
          <span class="text-text-secondary ps-4.5 text-xs">
            {{
              row.subline ??
              t("billing.usageV2.volumeAtRate", { volume: row.volume, rate: row.rate })
            }}
          </span>
        </div>
      </template>
      <template #cell-discount="{ row }">
        <span v-if="row.discount > 0">
          <span class="text-status-success-text font-semibold">{{
            formatCost(-row.discount)
          }}</span>
          <span class="text-text-secondary ms-1">
            {{ t("billing.usageV2.percentInParens", { percent: row.discountPercent }) }}
          </span>
        </span>
        <span v-else class="text-text-secondary">{{ EM_DASH }}</span>
      </template>
      <template #cell-billed="{ row }">
        <span class="font-semibold">{{ row.missing ? EM_DASH : formatCost(row.cost) }}</span>
      </template>
      <template #cell-share="{ row }">
        <div
          class="grid w-full min-w-28 grid-cols-[minmax(2.5rem,1fr)_2.75rem] items-center gap-2.5"
        >
          <OProgressBar :value="shareOf(row) / 100" :color="colorOf(row.key)" />
          <span>{{ percentText(shareOf(row)) }}</span>
        </div>
      </template>
      <template #cell-open="{ row }">
        <OIcon v-if="row.drillable" name="chevron-right" size="sm" class="text-text-secondary" />
        <!-- Disabled, not hidden, so an empty meter still reads as one that has a breakdown. -->
        <span
          v-else-if="row.hasBreakdown"
          class="text-text-disabled inline-flex cursor-not-allowed"
          tabindex="0"
          :aria-label="t('billing.usageV2.noBreakdownYet')"
          :data-test="`billings-usagemetertable-open-disabled-${row.key}`"
        >
          <OIcon name="chevron-right" size="sm" />
          <OTooltip :content="t('billing.usageV2.noBreakdownYet')" />
        </span>
      </template>
      <!-- In #bottom rather than a column footer: a footer only reaches the pane's edge while rows overflow. -->
      <template #bottom>
        <div
          class="bg-table-header-bg border-table-header-border text-text-body grid border-t py-2 text-xs font-semibold"
          :style="{ gridTemplateColumns: gridTemplate }"
          data-test="billings-usagemetertable-total"
        >
          <span />
          <span class="px-2">{{ t("billing.usageV2.colTotal") }}</span>
          <span class="px-2">{{ formatCost(gross) }}</span>
          <span v-if="discount > 0" class="text-status-success-text px-2">
            {{ formatCost(-discount) }}
          </span>
          <span class="px-2">{{ formatCost(total) }}</span>
          <span />
          <span />
        </div>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";
import { formatCost, type BillRow } from "./meteringModel";
import { meterColorFor } from "./usageCharts";
import { totalsGridTemplate } from "./totalsBar";
import useBreakpoint from "@/composables/useBreakpoint";

const EM_DASH = raw("—");

const props = defineProps<{
  rows: BillRow[];
  /** Billed total after discounts; every share is of this. */
  total: number;
  gross: number;
  discount: number;
  /** Row colour; meters by default, so a super org can list its orgs with their own colours. */
  colorFor?: (key: string) => string;
  /** Header of the name column, "Meter" by default. */
  nameHeader?: I18nText;
  /** Header of the share column, "Share of Bill" by default. */
  shareHeader?: I18nText;
  loading?: boolean;
}>();
const emit = defineEmits<{ select: [key: string] }>();

const colorOf = (key: string) => (props.colorFor ?? (meterColorFor as (k: string) => string))(key);

const { t } = useI18nTyped();

const shareOf = (row: BillRow) => (props.total > 0 ? (row.cost / props.total) * 100 : 0);

const percentText = (value: number) => raw(`${value.toFixed(1)}%`);

const columns = computed<OTableColumnDef<BillRow>[]>(() => [
  {
    id: "label",
    header: props.nameHeader ?? t("billing.usageV2.colMeter"),
    accessorKey: "label",
    // The elastic column: it takes whatever width the fixed columns leave.
    meta: { isName: true, autoWidth: true },
    minSize: 160,
  },
  {
    id: "gross",
    header: t("billing.usageV2.colGross"),
    accessorFn: (row: BillRow) => formatCost(row.gross),
    size: 80,
  },
  // Only when something was discounted; an all-dash column just raises the question.
  ...(props.discount > 0
    ? [
        {
          id: "discount",
          header: t("billing.usageV2.discount"),
          accessorKey: "discount",
          size: 112,
        },
      ]
    : []),
  { id: "billed", header: t("billing.usageV2.colBilled"), accessorKey: "cost", size: 80 },
  {
    id: "share",
    header: props.shareHeader ?? t("billing.usageV2.meterShare"),
    accessorKey: "cost",
    size: 136,
  },
  // A plain column, not `isAction`: an action column is measured, so it would not keep this width.
  { id: "open", header: raw(""), hideable: false, size: 32 },
]);

const { isMobile } = useBreakpoint();

/** OTable drops the index column on a phone, so the bar drops it too. */
const gridTemplate = computed(() => totalsGridTemplate(columns.value, {}, !isMobile.value));

const rowClass = (row: BillRow) => (row.drillable ? "cursor-pointer" : "");

const onRowClick = (row: BillRow) => {
  if (row.drillable) emit("select", row.key);
};
</script>
