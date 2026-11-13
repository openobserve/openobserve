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
    ref="rootRef"
    class="bg-surface-panel border-border-default flex min-h-0 flex-col border-t"
    data-test="dashboard-addpanel-chart-type-list"
  >
    <div class="px-page-edge shrink-0 py-2">
      <OSearchInput
        v-model="search"
        :placeholder="t('dashboard.chartTypes.searchPlaceholder')"
        :aria-label="t('dashboard.chartTypes.searchPlaceholder')"
        data-test="dashboard-addpanel-chart-type-search"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
      <section
        v-for="group in visibleGroups"
        :key="group.id"
        :aria-label="t(group.labelKey)"
        :data-test="`dashboard-addpanel-chart-type-group-${group.id}`"
      >
        <div class="text-text-secondary px-2 pt-2.5 pb-1 text-xs font-medium">
          {{ t(group.labelKey) }}
        </div>
        <ul class="m-0 list-none p-0">
          <li
            v-for="type in group.types"
            :key="type.id"
            class="rounded-default"
            :class="selected === type.id ? 'bg-label-chip-url-bg' : ''"
            data-test="dashboard-addpanel-chart-selection-item"
            :data-test-selected="selected === type.id ? type.id : undefined"
          >
            <OButton
              variant="row"
              block
              :disabled="isUnavailable(type)"
              :aria-current="selected === type.id ? 'true' : undefined"
              :data-test="`selected-chart-${type.id}-item`"
              :data-selected="selected === type.id ? 'true' : 'false'"
              @click="emit('select', type.id)"
            >
              <span class="flex w-full min-w-0 items-center gap-2 px-2">
                <img
                  :src="chartTypeIconUrl(type)"
                  alt=""
                  class="size-5 shrink-0 scheme-light dark:scheme-dark"
                  :class="isUnavailable(type) ? 'opacity-50' : ''"
                  data-test="dashboard-addpanel-chart-selection-icon"
                />
                <OTruncatedText class="text-compact flex-1 font-normal">{{
                  t(type.labelKey)
                }}</OTruncatedText>
              </span>
            </OButton>
          </li>
        </ul>
      </section>
      <div
        v-if="!visibleGroups.length"
        class="text-text-secondary px-2 py-6 text-center text-sm"
        data-test="dashboard-addpanel-chart-type-empty"
      >
        {{ t("dashboard.chartTypes.noMatch") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import {
  CHART_TYPE_GROUPS,
  chartTypeIconUrl,
  isChartTypeUnavailable,
  type ChartTypeEntry,
} from "@/utils/dashboard/chartTypeCatalog";

const props = defineProps<{
  selected: string;
  /** Types the host editor allows; empty or absent allows every type. */
  allowedChartTypes?: readonly string[];
}>();

const emit = defineEmits<{ select: [id: string] }>();

const { t } = useI18nTyped();

const dashboardPanelDataPageKey: string = inject("dashboardPanelDataPageKey", "dashboard");
const { promqlMode } = useDashboardPanelData(dashboardPanelDataPageKey, t);

const rootRef = ref<HTMLElement | null>(null);
const search = ref("");

const isUnavailable = (type: ChartTypeEntry) =>
  isChartTypeUnavailable(type, {
    promqlMode: !!promqlMode.value,
    allowedChartTypes: props.allowedChartTypes,
  });

const matches = (type: ChartTypeEntry, term: string) =>
  `${t(type.labelKey)} ${t(type.keywordsKey)}`.toLowerCase().includes(term);

const visibleGroups = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return CHART_TYPE_GROUPS;
  return CHART_TYPE_GROUPS.map((group) => ({
    ...group,
    types: group.types.filter((type) => matches(type, term)),
  })).filter((group) => group.types.length > 0);
});

// The list mounts on open, after the page's one autofocus pass, so the search is focused by hand.
onMounted(() => rootRef.value?.querySelector("input")?.focus());
</script>
