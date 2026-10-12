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
  <div data-test="rum-analytics-funnel-breakdown">
    <OTable
      :data="tableRows"
      :columns="columns"
      :default-columns="false"
      row-key="id"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :frame="false"
    >
      <template #cell-value="{ row, index }">
        <span
          class="flex items-center gap-1.5"
          :data-test="`rum-analytics-funnel-breakdown-row-${index}`"
        >
          <span :class="row.total ? 'text-text-heading font-semibold' : 'text-text-body'">{{
            row.label
          }}</span>
          <OTag
            v-if="row.atLeast"
            :label="t('rum.analytics.funnel.atLeast')"
            variant="default-soft"
            size="xs"
          />
        </span>
      </template>
      <template v-for="(_, i) in steps" :key="i" #[`cell-s${i}`]="{ row }">
        <span class="flex flex-col items-end tabular-nums">
          <span>{{ formatCount(row.counts[i], sampled) }}</span>
          <span v-if="i > 0" class="text-text-secondary text-xs">{{
            pct(row.counts[0] > 0 ? row.counts[i] / row.counts[0] : 0)
          }}</span>
        </span>
      </template>
      <template #cell-conversion="{ row }">
        <ODataBarCell :value="row.conversion * 100" :max="100" :display="pct(row.conversion)" />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, type BreakdownRow, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { SampleRatio, StepRef } from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

interface TableRow {
  id: string;
  label: string;
  counts: number[];
  conversion: number;
  atLeast: boolean;
  total: boolean;
}

const props = withDefaults(
  defineProps<{
    rows: BreakdownRow[];
    total: number[];
    steps: StepRef[];
    dimLabel: I18nText;
    events: NamedEvent[];
    sampled?: SampleRatio;
    deletedNames?: Readonly<Record<string, string>>;
  }>(),
  { sampled: 1, deletedNames: () => ({}) },
);
const { t } = useI18nTyped();

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const tableRows = computed<TableRow[]>(() => [
  ...props.rows.map((r, i) => ({
    id: `r${i}`,
    label: r.notSet
      ? t("rum.analytics.funnel.notSet")
      : r.other
        ? t("rum.analytics.funnel.other")
        : r.label,
    counts: r.counts,
    conversion: r.conversion,
    atLeast: r.atLeast,
    total: false,
  })),
  {
    id: "total",
    label: t("rum.analytics.funnel.total"),
    counts: props.total,
    conversion: props.total[0] > 0 ? props.total[props.total.length - 1] / props.total[0] : 0,
    atLeast: false,
    total: true,
  },
]);

const columns = computed<OTableColumnDef<TableRow>[]>(() => [
  {
    id: "value",
    header: props.dimLabel,
    accessorKey: "label",
    size: 200,
    meta: { fillRemaining: true },
  },
  ...props.steps.map((s, i) => ({
    id: `s${i}`,
    header: raw(`${i + 1}. ${stepLabel(s, props.events, props.deletedNames)}`),
    accessorFn: (r: TableRow) => r.counts[i],
    size: 130,
    meta: { align: "right" as const },
  })),
  {
    id: "conversion",
    header: t("rum.analytics.funnel.conversion"),
    accessorKey: "conversion",
    size: 150,
    meta: { align: "right" },
  },
]);
</script>
