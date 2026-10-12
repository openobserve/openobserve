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
  <div class="overflow-x-auto" data-test="rum-analytics-retention-grid">
    <OTable
      :data="tableRows"
      :columns="columns"
      :default-columns="false"
      row-key="id"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :frame="false"
      :dense="true"
    >
      <template #cell-label="{ row }">
        <span
          :class="row.average ? 'text-text-heading font-semibold' : 'text-text-body'"
          :data-test="
            row.average
              ? 'rum-analytics-retention-average-row'
              : `rum-analytics-retention-row-${row.cohort}`
          "
          >{{ row.label
          }}<span class="text-text-secondary ms-2 tabular-nums">{{
            formatCount(row.size, sampled)
          }}</span></span
        >
      </template>
      <template v-for="k in periods" :key="k" #[`cell-k${k}`]="{ row }">
        <template v-if="row.average">
          <span class="block text-center font-semibold tabular-nums">{{
            grid.average[k] === null || grid.average[k] === undefined
              ? dash
              : pct(grid.average[k] as number)
          }}</span>
        </template>
        <OButton
          v-else-if="row.cells[k]"
          variant="ghost"
          size="sm"
          class="w-full justify-center tabular-nums"
          :class="[
            tint(row.cells[k].pct),
            row.cells[k].incomplete ? 'bg-hatch border-border-strong border border-dashed' : '',
          ]"
          aria-haspopup="dialog"
          :aria-label="cellAria(row, k)"
          :data-test="`rum-analytics-retention-cell-${row.cohort}-${k}`"
          :data-incomplete="row.cells[k].incomplete ? 'true' : undefined"
          @click="emit('cell', { cohort: row.cohort, k })"
        >
          {{ pct(row.cells[k].pct) }}
          <OTooltip :content="cellCard(row, k)" />
        </OButton>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  formatCount,
  type RetentionCell,
  type RetentionGrid,
  formatPct as pct,
} from "@/utils/rum/productAnalyticsModel";
import type { RetentionMode, SampleRatio } from "@/utils/rum/productAnalyticsQueries";

interface GridRow {
  id: string;
  cohort: number;
  label: string;
  size: number;
  cells: RetentionCell[];
  average: boolean;
}

// Five static steps of the accent ramp: Tailwind only emits class names it can see.
const TINTS = ["", "bg-accent/10", "bg-accent/20", "bg-accent/30", "bg-accent/40", "bg-accent/50"];

const props = withDefaults(
  defineProps<{
    grid: RetentionGrid;
    granularity: "day" | "week" | "month";
    mode: RetentionMode;
    sampled?: SampleRatio;
    unit?: I18nText;
  }>(),
  { sampled: 1, unit: undefined },
);
const emit = defineEmits<{ cell: [{ cohort: number; k: number }] }>();
const { t } = useI18nTyped();
const dash = raw("—");

const periods = computed(() => Array.from({ length: props.grid.average.length }, (_, k) => k));

const periodLabel = (k: number) =>
  props.granularity === "day"
    ? t("rum.analytics.retention.dayN", { n: k })
    : props.granularity === "week"
      ? t("rum.analytics.retention.weekN", { n: k })
      : t("rum.analytics.retention.monthN", { n: k });

const cellParams = (row: GridRow, k: number) => ({
  pct: pct(row.cells[k].pct),
  cohort: raw(row.label),
  period: periodLabel(k),
  users: formatCount(row.cells[k].users, props.sampled),
  size: formatCount(row.size, props.sampled),
  unit: props.unit ?? t("rum.analytics.identity.usersNoun"),
});

const cellCard = (row: GridRow, k: number) =>
  t("rum.analytics.retention.cellCard", cellParams(row, k));

const cellAria = (row: GridRow, k: number) =>
  row.cells[k].incomplete
    ? t("rum.analytics.retention.cellAriaIncomplete", cellParams(row, k))
    : t("rum.analytics.retention.cellAria", cellParams(row, k));

const tint = (v: number) => TINTS[v <= 0 ? 0 : Math.min(5, Math.ceil(v * 5))];

const tableRows = computed<GridRow[]>(() => [
  {
    id: "avg",
    cohort: -1,
    label: t("rum.analytics.retention.allCohorts"),
    size: props.grid.rows.reduce((a, r) => a + r.size, 0),
    cells: [],
    average: true,
  },
  ...props.grid.rows.map((r) => ({ id: `c${r.cohort}`, ...r, average: false })),
]);

const columns = computed<OTableColumnDef<GridRow>[]>(() => [
  { id: "label", header: t("rum.analytics.retention.cohortHeader"), size: 190, pinned: "left" },
  ...periods.value.map((k) => ({
    id: `k${k}`,
    header: periodLabel(k),
    size: 84,
    meta: { align: "center" as const },
  })),
]);
</script>
