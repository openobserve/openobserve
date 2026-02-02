<!-- Copyright 2023 OpenObserve Inc.

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
  <q-card
    data-test="custom-chart-type-selector-popup"
    style="
      padding: 0;
      width: 95vw;
      height: calc(100vh - 57px);
      max-width: 1800px;
      overflow: hidden;
    "
  >
    <!-- Header -->
    <q-card-section>
      <div class="flex justify-between items-center q-pa-none">
        <div class="flex items-center q-table__title">
          <q-icon name="bar_chart" size="sm" class="q-mr-sm" />
          <span class="text-h6">Example of custom charts</span>
        </div>
        <q-space />
        <q-input
          v-model="searchQuery"
          dense
          borderless
          placeholder="Search charts..."
          style="min-width: 250px; border-radius: 4px; padding: 2px 8px"
          clearable
          @clear="searchQuery = ''"
        >
          <template v-slot:prepend>
            <q-icon name="search" />
          </template>
        </q-input>
        <q-btn
          icon="close"
          class="q-ml-xs"
          unelevated
          size="sm"
          round
          flat
          :title="t('dashboard.cancel')"
          @click.stop="closeDialog"
          data-test="custom-chart-type-selector-close"
        />
      </div>
    </q-card-section>

    <q-separator />

    <!-- Main Content -->
    <q-card-section
      class="flex"
      style="height: calc(100% - 60px); overflow: hidden; padding: 0"
    >
      <div class="row no-wrap" style="height: 100%; width: 100%">
        <!-- Left Sidebar -->
        <q-card
          flat
          class="sidebar q-pa-md"
          style="width: 160px; height: 100%; flex-shrink: 0; overflow-y: auto"
        >
          <div class="text-subtitle2 q-mb-md text-weight-bold">Chart Types</div>
          <q-list dense>
            <q-item
              v-for="(category, index) in chartCategories"
              :key="index"
              clickable
              v-ripple
              :active="selectedCategory === category.chartLabel"
              @click="scrollToCategory(category.chartLabel)"
              class="sidebar-item"
              :class="{
                'active-category': selectedCategory === category.chartLabel,
              }"
              data-test="chart-category-item"
            >
              <q-item-section>
                <q-item-label>{{ category.chartLabel }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <!-- Right Content Area -->
        <div
          ref="contentArea"
          class="content-area q-pa-md"
          style="flex: 1; height: 100%; overflow-y: auto; overflow-x: hidden"
          @scroll="handleScroll"
        >
          <!-- No Results Message -->
          <div
            v-if="filteredCategories.length === 0"
            class="flex justify-center items-center"
            style="height: 100%"
          >
            <div class="text-center">
              <q-icon name="search_off" size="4rem" color="grey-5" />
              <div class="text-h6 text-grey-7 q-mt-md">No results found</div>
              <div class="text-body2 text-grey-6 q-mt-sm">
                Try searching with different keywords
              </div>
            </div>
          </div>

          <!-- Chart Categories -->
          <div
            v-for="(category, categoryIndex) in filteredCategories"
            :key="categoryIndex"
            class="chart-category-section q-mb-xl"
            :data-category="category.chartLabel"
          >
            <div class="text-h6 q-mb-md text-weight-medium">
              {{ category.chartLabel }}
            </div>
            <div class="row q-col-gutter-md">
              <div
                v-for="(chart, chartIndex) in category.type"
                :key="chartIndex"
                class="col-xs-12 col-sm-6 col-md-4 col-lg-3"
              >
                <q-card
                  flat
                  bordered
                  class="chart-card cursor-pointer"
                  :class="{
                    'selected-chart': selectedChart?.value === chart.value,
                  }"
                  @click="selectChart(chart)"
                  data-test="chart-type-card"
                >
                  <q-card-section class="q-pa-sm">
                    <div class="chart-image-container">
                      <img
                        :src="chart.asset"
                        :alt="chart.label"
                        class="chart-image"
                        loading="lazy"
                      />
                    </div>
                  </q-card-section>
                  <q-card-section class="q-pt-none q-px-sm q-pb-sm">
                    <div class="text-caption text-center text-weight-medium">
                      {{ chart.label }}
                    </div>
                  </q-card-section>
                </q-card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-card-section>

    <!-- Confirm Chart Selection Dialog -->
    <CustomChartConfirmDialog
      title="Confirm Chart Type Selection"
      message="By selecting this chart type, the existing chart code will be replaced by the selected chart type's code. Do you want to continue?"
      :currentQuery="currentQuery"
      @update:ok="confirmChartSelection"
      @update:cancel="cancelChartSelection"
      v-model="confirmChartSelectionDialog"
    />
  </q-card>
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
import useDashboardPanelData from "@/composables/useDashboardPanel";

export default defineComponent({
  name: "CustomChartTypeSelector",
  components: {
    CustomChartConfirmDialog,
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

      const element = contentArea.value.querySelector(
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
