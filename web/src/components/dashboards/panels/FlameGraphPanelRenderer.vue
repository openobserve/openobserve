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
  <div class="h-full w-full overflow-auto px-2 pt-1" data-test="dashboard-flame-graph-panel">
    <FlameGraphView
      v-if="data?.root"
      :root="data?.root ?? null"
      :summary-label="t('profiles.total')"
      :summary-value="formatValue(data?.root?.total ?? 0)"
      :unit-label="unitLabel"
      :empty-label="t('panel.noData')"
      :value-formatter="formatValue"
      :search-query="highlight"
      :chart-label="t('dashboard.chartSelection.flameGraph')"
      hide-profile-actions
      hide-view-options
      fill-height
      no-zoom-hint
      @search="(name: string) => (highlight = highlight === name ? '' : name)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import type { FlameGraphPanelData } from "@/utils/dashboard/convertFlameGraphPanelData";

const props = defineProps<{
  data: FlameGraphPanelData | null | undefined;
  config?: Record<string, any> | null;
}>();

const { t } = useI18nTyped();
const highlight = ref("");

const unitLabel = computed(() =>
  props.data?.valueField ? raw(props.data.valueField) : t("dashboard.flameGraphRows"),
);
const formatValue = (value: number) =>
  formatUnitValue(
    getUnitValue(value, props.config?.unit, props.config?.unit_custom, props.config?.decimals),
  );
watch(
  () => props.data?.root,
  () => (highlight.value = ""),
);
</script>
