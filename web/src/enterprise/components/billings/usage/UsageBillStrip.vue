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

<!--
  How the bill splits across meters, and the meter selector for the breakdown
  below it. The totals live in the cards above and the table footer, so the bar
  carries shares only. The bar is a tab list: Left and Right move between meters, Escape
  returns to all meters. No legend: the table below names every meter beside the
  same colour dot, and a segment too narrow for a label has its title on hover.
-->
<template>
  <div
    class="border-border-default flex items-center border-b px-4 py-2.5"
    data-test="billings-usagebillstrip-root"
  >
    <div
      class="rounded-default focus-visible:ring-accent/40 flex h-7 min-w-0 flex-1 gap-0.5 overflow-hidden outline-none focus-visible:ring-2"
      role="tablist"
      tabindex="0"
      :aria-label="ariaLabel ?? t('billing.usageV2.costByMeter')"
      data-test="billings-usagebillstrip-bar"
      @keydown="onKeydown"
    >
      <OTooltip v-for="row in segments" :key="row.key" side="bottom" :delay="150" max-width="18rem">
        <div
          role="tab"
          :aria-selected="row.key === selected"
          :aria-label="ariaLabelOf(row)"
          class="flex h-full min-w-1.5 items-center gap-1 overflow-hidden border-2 px-2 whitespace-nowrap transition-colors hover:brightness-95"
          :class="row.drillable ? 'cursor-pointer' : ''"
          :style="segmentStyle(row)"
          :data-test="`billings-usagebillstrip-segment-${row.key}`"
          @click="choose(row)"
        >
          <span v-if="shareOf(row) >= NAME_MIN_SHARE" class="text-2xs truncate font-semibold">
            {{ row.label }}
          </span>
          <span v-if="shareOf(row) >= PERCENT_MIN_SHARE" class="text-2xs shrink-0 opacity-80">
            {{ percentText(row) }}
          </span>
          <span
            v-if="row.discount > 0 && shareOf(row) >= TAG_MIN_SHARE"
            class="text-3xs text-status-success-text bg-surface-base shrink-0 rounded-full px-1.5 font-semibold"
          >
            {{ t("billing.usageV2.discountBadge", { percent: row.discountPercent }) }}
          </span>
        </div>
        <template #content>
          <div
            class="flex min-w-44 flex-col gap-1 text-xs"
            :data-test="`billings-usagebillstrip-tip-${row.key}`"
          >
            <div class="flex items-center gap-1.5 font-semibold">
              <span
                class="rounded-default h-2.5 w-2.5 shrink-0"
                :style="{ backgroundColor: colorOf(row.key) }"
              />
              <span class="truncate">{{ row.label }}</span>
            </div>
            <div class="opacity-75">{{ detailOf(row) }}</div>
            <template v-if="row.discount > 0">
              <div class="flex justify-between gap-4">
                <span class="opacity-75">{{ t("billing.usageV2.colGross") }}</span>
                <span>{{ formatCost(row.gross) }}</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="opacity-75">{{ t("billing.usageV2.discount") }}</span>
                <span>
                  {{ formatCost(-row.discount) }}
                  {{ t("billing.usageV2.percentInParens", { percent: row.discountPercent }) }}
                </span>
              </div>
            </template>
            <div class="flex justify-between gap-4 font-semibold">
              <span>{{ t("billing.usageV2.colBilled") }}</span>
              <span>{{ formatCost(row.cost) }}</span>
            </div>
            <div class="flex justify-between gap-4">
              <span class="opacity-75">{{ t("billing.usageV2.meterShare") }}</span>
              <span>{{ percentText(row) }}</span>
            </div>
            <div v-if="row.drillable && row.key !== selected && clickHint" class="mt-1 opacity-75">
              {{ clickHint }}
            </div>
          </div>
        </template>
      </OTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatCost, type BillRow } from "./meteringModel";
import { chartTextColor } from "@/utils/chartTheme";
import { getContrastColor } from "@/utils/dashboard/chartColorUtils";
import { chartBg } from "@/utils/chartTheme";
import { meterColorFor, shadeOf } from "./usageCharts";

/** Share of the bill a segment needs before it has room for its name. */
const NAME_MIN_SHARE = 14;

/** Share of the bill a segment needs before it has room for its percentage. */
const PERCENT_MIN_SHARE = 5;

/** Share of the bill a segment needs before its discount badge fits beside the label. */
const TAG_MIN_SHARE = 24;

/** Luminance above this reads as a light fill, which needs dark label text. */
const CONTRAST_THRESHOLD = 0.5;

/** Unselected segments are a tint of their meter, so the selected one stands out. */
const TINT_STEP = 3;

const props = defineProps<{
  rows: BillRow[];
  /** Billed total after discounts; every share is of this. */
  total: number;
  selected: string | null;
  /** Colour of a row's segment; meters by default, so a super org can colour its orgs. */
  colorFor?: (key: string) => string;
  ariaLabel?: I18nText;
  /** Last line of a segment's tooltip, saying what a click opens. */
  clickHint?: I18nText;
}>();
const emit = defineEmits<{ select: [key: string | null] }>();

const colorOf = (key: string) => (props.colorFor ?? (meterColorFor as (k: string) => string))(key);

const { t } = useI18nTyped();

const segments = computed(() =>
  props.rows.filter((row) => row.cost > 0).sort((a, b) => b.cost - a.cost),
);

const shareOf = (row: BillRow) => (props.total > 0 ? (row.cost / props.total) * 100 : 0);

const percentText = (row: BillRow) => raw(`${shareOf(row).toFixed(1)}%`);

const segmentStyle = (row: BillRow) => {
  const color = colorOf(row.key);
  const isSelected = row.key === props.selected;
  const fullColor = props.selected === null || isSelected;
  const background = fullColor ? color : shadeOf(color, TINT_STEP, chartBg());
  return {
    // Grow by share, not by dollars: grow factors summing under 1 leave the row part-empty.
    flex: `${shareOf(row)} 1 0%`,
    backgroundColor: background,
    // The fill is a chart colour, not a surface, so it stays light in dark mode:
    // the label has to read against the segment, not against the theme.
    color: getContrastColor(background, chartTextColor(), CONTRAST_THRESHOLD),
    borderColor: isSelected ? shadeOf(color, 3, chartTextColor()) : "transparent",
  };
};

const titleOf = (row: BillRow) =>
  row.discount > 0
    ? t("billing.usageV2.segmentTitleDiscounted", {
        meter: row.label,
        billed: formatCost(row.cost),
        gross: formatCost(row.gross),
        discount: formatCost(row.discount),
        share: percentText(row),
      })
    : t("billing.usageV2.segmentTitle", {
        meter: row.label,
        billed: formatCost(row.cost),
        share: percentText(row),
      });

const ariaLabelOf = (row: BillRow) => titleOf(row);

/** The line under the name: an org's ingested volume, or a meter's volume at its rate. */
const detailOf = (row: BillRow) =>
  row.subline ?? t("billing.usageV2.volumeAtRate", { volume: row.volume, rate: row.rate });

const choose = (row: BillRow) => {
  if (row.drillable) emit("select", row.key);
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    emit("select", null);
    return;
  }
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const drillable = segments.value.filter((row) => row.drillable);
  const index = drillable.findIndex((row) => row.key === props.selected);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = drillable[Math.min(Math.max(index + step, 0), drillable.length - 1)];
  if (next) emit("select", next.key);
};
</script>
