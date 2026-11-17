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

<script setup lang="ts">
import PanelBar from "@/components/common/PanelBar.vue";
import PanelChartPlaceholder from "@/components/dashboards/PanelChartPlaceholder.vue";
import { useI18nTyped } from "@/types/i18n";
import LatencyHeatmapColorToggle from "./LatencyHeatmapColorToggle.vue";
import TracesRedPlaceholder from "./TracesRedPlaceholder.vue";

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="flex h-auto min-h-[8.5rem] flex-col md:h-40 md:flex-row"
    data-test="traces-metrics-placeholder"
  >
    <div class="h-40 min-w-0 md:h-auto md:flex-2">
      <TracesRedPlaceholder />
    </div>
    <div class="h-40 min-w-0 px-1 py-0.5 md:h-auto md:flex-1">
      <div
        class="border-border-default bg-surface-base rounded-default flex h-full min-h-0 flex-col overflow-hidden border"
      >
        <PanelBar class="w-full justify-between gap-2" data-test="traces-metrics-placeholder-title">
          <span class="truncate">{{ t("traces.latencyHeatmap.title") }}</span>
          <!-- Chrome only: the heatmap that replaces it owns the working toggle. -->
          <span inert class="contents">
            <LatencyHeatmapColorToggle data-test="traces-metrics-placeholder-color-toggle" />
          </span>
        </PanelBar>
        <PanelChartPlaceholder class="min-h-0 flex-1" />
      </div>
    </div>
  </div>
</template>
