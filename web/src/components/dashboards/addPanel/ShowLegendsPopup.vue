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
    :title=" t('dashboard.legendsOfCharts') "
    size="lg"
    data-test="dashboard-show-legends-dialog"
  >
    <template #header-right>
      <div class="flex items-center">
        <span class="legend-count q-mr-md" style="font-size: 14px" data-test="dashboard-show-legends-count">
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
    <div
      class="show-legends-popup"
      data-test="dashboard-show-legends-popup"
    >
      <div class="legends-content scroll">
        <div v-if="legends.length === 0" class="no-legends q-pa-md text-center">
          {{ t("dashboard.noLegendsAvailable") }}
        </div>
        <div v-else class="legends-list">
          <div
            v-for="(legend, index) in legends"
            :key="index"
            class="legend-item q-px-sm q-py-xs"
            :data-test="`dashboard-legend-item-${index}`"
          >
            <div class="flex items-center legend-row">
              <div
                class="legend-color-box"
                :style="{ backgroundColor: legend.color || '#5960b2' }"
              ></div>
              <div class="legend-text">
                {{ legend.name }}
              </div>
              <OButton
                variant="ghost"
                size="icon"
                class="tw:ml-1"
                data-test="dashboard-legend-copy-btn"
                @click.stop="copyLegend(legend.name, index)"
              >
                <template #icon-left
                  ><OIcon
                    :name="isLegendCopied(index) ? 'check' : 'content-copy'" size="sm"
                /></template>
                <q-tooltip>{{
                  isLegendCopied(index) ? "Copied!" : "Copy legend"
                }}</q-tooltip>
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
import { copyToClipboard } from "quasar";
import { useStore } from "vuex";
import {
  getSeriesColor,
  getColorPalette,
} from "@/utils/dashboard/colorPalette";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
export default defineComponent({
  name: "ShowLegendsPopup",
  components: { OButton, ODialog,
    OIcon,
},
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
    const store = useStore();
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

      const theme = store.state.theme === "dark" ? "dark" : "light";
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
          if (
            !colorConfig ||
            !colorConfig.mode ||
            colorConfig.mode === "palette-classic"
          ) {
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
        if (
          firstSeriesData.length > 0 &&
          firstSeriesData[0].name !== undefined
        ) {
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
      copyToClipboard(text).then(() => {
        copiedLegendIndices.value.add(index);
        setTimeout(() => {
          copiedLegendIndices.value.delete(index);
        }, 3000);
      });
    };

    const copyAllLegends = () => {
      const allLegendsText = legends.value.map((l: any) => l.name).join("\n");
      copyToClipboard(allLegendsText).then(() => {
        isAllCopied.value = true;
        setTimeout(() => {
          isAllCopied.value = false;
        }, 3000);
      });
    };

    return {
      t,
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

<style lang="scss" scoped>
.show-legends-popup {
  .header {
    background-color: var(--q-background);
    border-bottom: 2px solid var(--o2-border-color);
    z-index: 10;
  }

  .legends-content {
    max-height: 400px;
    overflow-y: auto;
    padding: 3px 0;
  }

  .legends-list {
    display: flex;
    flex-direction: column;
    gap: 0px;
  }

  .legend-item {
    &:last-child {
      border-bottom: none;
    }

    .legend-row {
      flex-wrap: nowrap;
      width: 100%;
    }

    .legend-color-box {
      width: 20px;
      height: 12px;
      border-radius: 2px;
      margin-right: 10px;
      flex-shrink: 0;
    }

    .legend-text {
      word-break: break-all;
      overflow-wrap: anywhere;
      white-space: normal;
      line-height: 1.4;
      font-size: 12px;
    }

    [data-test="dashboard-legend-copy-btn"] {
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
      flex-shrink: 0;
    }

    &:hover [data-test="dashboard-legend-copy-btn"] {
      opacity: 1;
    }
  }

  .no-legends {
    min-height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
