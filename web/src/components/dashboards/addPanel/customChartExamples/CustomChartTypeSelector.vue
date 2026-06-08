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
  <OCard
    data-test="custom-chart-type-selector-popup"
    style="
      padding: 0;
      width: 100%;
      height: calc(100vh - 57px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    "
  >
    <!-- Header -->
    <OCardSection role="header">
      <div class="tw:flex tw:items-center tw:gap-3 tw:w-full">
        <OIcon name="bar-chart" size="sm" />
        <span class="tw:text-xl tw:font-semibold tw:whitespace-nowrap">Example of custom charts</span>
        <OSearchInput
          v-model="searchQuery"
          placeholder="Search charts..."
          clearable
          style="width: 280px; flex: 0 0 280px; margin-left: 16px;"
          @clear="searchQuery = ''"
        />
        <div class="tw:flex-1" />
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
    <OCardSection
      class="tw:flex"
      style="height: calc(100% - 60px); overflow: hidden; padding: 0"
    >
      <div class="tw:flex tw:flex-nowrap" style="height: 100%; width: 100%">
        <!-- Left Sidebar -->
        <OCard
          class="sidebar tw:p-4"
          style="width: 160px; height: 100%; flex-shrink: 0; overflow-y: auto"
        >
          <div class="tw:text-sm tw:font-medium tw:mb-3 text-weight-bold">Chart Types</div>
          <ul class="chart-category-list tw:flex tw:flex-col">
            <li
              v-for="(category, index) in chartCategories"
              :key="index"
              @click="scrollToCategory(category.chartLabel)"
              class="sidebar-item tw:flex tw:items-center tw:px-3 tw:py-2 tw:cursor-pointer"
              :class="{
                'active-category': selectedCategory === category.chartLabel,
              }"
              data-test="chart-category-item"
            >
              <span class="tw:text-sm">{{ category.chartLabel }}</span>
            </li>
          </ul>
        </OCard>

        <!-- Right Content Area -->
        <div
          ref="contentArea"
          class="content-area tw:p-3"
          style="flex: 1; height: 100%; overflow-y: auto; overflow-x: hidden"
          @scroll="handleScroll"
        >
          <!-- No Results Message -->
          <div
            v-if="filteredCategories.length === 0"
            class="tw:flex tw:justify-center tw:items-center"
            style="height: 100%"
          >
            <div class="tw:text-center">
              <OIcon name="search-off" style="width: 4rem; height: 4rem;" />
              <div class="tw:text-xl tw:font-semibold tw:text-gray-400 tw:mt-3">No results found</div>
              <div class="tw:text-sm tw:text-gray-400 tw:mt-2">
                Try searching with different keywords
              </div>
            </div>
          </div>

          <!-- Chart Categories -->
          <div
            v-for="(category, categoryIndex) in filteredCategories"
            :key="categoryIndex"
            class="chart-category-section tw:mb-6"
            :data-category="category.chartLabel"
            data-test="chart-category-section"
          >
            <div class="tw:text-xl tw:font-semibold tw:mb-3 text-weight-medium">
              {{ category.chartLabel }}
            </div>
            <div class="tw:flex tw:gap-3">
              <div
                v-for="(chart, chartIndex) in category.type"
                :key="chartIndex"
                class="col-xs-12 col-sm-6 col-md-4 col-lg-3"
              >
                <OCard
                  class="chart-card tw:cursor-pointer"
                  :class="{
                    'selected-chart': selectedChart?.value === chart.value,
                  }"
                  @click="selectChart(chart)"
                  data-test="chart-type-card"
                >
                  <OCardSection class="tw:p-2">
                    <div class="chart-image-container">
                      <img
                        :src="chart.asset"
                        :alt="chart.label"
                        class="chart-image"
                        loading="lazy"
                      />
                    </div>
                  </OCardSection>
                  <OCardSection class="tw:pt-0 tw:px-2 tw:pb-2">
                    <div class="tw:text-xs tw:text-center text-weight-medium">
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
      title="Confirm Chart Type Selection"
      message="By selecting this chart type, the existing chart code will be replaced by the selected chart type's code. Do you want to continue?"
      :currentQuery="currentQuery"
      @update:ok="confirmChartSelection"
      @update:cancel="cancelChartSelection"
      v-model="confirmChartSelectionDialog"
    />
  </OCard>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  nextTick,
  computed,
  inject,
} from "vue";
import { useI18n } from "vue-i18n";
import type { ChartType, ChartCategory } from "./customChartExampleTypes";
import { chartTypesData } from "./customChartExampleTypes";
import CustomChartConfirmDialog from "@/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
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
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const chartCategories = ref<ChartCategory[]>(chartTypesData.data);
    const selectedCategory = ref<string>(
      chartCategories.value[0]?.chartLabel || "",
    );
    const selectedChart = ref<ChartType | null>(null);
    const contentArea = ref<HTMLElement | null>(null);
    const confirmChartSelectionDialog = ref<boolean>(false);
    const pendingChartSelection = ref<ChartType | null>(null);
    const searchQuery = ref<string>("");

    // Get current query for the dialog
    const currentQuery = computed(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex || 0
        ]?.query || "",
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
      const sections = contentArea.value.querySelectorAll(
        ".chart-category-section",
      );

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

<style lang="scss" scoped>
.sidebar {
  .chart-category-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .sidebar-item {
    border-radius: 4px;
    margin-bottom: 4px;
    transition: all 0.2s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }

    &.active-category {
      background-color: var(--q-primary);
      color: white;
      font-weight: 600;
    }
  }
}

.content-area {
  .chart-category-section {
    scroll-margin-top: 20px;
  }

  .chart-card {
    transition: all 0.2s ease;
    height: 100%;

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transform: translateY(-2px);
    }

    &.selected-chart {
      border: 2px solid var(--q-primary);
      box-shadow: 0 4px 12px rgba(var(--q-primary-rgb), 0.3);
    }

    .chart-image-container {
      width: 100%;
      height: 150px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f8f8f8;
      border-radius: 4px;
      overflow: hidden;

      .chart-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
  }
}
</style>
