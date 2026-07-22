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
  <ODialog
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="t('dashboard.legendsOfCharts')"
    size="lg"
    data-test="dashboard-show-legends-dialog"
  >
    <template #header-right>
      <div class="flex items-center">
        <span class="legend-count mr-3 text-sm" data-test="dashboard-show-legends-count">
          {{ t("dashboard.totalLegends", { count: legends.length }) }}
        </span>
        <OButton
          variant="outline"
          size="sm"
          @click.stop="copyAllLegends"
          data-test="dashboard-show-legends-copy-all"
        >
          <template #icon-left
            ><OIcon :name="isAllCopied ? 'check' : 'content-copy'" size="sm"
          /></template>
          {{ isAllCopied ? "Copied" : "Copy all" }}
        </OButton>
      </div>
    </template>

    <!-- Legends List -->
    <div data-test="dashboard-show-legends-popup">
      <div class="scroll max-h-100 overflow-y-auto py-0.75">
        <div
          v-if="legends.length === 0"
          class="p-3 text-center min-h-25 flex items-center justify-center"
        >
          {{ t("dashboard.noLegendsAvailable") }}
        </div>
        <div v-else class="flex flex-col">
          <div
            v-for="(legend, index) in legends"
            :key="index"
            class="legend-item group px-2 py-1 last:border-b-0"
            :data-test="`dashboard-legend-item-${index}`"
          >
            <div class="flex items-center flex-nowrap w-full">
              <div
                class="w-5 h-3 rounded-default mr-2.5 shrink-0"
                :style="{ backgroundColor: legend.color || DEFAULT_LEGEND_COLOR }"
              ></div>
              <div
                class="break-all overflow-wrap-anywhere whitespace-normal leading-[1.4] text-xs"
                data-test="dashboard-legend-item-text"
              >
                {{ legend.name }}
              </div>
              <OButton
                variant="ghost"
                size="icon"
                class="ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                data-test="dashboard-legend-copy-btn"
                :data-copied="isLegendCopied(Number(index)) ? 'true' : undefined"
                @click.stop="copyLegend(legend.name, Number(index))"
              >
                <template #icon-left
                  ><OIcon
                    :name="isLegendCopied(Number(index)) ? 'check' : 'content-copy'"
                    size="sm"
                /></template>
                <OTooltip :content="isLegendCopied(Number(index)) ? 'Copied!' : 'Copy legend'" />
              </OButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { useTheme } from "@/composables/useTheme";
import { getSeriesColor, getColorPalette } from "@/utils/dashboard/colorPalette";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
// Fallback swatch colour for a legend entry that carries no series colour.
// A :style binding is resolved by the DOM, so it takes the brand token directly.
const DEFAULT_LEGEND_COLOR = "var(--color-brand-indigo)";

export default defineComponent({
  name: "ShowLegendsPopup",
  components: { OButton, ODialog, OIcon, OTooltip },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    panelData: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["update:open"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
    const { isDark } = useTheme();
    const copiedLegendIndices = ref(new Set<number>());
    const isAllCopied = ref(false);

    // Transform legends data from chart options
    const legends = computed(() => {
      if (!props.panelData || !props.panelData.options) {
        return [];
      }

      const chartOptions = props.panelData.options;
      const series = chartOptions.series;

      if (!series || !Array.isArray(series)) {
        return [];
      }

      // Calculate chart min/max for color scaling
      let chartMin = Infinity;
      let chartMax = -Infinity;

      // Helper to update min/max
      const updateMinMax = (val: any) => {
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
          const numVal = Number(val);
          chartMin = Math.min(chartMin, numVal);
          chartMax = Math.max(chartMax, numVal);
        }
      };

      // Collect all values to determine min/max
      series.forEach((s: any) => {
        if (s && s.data && Array.isArray(s.data)) {
          s.data.forEach((d: any) => {
            if (Array.isArray(d)) {
              // Usually [time, value] or [value, name]
              d.forEach((v) => updateMinMax(v));
            } else if (typeof d === "object" && d !== null) {
              updateMinMax(d.value);
            } else {
              updateMinMax(d);
            }
          });
        }
      });

      if (chartMin === Infinity) chartMin = 0;
      if (chartMax === -Infinity) chartMax = 0;

      const theme = isDark.value ? "dark" : "light";
      const colorPalette = getColorPalette(theme);

      // Helper to get color
      const resolveColor = (item: any, index: number, value: any = null) => {
        // 1. Try explicit color from itemStyle or lineStyle
        const explicitColor = item.itemStyle?.color || item.lineStyle?.color;
        if (explicitColor && typeof explicitColor === "string") {
          return explicitColor;
        }

        // 2. If panelSchema is available, use getSeriesColor logic
        if (props.panelData && props.panelData.config) {
          const colorConfig = props.panelData.config.color;

          // If mode is palette-classic (or not set), use the palette loop
          if (!colorConfig || !colorConfig.mode || colorConfig.mode === "palette-classic") {
            return colorPalette[index % colorPalette.length];
          }

          // Otherwise use getSeriesColor
          // Note: getSeriesColor might return null for palette-classic, so we handled it above
          const calculatedColor = getSeriesColor(
            colorConfig,
            item.name,
            value !== null ? [value] : [], // Pass value if available (for pie/donut)
            chartMin,
            chartMax,
            theme,
            colorConfig.colorBySeries,
          );

          if (calculatedColor) return calculatedColor;
        }

        // 3. Fallback to palette
        return colorPalette[index % colorPalette.length];
      };

      // For pie/donut charts, extract from series[0].data
      const firstSeries = series.find((s: any) => s != null);
      if (firstSeries && firstSeries.data && Array.isArray(firstSeries.data)) {
        const firstSeriesData = firstSeries.data;
        // Check if it's pie/donut format (data has name property)
        if (firstSeriesData.length > 0 && firstSeriesData[0].name !== undefined) {
          return firstSeriesData
            .filter((item: any) => item && item.name)
            .map((item: any, index: number) => ({
              name: item.name,
              color: resolveColor(item, index, item.value),
            }));
        }
      }

      // For other chart types (line, bar, area, etc.), use series names
      return series
        .filter((s: any) => s && s.name)
        .map((s: any, index: number) => ({
          name: s.name,
          color: resolveColor(s, index),
        }));
    });

    const closePopup = () => {
      emit("update:open", false);
    };

    const isLegendCopied = (index: number) => {
      return copiedLegendIndices.value.has(index);
    };

    const copyLegend = (text: string, index: number) => {
      copyToClipboard(text, { silent: true, timeout: 3000 }).then(() => {
        copiedLegendIndices.value.add(index);
        setTimeout(() => {
          copiedLegendIndices.value.delete(index);
        }, 3000);
      });
    };

    const copyAllLegends = () => {
      const allLegendsText = legends.value.map((l: any) => l.name).join("\n");
      copyToClipboard(allLegendsText, { silent: true, timeout: 3000 }).then(() => {
        isAllCopied.value = true;
        setTimeout(() => {
          isAllCopied.value = false;
        }, 3000);
      });
    };

    return {
      t,
      DEFAULT_LEGEND_COLOR,
      legends,
      closePopup,
      copyLegend,
      copyAllLegends,
      isLegendCopied,
      isAllCopied,
    };
  },
});
</script>
