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
  <!-- Height matches the host ODialog's own max-h-[90vh] cap (minus its body
       padding + borders) so the dialog body never overflows. That keeps the
       inner right-content area as the single scroller instead of stacking a
       second scrollbar on the dialog body. -->
  <OCard
    class="p-0 w-full h-[calc(90vh_-_2rem)] overflow-hidden flex flex-col"
    data-test="custom-chart-type-selector-popup"
  >
    <!-- Header -->
    <OCardSection role="header">
      <div class="flex items-center gap-3 w-full">
        <OIcon name="bar-chart" size="sm" />
        <span class="text-xl font-semibold whitespace-nowrap">{{
          t("dashboard.customChartTypeSelector.exampleOfCustomCharts")
        }}</span>
        <OSearchInput
          v-model="searchQuery"
          :placeholder="t('dashboard.customChartTypeSelector.searchCharts')"
          clearable
          class="w-70 flex-[0_0_17.5rem] ml-4"
          @clear="searchQuery = ''"
        />
        <div class="flex-1" />
        <OButton
          variant="ghost"
          size="icon"
          :title="t('dashboard.cancel')"
          @click.stop="closeDialog"
          data-test="custom-chart-type-selector-close"
          icon-left="close"
        />
      </div>
    </OCardSection>

    <OSeparator />

    <!-- Main Content -->
    <OCardSection class="flex h-[calc(100%_-_3.75rem)] overflow-hidden p-0">
      <div class="flex flex-nowrap h-full w-full">
        <!-- Left Sidebar -->
        <OCard class="p-4 w-40 h-full shrink-0 overflow-y-auto">
          <div class="text-sm font-medium mb-3 font-bold">
            {{ t("dashboard.customChartTypeSelector.chartTypes") }}
          </div>
          <ul class="flex flex-col list-none p-0 m-0">
            <li
              v-for="(category, index) in chartCategories"
              :key="index"
              @click="scrollToCategory(category.chartLabel)"
              class="flex items-center px-3 py-2 cursor-pointer rounded-default mb-1 transition-all duration-200"
              :class="
                selectedCategory === category.chartLabel
                  ? 'bg-theme-accent text-text-inverse font-semibold'
                  : 'hover:bg-button-ghost-hover-bg'
              "
              data-test="chart-category-item"
            >
              <span class="text-sm">{{ category.chartLabel }}</span>
            </li>
          </ul>
        </OCard>

        <!-- Right Content Area -->
        <div
          ref="contentArea"
          class="p-3 flex-1 h-full overflow-y-auto overflow-x-hidden"
          @scroll="handleScroll"
        >
          <!-- No Results Message -->
          <div
            v-if="filteredCategories.length === 0"
            class="flex justify-center items-center h-full"
          >
            <div class="text-center">
              <OIcon class="w-16 h-16" name="search-off" />
              <div class="text-xl font-semibold text-text-muted mt-3">
                {{ t("dashboard.customChartTypeSelector.noResultsFound") }}
              </div>
              <div class="text-sm text-text-muted mt-2">
                {{ t("dashboard.customChartTypeSelector.trySearchingDifferentKeywords") }}
              </div>
            </div>
          </div>

          <!-- Chart Categories -->
          <div
            v-for="(category, categoryIndex) in filteredCategories"
            :key="categoryIndex"
            class="chart-category-section mb-6 scroll-mt-5"
            :data-category="category.chartLabel"
            data-test="chart-category-section"
          >
            <div class="text-xl font-semibold mb-3 font-medium">
              {{ category.chartLabel }}
            </div>
            <div class="flex gap-3">
              <div
                v-for="(chart, chartIndex) in category.type"
                :key="chartIndex"
                class="col-xs-12 col-sm-6 col-md-4 col-lg-3"
              >
                <OCard
                  class="cursor-pointer transition-all duration-200 h-full hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--color-black)_15%,transparent)] hover:-translate-y-0.5"
                  :class="{
                    'border-2 border-theme-accent shadow-[0_4px_12px_color-mix(in_srgb,var(--color-theme-accent)_30%,transparent)]':
                      selectedChart?.value === chart.value,
                  }"
                  @click="selectChart(chart)"
                  data-test="chart-type-card"
                >
                  <OCardSection class="p-2">
                    <div
                      class="w-full h-37.5 flex items-center justify-center bg-surface-subtle rounded-default overflow-hidden"
                    >
                      <img
                        :src="chart.asset"
                        :alt="chart.label"
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </OCardSection>
                  <OCardSection class="pt-0 px-2 pb-2">
                    <div class="text-xs text-center font-medium">
                      {{ chart.label }}
                    </div>
                  </OCardSection>
                </OCard>
              </div>
            </div>
          </div>
        </div>
      </div>
    </OCardSection>

    <!-- Confirm Chart Selection Dialog -->
    <CustomChartConfirmDialog
      :title="t('dashboard.customChartTypeSelector.confirmChartTypeSelection')"
      :message="t('dashboard.customChartTypeSelector.confirmChartTypeSelectionMessage')"
      :currentQuery="currentQuery"
      @update:ok="confirmChartSelection"
      @update:cancel="cancelChartSelection"
      v-model="confirmChartSelectionDialog"
    />
  </OCard>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import type { ChartType, ChartCategory } from "./customChartExampleTypes";
import { chartTypesData } from "./customChartExampleTypes";
import CustomChartConfirmDialog from "@/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

export default defineComponent({
  name: "CustomChartTypeSelector",
  components: {
    OSeparator,
    CustomChartConfirmDialog,
    OButton,
    OSearchInput,
    OCard,
    OCardSection,
    OIcon,
  },
  emits: ["close", "select"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey);

    const chartCategories = ref<ChartCategory[]>(chartTypesData.data);
    const selectedCategory = ref<string>(chartCategories.value[0]?.chartLabel || "");
    const selectedChart = ref<ChartType | null>(null);
    const contentArea = ref<HTMLElement | null>(null);
    const confirmChartSelectionDialog = ref<boolean>(false);
    const pendingChartSelection = ref<ChartType | null>(null);
    const searchQuery = ref<string>("");

    // Get current query for the dialog
    const currentQuery = computed(
      () =>
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex || 0]?.query ||
        "",
    );

    // Computed property to filter categories and charts based on search query
    const filteredCategories = computed(() => {
      if (!searchQuery.value.trim()) {
        return chartCategories.value;
      }

      const query = searchQuery.value.toLowerCase().trim();
      const filtered: ChartCategory[] = [];

      chartCategories.value.forEach((category) => {
        const filteredCharts = category.type.filter((chart) =>
          chart.label.toLowerCase().includes(query),
        );

        if (filteredCharts.length > 0) {
          filtered.push({
            ...category,
            type: filteredCharts,
          });
        }
      });

      return filtered;
    });

    const scrollToCategory = (category: string) => {
      selectedCategory.value = category;
      if (!contentArea.value) return;

      const element = contentArea?.value?.querySelector(
        `[data-category="${category}"]`,
      ) as HTMLElement;
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    const handleScroll = () => {
      if (!contentArea.value) return;

      const scrollTop = contentArea.value.scrollTop;
      const sections = contentArea.value.querySelectorAll(".chart-category-section");

      // Find which category is currently in view
      for (const section of Array.from(sections)) {
        const element = section as HTMLElement;
        const category = element.getAttribute("data-category");
        if (!category) continue;

        const elementTop = element.offsetTop - contentArea.value.offsetTop;
        const elementBottom = elementTop + element.offsetHeight;

        if (scrollTop >= elementTop - 100 && scrollTop < elementBottom) {
          selectedCategory.value = category;
          break;
        }
      }
    };

    const selectChart = (chart: ChartType) => {
      // Store the chart to be selected and show confirmation dialog
      pendingChartSelection.value = chart;
      confirmChartSelectionDialog.value = true;
    };

    const confirmChartSelection = (options?: { replaceQuery: boolean }) => {
      // User confirmed, proceed with selection
      if (pendingChartSelection.value) {
        selectedChart.value = pendingChartSelection.value;
        // Pass both chart and replaceQuery option to parent
        emit("select", {
          chart: pendingChartSelection.value,
          replaceQuery: options?.replaceQuery ?? false, // Default to false (unchecked)
        });
        closeDialog();
      }
      confirmChartSelectionDialog.value = false;
      pendingChartSelection.value = null;
    };

    const cancelChartSelection = () => {
      // User cancelled, do nothing
      confirmChartSelectionDialog.value = false;
      pendingChartSelection.value = null;
    };

    const closeDialog = () => {
      emit("close");
    };

    onMounted(() => {
      nextTick(() => {
        // Set first category as selected by default
        if (chartCategories.value.length > 0) {
          selectedCategory.value = chartCategories.value[0].chartLabel;
        }
      });
    });

    return {
      t,
      chartCategories,
      selectedCategory,
      selectedChart,
      contentArea,
      confirmChartSelectionDialog,
      scrollToCategory,
      handleScroll,
      selectChart,
      confirmChartSelection,
      cancelChartSelection,
      closeDialog,
      searchQuery,
      filteredCategories,
      currentQuery,
    };
  },
});
</script>
