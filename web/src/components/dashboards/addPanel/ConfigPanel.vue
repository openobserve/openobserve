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
  <div v-if="dashboardPanelData.data.type == 'custom_chart'" class="tw:pb-8">
    <div class="tw:max-w-[300px]">
      <div class="q-mb-sm tw:font-semibold">
        {{ t("dashboard.description") }}
      </div>
      <q-input
        borderless
        v-model="dashboardPanelData.data.description"
        autogrow
        class="showLabelOnTop el-border"
        data-test="dashboard-config-description"
        hide-bottom-space
      />
    </div>
  </div>
  <div v-else class="tw:pb-8">
    <!-- Search bar -->
    <div class="config-search-wrapper tw:sticky">
      <div class="row no-wrap items-center" style="gap: 4px">
        <q-btn
          flat
          round
          dense
          :icon="allSectionsExpanded ? 'unfold_less' : 'unfold_more'"
          size="sm"
          class="text-grey-6"
          @click="toggleAllSections"
        >
        </q-btn>
        <q-input
          v-model="searchQuery"
          dense
          borderless
          placeholder="Search config..."
          class="col"
          clearable
        >
          <template #prepend>
            <q-icon name="search" size="xs" class="q-ml-xs text-grey-6" />
          </template>
        </q-input>
      </div>
    </div>

    <!-- No results empty state -->
    <div
      v-if="searchQuery && !anySectionVisible"
      class="config-no-results column items-center q-py-lg"
    >
      <q-icon name="search_off" size="24px" class="q-mb-xs text-grey-5" />
      <div class="text-grey-6 text-caption">
        No settings found for "{{ searchQuery }}"
      </div>
    </div>

    <!-- Section: General -->
    <q-expansion-item
      v-show="sectionVisible(generalKeywords)"
      :model-value="isExpanded('general', generalKeywords)"
      @update:model-value="(v) => { expandedSections.general = v; }"
      label="General"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <div v-show="itemVisible(['description'])" class="tw:max-w-[300px]">
          <div class="q-mb-sm tw:font-semibold">
            {{ t("dashboard.description") }}
          </div>
          <q-input
            borderless
            v-model="dashboardPanelData.data.description"
            autogrow
            class="showLabelOnTop el-border"
            data-test="dashboard-config-description"
            hide-bottom-space
          />
        </div>

        <q-input
          v-if="promqlMode"
          v-show="itemVisible(['step', 'step value', 'promql step'])"
          v-model="dashboardPanelData.data.config.step_value"
          type="text"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          placeholder="e.g., 30s, 1m, 5m, 1h"
          data-test="dashboard-config-step-value"
          hide-bottom-space
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.stepValue") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-top_results-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                  max-width="250px"
                >
                  <b>Step - </b>
                  {{ t("dashboard.stepValueTooltip") }}
                  <br />
                  {{ t("dashboard.stepValueExample") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>

        <!-- Panel Default Time Configuration -->
        <div
          v-show="
            itemVisible([
              'panel time',
              'default time',
              'use default time',
              'duration',
              'set panel time',
              'panel default time',
            ])
          "
          class="q-mb-sm"
        >
          <div class="row items-center">
            <q-toggle
              v-model="useDefaultTime"
              :label="t('dashboard.panelTimeEnabled')"
              data-test="dashboard-config-allow-panel-time"
              @update:model-value="onToggleDefaultTime"
              class="tw:h-[36px] o2-toggle-button-lg"
              size="lg"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-lg-dark'
                  : 'o2-toggle-button-lg-light'
              "
            />
            <q-btn
              no-caps
              padding="xs"
              size="sm"
              flat
              icon="info_outline"
              class="q-mt-xs"
            >
              <q-tooltip
                anchor="bottom middle"
                self="top middle"
                style="font-size: 10px"
                max-width="250px"
              >
                <span>
                  {{ t("dashboard.useDefaultTimeTooltip") }}
                </span>
              </q-tooltip>
            </q-btn>
          </div>

          <div v-if="useDefaultTime" class="q-mt-sm">
            <div class="text-bold q-mb-xs">
              {{ t("dashboard.defaultDuration") }}
            </div>
            <div
              v-if="
                
            showTimePicker ||
               
            (panelTimeRange !== null && panelTimeRange !== undefined)
              
          "
              class="flex items-center no-wrap panel-time-picker-container"
            >
              <div class="panel-time-picker-btn">
                <DateTimePickerDashboard
                  ref="panelTimePickerRef"
                  v-model="pickerValue"
                  :auto-apply-dashboard="true"
                  :hide-relative-timezone="true"
                  data-test="dashboard-config-panel-time-picker"
                />
                <q-tooltip
                  anchor="bottom middle"
                  self="top middle"
                  style="font-size: 11px"
                  max-width="320px"
                >
                  {{ formattedPickerValue }}
                </q-tooltip>
              </div>
              <q-icon
                class="q-mr-xs q-ml-sm flex-shrink-0"
                size="15px"
                name="close"
                style="cursor: pointer; flex-shrink: 0"
                data-test="dashboard-config-cancel-panel-time"
                @click="onCancelPanelTime"
              />
            </div>
            <div v-else>
              <q-btn
                @click="showTimePicker = true"
                style="cursor: pointer; padding: 0px 5px"
                :label="t('common.set')"
                class="el-border"
                no-caps
                data-test="dashboard-config-set-panel-time"
              />
            </div>
          </div>
        </div>

        <PromQLChartConfig
          v-if="promqlMode"
          v-show="
            itemVisible(['promql', 'step', 'chart config', 'promql chart'])
          "
          :chart-type="dashboardPanelData.data.type"
        />
      </div>
    </q-expansion-item>

    <!-- Section: Legend -->
    <q-expansion-item
      v-show="sectionVisible(legendKeywords) && legendSectionHasContent"
      :model-value="isExpanded('legend', legendKeywords)"
      @update:model-value="(v) => { expandedSections.legend = v; }"
      label="Legend"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-toggle
          v-if="shouldShowLegendsToggle(dashboardPanelData)"
          v-show="itemVisible(['legend', 'show legend', 'legends'])"
          v-model="dashboardPanelData.data.config.show_legends"
          :label="t('dashboard.showLegendsLabel')"
          data-test="dashboard-config-show-legend"
          class="tw:h-[36px] o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

    <div class="space"></div>

    <q-toggle
      v-if="dashboardPanelData.data.type == 'table'"
      v-model="dashboardPanelData.data.config.wrap_table_cells"
      :label="t('dashboard.wraptext')"
      data-test="dashboard-config-wrap-table-cells"
      class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
      size="lg"
      :class="
        store.state.theme === 'dark'
          ? 'o2-toggle-button-lg-dark'
          : 'o2-toggle-button-lg-light'
      "
    />

    <div class="space"></div>

    <q-toggle
      v-if="dashboardPanelData.data.type == 'table' && !promqlMode"
      v-model="dashboardPanelData.data.config.table_transpose"
      :label="t('dashboard.tableTranspose')"
      data-test="dashboard-config-table_transpose"
      class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
      size="lg"
      :class="
        store.state.theme === 'dark'
          ? 'o2-toggle-button-lg-dark'
          : 'o2-toggle-button-lg-light'
      "
      :disable="isPivotMode"
    />

    <div class="space"></div>

    <q-toggle
      v-if="dashboardPanelData.data.type == 'table' && !promqlMode"
      v-model="dashboardPanelData.data.config.table_dynamic_columns"
      :label="t('dashboard.tableDynamicColumns')"
      data-test="dashboard-config-table_dynamic_columns"
      class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
      size="lg"
      :class="
        store.state.theme === 'dark'
          ? 'o2-toggle-button-lg-dark'
          : 'o2-toggle-button-lg-light'
      "
      :disable="isPivotMode"
    />
    <div class="space"></div>

   

    <q-toggle
      v-if="dashboardPanelData.data.type == 'table'"
      v-model="dashboardPanelData.data.config.table_pagination"
      :label="t('dashboard.pagination')"
      data-test="dashboard-config-show-pagination"
      class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
      size="lg"
      :class="
        store.state.theme === 'dark'
          ? 'o2-toggle-button-lg-dark'
          : 'o2-toggle-button-lg-light'
      "
    />

    <div class="space"></div>

    <q-input
      v-if="
        dashboardPanelData.data.type == 'table' &&
        dashboardPanelData.data.config.table_pagination
      "
      v-model.number="
        dashboardPanelData.data.config.table_pagination_rows_per_page
      "
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      dense
      label-slot
      data-test="dashboard-config-rows-per-page"
      borderless
      hide-bottom-space
      type="number"
      placeholder="Auto"
      min="1"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          {{ t("dashboard.rowsPerPage") }}
          <div>
            <q-icon
              class="q-ml-xs"
              size="20px"
              name="info"
              data-test="dashboard-config-rows-per-page-info"
            />
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.rowsPerPageTooltip") }}
            </q-tooltip>
          </div>
        </div>
      </template>
    </q-input>

    <div class="space"></div>

    <!-- Pivot Table Options (shown when pivot mode active) -->
    <div
      v-if="
        dashboardPanelData.data.type == 'table' && !promqlMode && isPivotMode
      "
      class="q-mb-sm"
    >
      <div class="q-mb-xs" style="font-weight: 600; font-size: 12px">
        {{ t("dashboard.pivotOptions") }}
      </div>
      <div class="row items-center">
        <q-toggle
          v-model="dashboardPanelData.data.config.table_pivot_show_row_totals"
          :label="t('dashboard.pivotShowRowTotals')"
          data-test="dashboard-config-pivot-row-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />
        <div>
          <q-icon
            class="q-ml-xs"
            size="20px"
            name="info"
            data-test="dashboard-config-pivot-row-totals-info"
          />
          <q-tooltip
            class="bg-grey-8"
            anchor="top middle"
            self="bottom middle"
            max-width="250px"
          >
            {{ t("dashboard.pivotShowRowTotalsTooltip") }}
          </q-tooltip>
        </div>
      </div>
      <div
        v-if="dashboardPanelData.data.config.table_pivot_show_row_totals"
        class="row items-center q-ml-md"
      >
        <q-toggle
          v-model="dashboardPanelData.data.config.table_pivot_sticky_col_totals"
          :label="t('dashboard.pivotStickyColTotals')"
          data-test="dashboard-config-pivot-sticky-col-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />
        <div>
          <q-icon
            class="q-ml-xs"
            size="20px"
            name="info"
            data-test="dashboard-config-pivot-sticky-col-totals-info"
          />
          <q-tooltip
            class="bg-grey-8"
            anchor="top middle"
            self="bottom middle"
            max-width="250px"
          >
            {{ t("dashboard.pivotStickyColTotalsTooltip") }}
          </q-tooltip>
        </div>
      </div>
      <div class="row items-center">
        <q-toggle
          v-model="dashboardPanelData.data.config.table_pivot_show_col_totals"
          :label="t('dashboard.pivotShowColTotals')"
          data-test="dashboard-config-pivot-col-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />
        <div>
          <q-icon
            class="q-ml-xs"
            size="20px"
            name="info"
            data-test="dashboard-config-pivot-col-totals-info"
          />
          <q-tooltip
            class="bg-grey-8"
            anchor="top middle"
            self="bottom middle"
            max-width="250px"
          >
            {{ t("dashboard.pivotShowColTotalsTooltip") }}
          </q-tooltip>
        </div>
      </div>
      <div
        v-if="dashboardPanelData.data.config.table_pivot_show_col_totals"
        class="row items-center q-ml-md"
      >
        <q-toggle
          v-model="dashboardPanelData.data.config.table_pivot_sticky_row_totals"
          :label="t('dashboard.pivotStickyRowTotals')"
          data-test="dashboard-config-pivot-sticky-row-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />
        <div>
          <q-icon
            class="q-ml-xs"
            size="20px"
            name="info"
            data-test="dashboard-config-pivot-sticky-row-totals-info"
          />
          <q-tooltip
            class="bg-grey-8"
            anchor="top middle"
            self="bottom middle"
            max-width="250px"
          >
            {{ t("dashboard.pivotStickyRowTotalsTooltip") }}
          </q-tooltip>
        </div>
      </div>
    </div>
    <div class="space"></div>

    <div class="o2-input">
      <q-select
        v-if="shouldShowLegendPosition(dashboardPanelData)"
        borderless
        v-model="dashboardPanelData.data.config.legends_position"
        :options="legendsPositionOptions"
        dense
        :label="t('dashboard.legendsPositionLabel')"
        class="showLabelOnTop"
        stack-label
        emit-value
        :display-value="`${
          dashboardPanelData.data.config.legends_position ?? 'Auto'
        }`"
        data-test="dashboard-config-legend-position"
        hide-bottom-space
      >
      </q-select>

      <div class="space"></div>

        <q-select
          v-if="shouldShowLegendType(dashboardPanelData)"
          v-show="
            itemVisible(['legend type', 'type', 'scroll', 'plain', 'legend'])
          "
          borderless
          v-model="dashboardPanelData.data.config.legends_type"
          :options="legendTypeOptions"
          dense
          :label="t('dashboard.legendsType')"
          class="showLabelOnTop"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.legends_type ?? 'Auto'
          }`"
          data-test="dashboard-config-legends-scrollable"
          hide-bottom-space
        >
        </q-select>

        <div
          v-show="
            itemVisible([
              'legend width',
              'legend height',
              'width',
              'height',
              'legend',
            ])
          "
          style="display: flex; gap: 8px; flex-wrap: wrap"
        >
          <!-- Legend Width + unit selector -->
          <div
            v-if="shouldShowLegendWidth(dashboardPanelData)"
            class="input-container"
          >
            <q-input
              v-model.number="legendWidthValue"
              :label="t('common.legendWidth')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop config-legend-input"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              placeholder="Auto"
              data-test="dashboard-config-legend-width"
              hide-bottom-space
            ></q-input>
            <div
              class="unit-container"
              v-if="shouldShowLegendWidthUnitContainer(dashboardPanelData)"
            >
              <button
                @click="setUnit('px')"
                :class="{
                  active:
                    dashboardPanelData?.data?.config.legend_width?.unit ===
                      null ||
                    dashboardPanelData?.data?.config?.legend_width?.unit ===
                      'px',
                }"
                style="height: 100%; width: 100%; font-size: 14px"
                :data-test="`dashboard-config-legend-width-unit-${
                  dashboardPanelData?.data?.config?.legend_width?.unit === 'px'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                px
              </button>
              <button
                @click="setUnit('%')"
                :class="{
                  active:
                    dashboardPanelData?.data?.config?.legend_width?.unit ===
                    '%',
                }"
                style="height: 100%; width: 100%; font-size: 14px"
                :data-test="`dashboard-config-legend-width-unit-${
                  dashboardPanelData?.data?.config?.legend_width?.unit === '%'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                %
              </button>
            </div>
          </div>

          <!-- Legend Height + unit selector -->
          <div
            v-if="shouldShowLegendHeight(dashboardPanelData)"
            class="input-container"
          >
            <q-input
              v-model.number="legendHeightValue"
              :label="t('dashboard.legendHeight')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop config-legend-input"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              placeholder="Auto"
              data-test="dashboard-config-legend-height"
              hide-bottom-space
            ></q-input>
            <div
              class="unit-container"
              v-if="shouldShowLegendHeightUnitContainer(dashboardPanelData)"
            >
              <button
                @click="setHeightUnit('px')"
                :class="{
                  active:
                    dashboardPanelData?.data?.config.legend_height?.unit ===
                      null ||
                    dashboardPanelData?.data?.config?.legend_height?.unit ===
                      'px',
                }"
                style="height: 100%; width: 100%; font-size: 14px"
                :data-test="`dashboard-config-legend-height-unit-${
                  dashboardPanelData?.data?.config?.legend_height?.unit === 'px'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                px
              </button>
              <button
                @click="setHeightUnit('%')"
                :class="{
                  active:
                    dashboardPanelData?.data?.config?.legend_height?.unit ===
                    '%',
                }"
                style="height: 100%; width: 100%; font-size: 14px"
                :data-test="`dashboard-config-legend-height-unit-${
                  dashboardPanelData?.data?.config?.legend_height?.unit === '%'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                %
              </button>
            </div>
          </div>
        </div>

        <q-select
          v-if="shouldApplyChartAlign(dashboardPanelData)"
          v-show="itemVisible(['align', 'chart align', 'chart alignment'])"
          borderless
          v-model="dashboardPanelData.data.config.chart_align"
          :options="chartAlignOptions"
          dense
          :label="t('dashboard.chartAlign')"
          class="showLabelOnTop"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.chart_align ?? 'Auto'
          }`"
          data-test="dashboard-config-chart-align"
          hide-bottom-space
        >
        </q-select>

        <div
          v-if="
            promqlMode &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="itemVisible(['promql legend', 'legend', 'query'])"
          class="showLabelOnTop"
          style="font-weight: 600"
        >
          {{ t("dashboard.query") }}
          <q-tabs
            v-model="dashboardPanelData.layout.currentQueryIndex"
            narrow-indicator
            dense
            inline-label
            outside-arrows
            mobile-arrows
            data-test="dashboard-config-query-tab"
          >
            <q-tab
              no-caps
              v-for="(tab, index) in dashboardPanelData.data.queries"
              :key="index"
              :name="index"
              :label="t('dashboard.queryLabel') + ' ' + (index + 1)"
              :data-test="`dashboard-config-query-tab-${index}`"
            >
            </q-tab>
          </q-tabs>
        </div>

        <CommonAutoComplete
          v-if="
            promqlMode &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="itemVisible(['promql legend', 'legend', 'legend label'])"
          :label="t('common.legend')"
          v-model="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.promql_legend
          "
          :items="dashboardSelectfieldPromQlList"
          searchRegex="(?:{([^}]*)(?:{.*})*$|([a-zA-Z-_]+)$)"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          label-slot
          style="
            top: none !important;
            margin-top: none !important;
            padding-top: 3px !important;
            width: auto !important;
          "
          :value-replace-fn="selectPromQlNameOption"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.legendLabel") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-promql-legend-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  {{ t("dashboard.overrideMessage") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </CommonAutoComplete>
      </div>
    </q-expansion-item>

    <!-- Section: Data -->
    <q-expansion-item
      v-show="sectionVisible(dataKeywords) && dataSectionHasVisibleContent"
      :model-value="isExpanded('data', dataKeywords)"
      @update:model-value="(v) => { expandedSections.data = v; }"
      label="Data"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-select
          v-show="itemVisible(['unit'])"
          borderless
          v-model="dashboardPanelData.data.config.unit"
          :options="unitOptions"
          dense
          :label="t('dashboard.unitLabel')"
          class="showLabelOnTop selectedLabel"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.unit
              ? unitOptions.find(
                  (it) => it.value == dashboardPanelData.data.config.unit,
                )?.label
              : 'Default'
          }`"
          data-test="dashboard-config-unit"
        >
        </q-select>

        <q-input
          v-if="dashboardPanelData.data.config.unit == 'custom'"
          v-show="itemVisible(['custom unit', 'unit'])"
          v-model="dashboardPanelData.data.config.unit_custom"
          :label="t('dashboard.customunitLabel')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          dense
          label-slot
          data-test="dashboard-config-custom-unit"
          borderless
          hide-bottom-space
        />

        <q-input
          v-show="itemVisible(['decimals'])"
          type="number"
          v-model.number="dashboardPanelData.data.config.decimals"
          value="2"
          min="0"
          max="100"
          borderless
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.config.decimals =
                typeof value == 'number' && value >= 0 ? value : 2)
          "
          :rules="[
            (val: any) =>
              (val >= 0 && val <= 100) || t('dashboard.decimalsMustBeBetween'),
          ]"
          :label="t('dashboard.decimals')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          hide-bottom-space
          dense
          label-slot
          data-test="dashboard-config-decimals"
        />

        <q-input
          v-if="
            !promqlMode &&
            !dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].customQuery
          "
          v-show="itemVisible(['limit', 'query limit'])"
          v-model.number="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.limit
          "
          :value="0"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.limit = value ? value : 0)
          "
          :label="t('dashboard.limit')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          placeholder="0"
          :type="'number'"
          data-test="dashboard-config-limit"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.queryLimit") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-limit-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  {{ t("dashboard.limitForQueryResult") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>

        <q-input
          v-if="shouldShowTopResultsConfig(dashboardPanelData, promqlMode)"
          v-show="
            itemVisible(['top results', 'top n', 'show top n', 'top n values'])
          "
          v-model.number="dashboardPanelData.data.config.top_results"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.config.top_results = value
                ? value
                : null)
          "
          :label="t('dashboard.topResults')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          placeholder="ALL"
          :type="'number'"
          :disable="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.breakdown?.length == 0
          "
          data-test="dashboard-config-top_results"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.showTopNValues") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-top_results-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                  max-width="250px"
                >
                  <b>{{ t("dashboard.topNTooltipTitle") }}</b>
                  <br />
                  <br />
                  {{ t("dashboard.topNTooltipDescription") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>

        <div
          class="row items-center"
          v-if="shouldShowTopResultsConfig(dashboardPanelData, promqlMode)"
          v-show="
            itemVisible([
              'others',
              'others series',
              'top results others',
              'add others',
            ])
          "
        >
          <q-toggle
            v-model="dashboardPanelData.data.config.top_results_others"
            :label="t('dashboard.addOthersSeries')"
            data-test="dashboard-config-top_results_others"
            :disable="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.breakdown?.length == 0
            "
            class="tw:h-[36px] o2-toggle-button-lg"
            size="lg"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-lg-dark'
                : 'o2-toggle-button-lg-light'
            "
          >
            <q-icon
              class="q-ml-xs"
              size="20px"
              name="info"
              data-test="dashboard-config-top_results-others-info"
            >
              <q-tooltip
                class="bg-grey-8"
                anchor="top middle"
                self="bottom middle"
                max-width="250px"
              >
                {{ t("dashboard.addOthersSeriesTooltip") }}
              </q-tooltip>
            </q-icon>
          </q-toggle>
        </div>

        <q-toggle
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="itemVisible(['connect null', 'connect null values', 'null'])"
          v-model="dashboardPanelData.data.config.connect_nulls"
          :label="t('dashboard.connectNullValues')"
          data-test="dashboard-config-connect-null-values"
          class="tw:h-[36px] o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        >
          <q-icon
            class="q-ml-xs"
            size="20px"
            name="info"
            data-test="dashboard-config-connect-null-values-info"
          >
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.connectNullValuesTooltip") }}
            </q-tooltip>
          </q-icon>
        </q-toggle>

        <q-input
          v-if="shouldShowNoValueReplacement(dashboardPanelData, promqlMode)"
          v-show="itemVisible(['no value', 'no value replacement'])"
          v-model="dashboardPanelData.data.config.no_value_replacement"
          :label="t('dashboard.noValueReplacement')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          dense
          label-slot
          placeholder="-"
          data-test="dashboard-config-no-value-replacement"
          borderless
          hide-bottom-space
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.noValueReplacement") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-limit-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  {{ t("dashboard.noValueReplacementTooltip") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>
      </div>
    </q-expansion-item>

    <!-- Section: Axis -->
    <q-expansion-item
      v-show="sectionVisible(axisKeywords) && axisSectionHasContent"
      :model-value="isExpanded('axis', axisKeywords)"
      @update:model-value="(v) => { expandedSections.axis = v; }"
      label="Axis"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-input
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="itemVisible(['axis width'])"
          v-model.number="dashboardPanelData.data.config.axis_width"
          :label="t('common.axisWidth')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          placeholder="Auto"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.config.axis_width =
                value !== '' ? value : null)
          "
          data-test="dashboard-config-axis-width"
        >
        </q-input>

        <q-toggle
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="itemVisible(['border', 'axis border', 'show border'])"
          v-model="dashboardPanelData.data.config.axis_border_show"
          :label="t('dashboard.showBorder')"
          data-test="dashboard-config-axis-border"
          class="tw:h-[36px] o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <div
          style="width: 100%; display: flex; gap: 16px"
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="
            itemVisible([
              'y axis',
              'y min',
              'y max',
              'y-axis min',
              'y-axis max',
              'y axis min',
              'y axis max',
            ])
          "
        >
          <q-input
            v-model.number="dashboardPanelData.data.config.y_axis_min"
            color="input-border"
            bg-color="input-bg"
            style="width: 50%"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            placeholder="Auto"
            @update:model-value="
              (value: any) =>
                (dashboardPanelData.data.config.y_axis_min =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-y_axis_min"
          >
            <template v-slot:label>
              <div style="display: flex; align-items: center; gap: 4px">
                <span>{{ t("common.yAxisMin") }}</span>
                <q-icon
                  name="info"
                  size="20px"
                  style="cursor: pointer"
                  data-test="dashboard-config-y_axis_min-info"
                >
                  <q-tooltip
                    class="bg-grey-8"
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[0, 8]"
                  >
                    <b>{{ t("dashboard.yAxisMinTooltipTitle") }}</b>
                    <br />
                    {{ t("dashboard.yAxisMinTooltipDescription") }}
                  </q-tooltip>
                </q-icon>
              </div>
            </template>
          </q-input>
          <q-input
            v-model.number="dashboardPanelData.data.config.y_axis_max"
            color="input-border"
            bg-color="input-bg"
            style="width: 50%"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            placeholder="Auto"
            @update:model-value="
              (value: any) =>
                (dashboardPanelData.data.config.y_axis_max =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-y_axis_max"
          >
            <template v-slot:label>
              <div style="display: flex; align-items: center; gap: 4px">
                <span>{{ t("common.yAxisMax") }}</span>
                <q-icon
                  name="info"
                  size="20px"
                  style="cursor: pointer"
                  data-test="dashboard-config-y_axis_max-info"
                >
                  <q-tooltip
                    class="bg-grey-8"
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[0, 8]"
                  >
                    <b>{{ t("dashboard.yAxisMaxTooltipTitle") }}</b>
                    <br />
                    {{ t("dashboard.yAxisMaxTooltipDescription") }}
                  </q-tooltip>
                </q-icon>
              </div>
            </template>
          </q-input>
        </div>

        <q-toggle
          v-if="shouldShowGridlines(dashboardPanelData)"
          v-show="itemVisible(['gridlines', 'grid', 'show gridlines'])"
          v-model="dashboardPanelData.data.config.show_gridlines"
          :label="t('dashboard.showGridlines')"
          data-test="dashboard-config-show-gridlines"
          class="tw:h-[36px] o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />
      </div>
    </q-expansion-item>

    <!-- Section: Labels -->
    <q-expansion-item
      v-show="sectionVisible(labelsKeywords) && labelsSectionHasContent"
      :model-value="isExpanded('labels', labelsKeywords)"
      @update:model-value="(v) => { expandedSections.labels = v; }"
      label="Labels"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-select
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="itemVisible(['label position', 'position', 'label'])"
          borderless
          v-model="dashboardPanelData.data.config.label_option.position"
          :options="labelPositionOptions"
          dense
          :label="t('dashboard.labelPosition')"
          class="showLabelOnTop selectedLabel"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.label_option.position
              ? labelPositionOptions.find(
                  (it) =>
                    it.value ==
                    dashboardPanelData.data.config.label_option.position,
                )?.label
              : 'None'
          }`"
          data-test="dashboard-config-label-position"
        >
        </q-select>

        <q-input
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="itemVisible(['label rotate', 'rotate', 'label'])"
          v-model.number="dashboardPanelData.data.config.label_option.rotate"
          :label="t('dashboard.labelRotate')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          placeholder="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.config.label_option.rotate =
                value !== '' ? value : 0)
          "
          data-test="dashboard-config-label-rotate"
        >
        </q-input>

        <div
          style="width: 100%; display: flex; gap: 16px"
          v-if="shouldShowAxisLabelConfig(dashboardPanelData)"
          v-show="
            itemVisible([
              'axis label',
              'axis label rotate',
              'axis label truncate',
              'rotate',
              'truncate',
            ])
          "
        >
          <q-input
            v-model.number="dashboardPanelData.data.config.axis_label_rotate"
            color="input-border"
            bg-color="input-bg"
            style="width: 50%"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            placeholder="0"
            @update:model-value="
              (value: any) =>
                (dashboardPanelData.data.config.axis_label_rotate =
                  value !== '' ? value : 0)
            "
            data-test="dashboard-config-axis-label-rotate"
          >
            <template v-slot:label>
              <div style="display: flex; align-items: center; gap: 4px">
                <span>Label Rotate</span>
                <q-icon
                  name="info"
                  size="20px"
                  style="cursor: pointer"
                  data-test="dashboard-config-axis-label-rotate-info"
                >
                  <q-tooltip
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[0, 8]"
                    class="bg-grey-8"
                  >
                    <div>
                      Rotate the x-axis label text by a chosen angle (in
                      degrees) to improve readability when labels are long or
                      crowded.
                      <br /><br />
                      <strong>Note:</strong> This option is not supported for
                      time-series x-axis fields.
                    </div>
                  </q-tooltip>
                </q-icon>
              </div>
            </template>
          </q-input>
          <q-input
            v-model.number="
              dashboardPanelData.data.config.axis_label_truncate_width
            "
            color="input-border"
            bg-color="input-bg"
            style="width: 50%"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            placeholder="0"
            @update:model-value="
              (value: any) =>
                (dashboardPanelData.data.config.axis_label_truncate_width =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-axis-label-truncate-width"
          >
            <template v-slot:label>
              <div style="display: flex; align-items: center; gap: 4px">
                <span>Label Truncate</span>
                <q-icon
                  name="info"
                  size="20px"
                  style="cursor: pointer"
                  data-test="dashboard-config-axis-label-truncate-info"
                >
                  <q-tooltip
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[0, 8]"
                    class="bg-grey-8"
                  >
                    <div>
                      Truncate x-axis labels to the specified width (in pixels).
                      <br /><br />
                      <strong>Note:</strong> This option is not supported for
                      time-series x-axis fields.
                    </div>
                  </q-tooltip>
                </q-icon>
              </div>
            </template>
          </q-input>
        </div>
      </div>
    </q-expansion-item>

    <!-- Section: Line Style -->
    <q-expansion-item
      v-show="sectionVisible(lineStyleKeywords) && lineStyleSectionHasContent"
      :model-value="isExpanded('lineStyle', lineStyleKeywords)"
      @update:model-value="(v) => { expandedSections.lineStyle = v; }"
      label="Line Style"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-select
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="itemVisible(['symbol', 'show symbol'])"
          borderless
          v-model="dashboardPanelData.data.config.show_symbol"
          :options="showSymbol"
          dense
          :label="t('dashboard.showSymbol')"
          class="showLabelOnTop selectedLabel"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.show_symbol
              ? showSymbol.find(
                  (it: any) =>
                    it.value == dashboardPanelData.data.config.show_symbol,
                )?.label
              : 'No'
          }`"
          data-test="dashboard-config-show_symbol"
        >
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section avatar style="height: 20px">
                <q-icon>
                  <component :is="scope.opt.iconComponent"></component>
                </q-icon>
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ scope.opt.label }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>

        <q-select
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="
            itemVisible([
              'interpolation',
              'line interpolation',
              'smooth',
              'step',
              'linear',
              'step before',
              'step after',
            ])
          "
          borderless
          v-model="dashboardPanelData.data.config.line_interpolation"
          :options="lineInterpolationOptions"
          dense
          :label="t('dashboard.lineInterpolation')"
          class="showLabelOnTop selectedLabel"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.line_interpolation
              ? lineInterpolationOptions.find(
                  (it: any) =>
                    it.value ==
                    dashboardPanelData.data.config.line_interpolation,
                )?.label
              : 'smooth'
          }`"
          data-test="dashboard-config-line_interpolation"
        >
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section avatar>
                <q-icon>
                  <component :is="scope.opt.iconComponent"></component>
                </q-icon>
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ scope.opt.label }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>

        <q-input
          v-if="shouldShowLineThickness(dashboardPanelData, promqlMode)"
          v-show="itemVisible(['line thickness', 'thickness'])"
          v-model.number="dashboardPanelData.data.config.line_thickness"
          :value="1.5"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.config.line_thickness =
                typeof value == 'number' && value >= 0 ? value : 1.5)
          "
          :label="t('dashboard.lineThickness')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :placeholder="t('dashboard.lineThicknessDefault')"
          :type="'number'"
          data-test="dashboard-config-line_thickness"
        >
        </q-input>
      </div>
    </q-expansion-item>

    <!-- Section: Table -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="sectionVisible(tableKeywords)"
      :model-value="isExpanded('table', tableKeywords)"
      @update:model-value="(v) => { expandedSections.table = v; }"
      label="Table"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-toggle
          v-show="itemVisible(['wrap', 'wrap text', 'wrap table'])"
          v-model="dashboardPanelData.data.config.wrap_table_cells"
          :label="t('dashboard.wraptext')"
          data-test="dashboard-config-wrap-table-cells"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-toggle
          v-if="!promqlMode"
          v-show="itemVisible(['transpose', 'table transpose'])"
          v-model="dashboardPanelData.data.config.table_transpose"
          :label="t('dashboard.tableTranspose')"
          data-test="dashboard-config-table_transpose"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-toggle
          v-if="!promqlMode"
          v-show="itemVisible(['dynamic', 'dynamic columns', 'table dynamic'])"
          v-model="dashboardPanelData.data.config.table_dynamic_columns"
          :label="t('dashboard.tableDynamicColumns')"
          data-test="dashboard-config-table_dynamic_columns"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-toggle
          v-show="itemVisible(['pagination'])"
          v-model="dashboardPanelData.data.config.table_pagination"
          :label="t('dashboard.pagination')"
          data-test="dashboard-config-show-pagination"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-input
          v-if="dashboardPanelData.data.config.table_pagination"
          v-show="itemVisible(['rows per page', 'pagination'])"
          v-model.number="
            dashboardPanelData.data.config.table_pagination_rows_per_page
          "
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          dense
          label-slot
          data-test="dashboard-config-rows-per-page"
          borderless
          hide-bottom-space
          type="number"
          placeholder="Auto"
          min="1"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.rowsPerPage") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-rows-per-page-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                  max-width="250px"
                >
                  {{ t("dashboard.rowsPerPageTooltip") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>

        <ValueMapping v-show="itemVisible(['value mapping'])" />
        <OverrideConfig
          v-show="itemVisible(['override', 'column'])"
          :dashboardPanelData="dashboardPanelData"
          :panelData="panelData"
        />
      </div>
    </q-expansion-item>

    <!-- Section: Map -->
    <q-expansion-item
      v-if="
        dashboardPanelData.data.type == 'geomap' ||
        dashboardPanelData.data.type == 'maps'
      "
      v-show="sectionVisible(mapKeywords)"
      :model-value="isExpanded('map', mapKeywords)"
      @update:model-value="(v) => { expandedSections.map = v; }"
      label="Map"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-select
          v-if="dashboardPanelData.data.type == 'maps'"
          borderless
          v-model="dashboardPanelData.data.config.map_type.type"
          :options="mapTypeOptions"
          dense
          :label="t('dashboard.mapTypeLabel')"
          class="showLabelOnTop"
          stack-label
          emit-value
          data-test="dashboard-config-map-type"
          hide-bottom-space
        >
        </q-select>

        <q-select
          v-if="dashboardPanelData.data.type == 'geomap'"
          borderless
          v-model="dashboardPanelData.data.config.base_map.type"
          :options="basemapTypeOptions"
          dense
          :label="t('dashboard.basemapLabel')"
          class="showLabelOnTop"
          stack-label
          emit-value
          :display-value="'OpenStreetMap'"
          data-test="dashboard-config-basemap"
          hide-bottom-space
        >
        </q-select>

        <div v-if="dashboardPanelData.data.type == 'geomap'">
          <span>{{ t("dashboard.initialView") }}</span>
          <div class="row">
            <q-input
              v-model.number="dashboardPanelData.data.config.map_view.lat"
              :value="0"
              @blur="
                handleBlur(dashboardPanelData.data.config.map_view, 0, 'lat')
              "
              :label="t('dashboard.latitudeLabel')"
              color="input-border"
              bg-color="input-bg"
              class="col q-mr-sm q-py-md showLabelOnTop"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              data-test="dashboard-config-latitude"
              hide-bottom-space
            >
            </q-input>
            <q-input
              v-model.number="dashboardPanelData.data.config.map_view.lng"
              :value="0"
              @blur="
                handleBlur(dashboardPanelData.data.config.map_view, 0, 'lng')
              "
              :label="t('dashboard.longitudeLabel')"
              color="input-border"
              bg-color="input-bg"
              class="col q-mr-sm q-py-md showLabelOnTop"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              data-test="dashboard-config-longitude"
              hide-bottom-space
            >
            </q-input>
          </div>
          <q-input
            v-model.number="dashboardPanelData.data.config.map_view.zoom"
            :value="1"
            @blur="
              handleBlur(dashboardPanelData.data.config.map_view, 1, 'zoom')
            "
            :label="t('dashboard.zoomLabel')"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            data-test="dashboard-config-zoom"
            hide-bottom-space
          >
          </q-input>

          <q-select
            v-model="dashboardPanelData.data.config.map_symbol_style.size"
            :label="t('dashboard.symbolsize')"
            borderless
            :options="symbolOptions"
            dense
            class="showLabelOnTop"
            stack-label
            emit-value
            :display-value="`${dashboardPanelData.data.config.map_symbol_style.size}`"
            data-test="dashboard-config-symbol"
            hide-bottom-space
          >
          </q-select>

          <div class="row">
            <q-input
              v-if="
                dashboardPanelData.data.config.map_symbol_style.size ===
                'by Value'
              "
              v-model.number="
                dashboardPanelData.data.config.map_symbol_style.size_by_value
                  .min
              "
              :value="1"
              @blur="
                handleBlur(
                  dashboardPanelData.data.config.map_symbol_style.size_by_value,
                  1,
                  'min',
                )
              "
              :label="t('dashboard.minimum')"
              color="input-border"
              bg-color="input-bg"
              class="col-6 q-py-md showLabelOnTop"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              data-test="dashboard-config-map-symbol-min"
              :min="0"
              hide-bottom-space
            >
            </q-input>

            <q-input
              v-if="
                dashboardPanelData.data.config.map_symbol_style.size ===
                'by Value'
              "
              v-model.number="
                dashboardPanelData.data.config.map_symbol_style.size_by_value
                  .max
              "
              :value="100"
              @blur="
                handleBlur(
                  dashboardPanelData.data.config.map_symbol_style.size_by_value,
                  100,
                  'max',
                )
              "
              :label="t('dashboard.maximum')"
              color="input-border"
              bg-color="input-bg"
              class="col-6 q-py-md showLabelOnTop"
              stack-label
              borderless
              dense
              label-slot
              :type="'number'"
              data-test="dashboard-config-map-symbol-max"
              :min="0"
              hide-bottom-space
            >
            </q-input>
          </div>

          <q-input
            v-if="
              dashboardPanelData.data.config.map_symbol_style.size === 'fixed'
            "
            v-model.number="
              dashboardPanelData.data.config.map_symbol_style.size_fixed
            "
            :value="2"
            @blur="
              handleBlur(
                dashboardPanelData.data.config.map_symbol_style,
                2,
                'size_fixed',
              )
            "
            :label="t('dashboard.fixedValue')"
            color="input-border"
            bg-color="input-bg"
            class="col-6 q-py-md showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            data-test="dashboard-config-map-symbol-fixed"
            hide-bottom-space
          >
          </q-input>

          <q-select
            borderless
            v-model="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.layer_type
            "
            :options="layerTypeOptions"
            dense
            :label="t('dashboard.layerType')"
            class="showLabelOnTop"
            stack-label
            emit-value
            :display-value="`${
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.layer_type
            }`"
            data-test="dashboard-config-layer-type"
            hide-bottom-space
          >
          </q-select>

          <q-input
            v-if="!isWeightFieldPresent"
            v-model.number="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.weight_fixed
            "
            :value="1"
            @blur="
              handleBlur(
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config,
                1,
                'weight_fixed',
              )
            "
            :label="t('common.weight')"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            label-slot
            :type="'number'"
            data-test="dashboard-config-weight"
            hide-bottom-space
          >
          </q-input>
        </div>
      </div>
    </q-expansion-item>

    <!-- Section: Gauge -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type === 'gauge'"
      v-show="sectionVisible(gaugeKeywords)"
      :model-value="isExpanded('gauge', gaugeKeywords)"
      @update:model-value="(v) => { expandedSections.gauge = v; }"
      label="Gauge"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-input
          v-show="itemVisible(['gauge min', 'min', 'minimum'])"
          v-model.number="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.min
          "
          :value="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.min = value ? value : 0)
          "
          :label="t('dashboard.gaugeMinValue')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          data-test="dashboard-config-gauge-min"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.gaugeMinValue") }}
            </div>
          </template>
        </q-input>
        <q-input
          v-show="itemVisible(['gauge max', 'max', 'maximum'])"
          v-model.number="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.max
          "
          :value="100"
          @update:model-value="
            (value: any) =>
              (dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.max = value ? value : 100)
          "
          :label="t('dashboard.gaugeMaxValue')"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          placeholder="100"
          :type="'number'"
          data-test="dashboard-config-gauge-max"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.gaugeMaxValue") }}
            </div>
          </template>
        </q-input>
      </div>
    </q-expansion-item>

    <!-- Section: Layout -->
    <q-expansion-item
      v-if="showTrellisConfig"
      v-show="sectionVisible(layoutKeywords) && layoutSectionHasVisibleContent"
      :model-value="isExpanded('layout', layoutKeywords)"
      @update:model-value="(v) => { expandedSections.layout = v; }"
      label="Layout"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-select
          v-show="itemVisible(['trellis', 'layout', 'trellis layout'])"
          :label="t('dashboard.trellisLayout')"
          data-test="dashboard-trellis-chart"
          borderless
          v-model="dashboardPanelData.data.config.trellis.layout"
          :options="trellisOptions"
          dense
          class="showLabelOnTop"
          stack-label
          emit-value
          :display-value="`${
            dashboardPanelData.data.config.trellis?.layout ?? 'None'
          }`"
          :disable="isBreakdownFieldEmpty || hasTimeShifts"
          hide-bottom-space
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.trellisLayout") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-top_results-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                  max-width="250px"
                >
                  <b>{{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip")
                  }}</b>
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-select>

        <div
          v-if="dashboardPanelData.data.config.trellis?.layout === 'custom'"
          v-show="itemVisible(['columns', 'num of columns', 'trellis columns'])"
        >
          <q-input
              borderless
              v-model.number="
                dashboardPanelData.data.config.trellis.num_of_columns
              "
              :label="t('dashboard.numOfColumns')"
              class="q-mr-sm showLabelOnTop"
              stack-label
              dense
              :type="'number'"
              placeholder="Auto"
              data-test="trellis-chart-num-of-columns"
              :disable="isBreakdownFieldEmpty || hasTimeShifts"
              :min="1"
              :max="16"
              hide-bottom-space
              @update:model-value="
                (value: any) =>
                  dashboardPanelData.data.config.trellis.num_of_columns > 16
                    ? (dashboardPanelData.data.config.trellis.num_of_columns = 16)
                    : value
              "
            >
              <template v-slot:label>
                <div class="row items-center all-pointer-events">
                  {{ t("dashboard.numOfColumns") }}
                  <div>
                    <q-icon
                      class="q-ml-xs"
                      size="20px"
                      name="info"
                      data-test="dashboard-config-top_results-info"
                    />
                    <q-tooltip
                      class="bg-grey-8"
                      anchor="top middle"
                      self="bottom middle"
                      max-width="250px"
                    >
                      <b>{{
                        hasTimeShifts
                          ? t("dashboard.trellisTimeShiftTooltip")
                          : t("dashboard.trellisTooltip")
                      }}</b>
                    </q-tooltip>
                  </div>
                </div>
              </template>
            </q-input>
        </div>

        <div
          v-if="
            dashboardPanelData.data.config.trellis?.layout &&
            !(isBreakdownFieldEmpty || hasTimeShifts)
          "
          v-show="
            itemVisible(['group', 'group by y axis', 'y axis', 'trellis'])
          "
          class="row items-center"
        >
          <q-toggle
            v-model="dashboardPanelData.data.config.trellis.group_by_y_axis"
            :label="t('dashboard.groupMultiYAxisTrellis')"
            data-test="dashboard-config-trellis-group-by-y-axis"
            class="tw:h-[36px] o2-toggle-button-lg"
            size="lg"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-lg-dark'
                : 'o2-toggle-button-lg-light'
            "
          />
          <div>
            <q-icon
              class="q-ml-xs"
              size="20px"
              name="info"
              data-test="dashboard-config-trellis-group-by-y-axis-info"
            />
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              <div>
                <b>{{ t("dashboard.groupMultiYAxisTrellisTooltipTitle") }}</b>
                <br /><br />
                {{ t("dashboard.groupMultiYAxisTrellisTooltipDescription") }}
                <br /><br />
                <b>{{ t("dashboard.groupMultiYAxisTrellisTooltipEnabled") }}</b>
                <br /><br />
                <b>{{
                  t("dashboard.groupMultiYAxisTrellisTooltipDisabled")
                }}</b>
                <br /><br />
                <i>{{ t("dashboard.groupMultiYAxisTrellisTooltipExample") }}</i>
                <br />
                {{ t("dashboard.groupMultiYAxisTrellisTooltipEnabledResult") }}
                <br />
                {{ t("dashboard.groupMultiYAxisTrellisTooltipDisabledResult") }}
              </div>
            </q-tooltip>
          </div>
        </div>
      </div>
    </q-expansion-item>

    <!-- Section: Colors -->
    <q-expansion-item
      v-if="showColorPalette"
      v-show="sectionVisible(colorsKeywords)"
      :model-value="isExpanded('colors', colorsKeywords)"
      @update:model-value="(v) => { expandedSections.colors = v; }"
      label="Colors"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <ColorPaletteDropDown />
        <ColorBySeries :colorBySeriesData="panelData" />
      </div>
    </q-expansion-item>

    <!-- Section: Drilldown -->
    <q-expansion-item
      v-if="shouldShowDrilldown(dashboardPanelData, dashboardPanelDataPageKey)"
      v-show="sectionVisible(drilldownKeywords)"
      :model-value="isExpanded('drilldown', drilldownKeywords)"
      @update:model-value="(v) => { expandedSections.drilldown = v; }"
      label="Drilldown"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <Drilldown :variablesData="variablesData" />
      </div>
    </q-expansion-item>

    <!-- Section: Comparison -->
    <q-expansion-item
      v-if="
        shouldShowTimeShift(
          dashboardPanelData,
          promqlMode,
          dashboardPanelDataPageKey,
        )
      "
      v-show="sectionVisible(comparisonKeywords)"
      :model-value="isExpanded('comparison', comparisonKeywords)"
      @update:model-value="(v) => { expandedSections.comparison = v; }"
      label="Comparison"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <div class="flex items-center q-mr-sm">
          <div
            data-test="scheduled-dashboard-period-title"
            class="tw:font-bold tw:flex tw:items-center"
            style="width: 190px"
          >
            {{ t("dashboard.comparisonAgainst") }}
            <q-btn
              no-caps
              padding="xs"
              size="sm"
              flat
              icon="info_outline"
              data-test="dashboard-addpanel-config-time-shift-info"
            >
              <q-tooltip
                anchor="bottom middle"
                self="top middle"
                style="font-size: 10px"
                max-width="250px"
              >
                <span>
                  {{ t("dashboard.comparisonAgainstTooltip") }}
                </span>
              </q-tooltip>
            </q-btn>
          </div>
        </div>
        <CustomDateTimePicker
          modelValue="0m"
          :isFirstEntry="true"
          :disable="true"
        />
        <div
          v-for="(picker, index) in dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].config.time_shift"
          :key="index"
        >
          <div class="flex items-center">
            <CustomDateTimePicker
              v-model="picker.offSet"
              :picker="picker"
              :isFirstEntry="false"
            />
            <q-icon
              class="q-mr-xs q-ml-sm"
              size="15px"
              name="close"
              style="cursor: pointer"
              @click="removeTimeShift(index)"
              :data-test="`dashboard-addpanel-config-time-shift-remove-${index}`"
            />
          </div>
        </div>
        <q-btn
          @click="addTimeShift"
          style="cursor: pointer; padding: 0px 5px"
          :label="t('dashboard.addButton')"
          class="el-border"
          no-caps
          data-test="dashboard-addpanel-config-time-shift-add-btn"
        />
      </div>
    </q-expansion-item>

    <!-- Section: Mark Lines -->
    <q-expansion-item
      v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
      v-show="sectionVisible(markLinesKeywords)"
      :model-value="isExpanded('markLines', markLinesKeywords)"
      @update:model-value="(v) => { expandedSections.markLines = v; }"
      label="Mark Lines"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <MarkLineConfig />
      </div>
    </q-expansion-item>

    <!-- Section: Background -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type == 'metric'"
      v-show="sectionVisible(backgroundKeywords)"
      :model-value="isExpanded('background', backgroundKeywords)"
      @update:model-value="(v) => { expandedSections.background = v; }"
      label="Background"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <BackGroundColorConfig />
      </div>
    </q-expansion-item>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { computed, defineComponent, inject, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import Drilldown from "./Drilldown.vue";
import ValueMapping from "./ValueMapping.vue";
import ColorBySeries from "./ColorBySeries.vue";
import MarkLineConfig from "./MarkLineConfig.vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import ColorPaletteDropDown from "./ColorPaletteDropDown.vue";
import BackGroundColorConfig from "./BackGroundColorConfig.vue";
import OverrideConfig from "./OverrideConfig.vue";
import LinearIcon from "@/components/icons/dashboards/LinearIcon.vue";
import NoSymbol from "@/components/icons/dashboards/NoSymbol.vue";
import Smooth from "@/components/icons/dashboards/Smooth.vue";
import StepBefore from "@/components/icons/dashboards/StepBefore.vue";
import StepAfter from "@/components/icons/dashboards/StepAfter.vue";
import StepMiddle from "@/components/icons/dashboards/StepMiddle.vue";
import PromQLChartConfig from "./PromQLChartConfig.vue";
import { useStore } from "vuex";

import { markRaw, watchEffect, watch } from "vue";
import {
  convertPanelTimeRangeToPicker,
  buildPanelTimeRange,
} from "@/utils/dashboard/panelTimeUtils";
import {
  shouldShowLegendsToggle,
  shouldShowLegendPosition,
  shouldShowLegendType,
  shouldShowLegendWidth,
  shouldShowLegendHeight,
  shouldShowLegendWidthUnitContainer,
  shouldShowLegendHeightUnitContainer,
  shouldApplyChartAlign,
  shouldShowGridlines,
  shouldShowTopResultsConfig,
  shouldShowAreaLineStyleConfig,
  shouldShowNoValueReplacement,
  shouldShowAxisConfig,
  shouldShowCartesianAxisConfig,
  shouldShowAxisLabelConfig,
  shouldShowLineThickness,
  shouldShowDrilldown,
  shouldShowTimeShift,
} from "@/utils/dashboard/configUtils";

export default defineComponent({
  components: {
    Drilldown,
    ValueMapping,
    ColorBySeries,
    CommonAutoComplete,
    MarkLineConfig,
    CustomDateTimePicker,
    DateTimePickerDashboard,
    ColorPaletteDropDown,
    BackGroundColorConfig,
    OverrideConfig,
    LinearIcon,
    NoSymbol,
    Smooth,
    StepBefore,
    StepAfter,
    StepMiddle,
    PromQLChartConfig,
  },
  props: ["dashboardPanelData", "variablesData", "panelData"],
  setup(props) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData, promqlMode, isPivotMode } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    const { t } = useI18n();
    const store = useStore();

    const basemapTypeOptions = [
      {
        label: t("dashboard.openStreetMap"),
        value: "osm",
      },
    ];

    const mapTypeOptions = [
      {
        label: t("dashboard.world"),
        value: "world",
      },
    ];
    onBeforeMount(() => {
      // Ensure that the nested structure is initialized
      if (!dashboardPanelData.data.config.legend_width) {
        dashboardPanelData.data.config.legend_width = {
          value: null,
          unit: "px",
        };
      }

      // Initialize legend height configuration
      if (!dashboardPanelData.data.config.legend_height) {
        dashboardPanelData.data.config.legend_height = {
          value: null,
          unit: "px",
        };
      }

      if (!dashboardPanelData.data.config.trellis) {
        dashboardPanelData.data.config.trellis = {
          layout: null,
          num_of_columns: 1,
          group_by_y_axis: false,
        };
      }

      if (!dashboardPanelData.data.config.axis_border_show) {
        dashboardPanelData.data.config.axis_border_show = false;
      }

      // by default, use top_results_others as false
      if (!dashboardPanelData.data.config.top_results_others) {
        dashboardPanelData.data.config.top_results_others = false;
      }

      // Ensure that the nested structure is initialized
      if (!dashboardPanelData.data.config.map_symbol_style) {
        dashboardPanelData.data.config.map_symbol_style = {
          size: "by Value",
          size_by_value: {
            min: 1,
            max: 100,
          },
          size_fixed: 2,
        };
      }

      // by default, use connect_nulls as false
      if (!dashboardPanelData.data.config.connect_nulls) {
        dashboardPanelData.data.config.connect_nulls = false;
      }

      // by default, use no_value_replacement as empty string
      if (!dashboardPanelData.data.config.no_value_replacement) {
        dashboardPanelData.data.config.no_value_replacement = "";
      }

      // by default, use wrap_table_cells as false
      if (!dashboardPanelData.data.config.wrap_table_cells) {
        dashboardPanelData.data.config.wrap_table_cells = false;
      }

      // by default, use table_transpose as false
      if (!dashboardPanelData.data.config.table_transpose) {
        dashboardPanelData.data.config.table_transpose = false;
      }

      // by default, use table_dynamic_columns  as false
      if (!dashboardPanelData.data.config.table_dynamic_columns) {
        dashboardPanelData.data.config.table_dynamic_columns = false;
      }

      // by default, use label_option position as null and rotate as 0
      if (!dashboardPanelData.data.config.label_option) {
        dashboardPanelData.data.config.label_option = {
          position: null,
          rotate: 0,
        };
      }

      // by default, use chart_align as null (auto)
      if (dashboardPanelData.data.config.chart_align === undefined) {
        dashboardPanelData.data.config.chart_align = null;
      }

      // by default, set show_symbol as false
      if (dashboardPanelData.data.config.show_symbol === undefined) {
        const isNewPanel = !dashboardPanelData.data.id;
        // if new panel, use config env
        // else always false
        dashboardPanelData.data.config.show_symbol = isNewPanel
          ? (store?.state?.zoConfig?.dashboard_show_symbol_enabled ?? false)
          : false;
      }

      // by default, set line interpolation as smooth
      if (!dashboardPanelData.data.config.line_interpolation) {
        dashboardPanelData.data.config.line_interpolation = "smooth";
      }

      // Initialize map_type configuration
      if (!dashboardPanelData.data.config.map_type) {
        dashboardPanelData.data.config.map_type = { type: "world" };
      }

      // If no step value is set, set it to 0
      if (!dashboardPanelData.data.config.step_value) {
        dashboardPanelData.data.config.step_value = "0";
      }

      if (!dashboardPanelData?.data?.config?.trellis?.group_by_y_axis) {
        dashboardPanelData.data.config.trellis.group_by_y_axis = false;
      }

      if (
        dashboardPanelData.data.config.show_gridlines === null ||
        dashboardPanelData.data.config.show_gridlines === undefined
      ) {
        dashboardPanelData.data.config.show_gridlines = true;
      }
    });

    const legendWidthValue = computed({
      get() {
        return dashboardPanelData.data.config?.legend_width?.value;
      },
      set(value) {
        // Ensure that the nested structure is initialized
        if (!dashboardPanelData.data.config.legend_width) {
          dashboardPanelData.data.config.legend_width = {
            value: null,
            unit: "px",
          };
        }

        // Set the value
        dashboardPanelData.data.config.legend_width.value =
          value !== "" ? value : null;
      },
    });

    const setUnit = (unit: any) => {
      // Ensure that the nested structure is initialized
      if (!dashboardPanelData.data.config.legend_width) {
        dashboardPanelData.data.config.legend_width = {
          value: null,
          unit: null,
        };
      }

      // Set the unit
      dashboardPanelData.data.config.legend_width.unit = unit;
    };

    const legendHeightValue = computed({
      get() {
        return dashboardPanelData.data.config?.legend_height?.value;
      },
      set(value) {
        // Ensure that the nested structure is initialized
        if (!dashboardPanelData.data.config.legend_height) {
          dashboardPanelData.data.config.legend_height = {
            value: null,
            unit: "px",
          };
        }

        // Set the value
        dashboardPanelData.data.config.legend_height.value =
          value !== "" ? value : null;
      },
    });

    const setHeightUnit = (unit: any) => {
      // Ensure that the nested structure is initialized
      if (!dashboardPanelData.data.config.legend_height) {
        dashboardPanelData.data.config.legend_height = {
          value: null,
          unit: null,
        };
      }

      // Set the unit
      dashboardPanelData.data.config.legend_height.unit = unit;
    };

    const layerTypeOptions = [
      {
        label: t("dashboard.scatter"),
        value: "scatter",
      },
      {
        label: t("dashboard.heatmap"),
        value: "heatmap",
      },
    ];

    //options for symbol
    const symbolOptions = [
      {
        label: t("dashboard.fixed"),
        value: "fixed",
      },
      {
        label: t("dashboard.byValue"),
        value: "by Value",
      },
    ];

    const trellisOptions = [
      {
        label: t("common.none"),
        value: null,
      },
      {
        label: t("common.auto"),
        value: "auto",
      },
      {
        label: t("common.vertical"),
        value: "vertical",
      },
      {
        label: t("common.custom"),
        value: "custom",
      },
    ];

    // options for legends position
    const legendsPositionOptions = [
      {
        label: t("dashboard.auto"),
        value: null,
      },
      {
        label: t("dashboard.right"),
        value: "right",
      },
      {
        label: t("dashboard.bottom"),
        value: "bottom",
      },
    ];

    const legendTypeOptions = [
      {
        label: t("dashboard.legendTypeAuto"),
        value: null,
      },
      {
        label: t("dashboard.legendTypePlain"),
        value: "plain",
      },
      {
        label: t("dashboard.legendTypeScroll"),
        value: "scroll",
      },
    ];

    const chartAlignOptions = [
      {
        label: t("dashboard.chartAlignAuto"),
        value: null,
      },
      {
        label: t("dashboard.chartAlignLeft"),
        value: "left",
      },
      {
        label: t("dashboard.chartAlignCenter"),
        value: "center",
      },
    ];
    const unitOptions = [
      {
        label: t("dashboard.default"),
        value: null,
      },
      {
        label: t("dashboard.numbers"),
        value: "numbers",
      },
      {
        label: t("dashboard.bytes"),
        value: "bytes",
      },
      {
        label: t("dashboard.kilobytes"),
        value: "kilobytes",
      },
      {
        label: t("dashboard.megabytes"),
        value: "megabytes",
      },
      {
        label: t("dashboard.bytesPerSecond"),
        value: "bps",
      },
      {
        label: t("dashboard.seconds"),
        value: "seconds",
      },
      {
        label: t("dashboard.milliseconds"),
        value: "milliseconds",
      },
      {
        label: t("dashboard.microseconds"),
        value: "microseconds",
      },
      {
        label: t("dashboard.nanoseconds"),
        value: "nanoseconds",
      },
      {
        label: t("dashboard.percent1"),
        value: "percent-1",
      },
      {
        label: t("dashboard.percent"),
        value: "percent",
      },
      {
        label: t("dashboard.currencyDollar"),
        value: "currency-dollar",
      },
      {
        label: t("dashboard.currencyEuro"),
        value: "currency-euro",
      },
      {
        label: t("dashboard.currencyPound"),
        value: "currency-pound",
      },
      {
        label: t("dashboard.currencyYen"),
        value: "currency-yen",
      },
      {
        label: t("dashboard.currencyRupees"),
        value: "currency-rupee",
      },

      {
        label: t("dashboard.custom"),
        value: "custom",
      },
    ];

    const labelPositionOptions = [
      {
        label: t("dashboard.none"),
        value: null,
      },
      {
        label: t("dashboard.top"),
        value: "top",
      },
      {
        label: t("dashboard.left"),
        value: "left",
      },
      {
        label: t("dashboard.right"),
        value: "right",
      },
      {
        label: t("dashboard.bottom"),
        value: "bottom",
      },
      {
        label: t("dashboard.inside"),
        value: "inside",
      },
      {
        label: t("dashboard.insideLeft"),
        value: "insideLeft",
      },
      {
        label: t("dashboard.insideRight"),
        value: "insideRight",
      },
      {
        label: t("dashboard.insideTop"),
        value: "insideTop",
      },
      {
        label: t("dashboard.insideBottom"),
        value: "insideBottom",
      },
      {
        label: t("dashboard.insideTopLeft"),
        value: "insideTopLeft",
      },
      {
        label: t("dashboard.insideBottomLeft"),
        value: "insideBottomLeft",
      },
      {
        label: t("dashboard.insideTopRight"),
        value: "insideTopRight",
      },
      {
        label: t("dashboard.insideBottomRight"),
        value: "insideBottomRight",
      },
      {
        label: t("dashboard.outside"),
        value: "outside",
      },
    ];

    const showSymbol = [
      {
        label: t("dashboard.no"),
        value: false,
        iconComponent: markRaw(NoSymbol),
      },
      {
        label: t("dashboard.yes"),
        value: true,
        iconComponent: markRaw(LinearIcon),
      },
    ];

    const lineInterpolationOptions = [
      {
        label: t("dashboard.smooth"),
        value: "smooth",
        iconComponent: markRaw(Smooth),
      },
      {
        label: t("dashboard.linear"),
        value: "linear",
        iconComponent: markRaw(LinearIcon),
      },
      {
        label: t("dashboard.stepBefore"),
        value: "step-start",
        iconComponent: markRaw(StepBefore),
      },
      {
        label: t("dashboard.stepAfter"),
        value: "step-end",
        iconComponent: markRaw(StepAfter),
      },
      {
        label: t("dashboard.stepMiddle"),
        value: "step-middle",
        iconComponent: markRaw(StepMiddle),
      },
    ];

    const isWeightFieldPresent = computed(() => {
      const layoutFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields;
      return !!layoutFields?.weight;
    });

    const handleBlur = (field: any, key: any, value: any) => {
      if (!field[value]) {
        field[value] = key;
      }
    };

    const selectPromQlNameOption = (option: any) => {
      const inputValue =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.promql_legend;

      // Find the index of the last opening brace '{'
      const openingBraceIndex = inputValue.lastIndexOf("{");

      //if { is not present add it at the start and than return

      if (openingBraceIndex === -1) {
        const newValue =
          "{" + inputValue.slice(0, openingBraceIndex + 1) + option + "}";
        return newValue;
      } else {
        const newValue =
          inputValue.slice(0, openingBraceIndex + 1) + option + "}";
        return newValue;
      }
    };

    const dashboardSelectfieldPromQlList = computed(() => {
      // Get fields from groupedFields based on current query's stream
      const currentQuery =
        props.dashboardPanelData.data.queries[
          props.dashboardPanelData.layout.currentQueryIndex
        ];
      const currentStream = currentQuery?.fields?.stream;

      if (!currentStream) return [];

      // Find the current stream in groupedFields
      const streamFields =
        props.dashboardPanelData.meta.streamFields.groupedFields.find(
          (group: any) => group.name === currentStream,
        );

      if (!streamFields?.schema) return [];

      return streamFields.schema.map((it: any) => {
        return {
          label: it.name,
          value: it.name,
        };
      });
    });

    const timeShifts = [];

    const addTimeShift = () => {
      if (dashboardPanelData.data.config.trellis.layout)
        dashboardPanelData.data.config.trellis.layout = null;

      const newTimeShift = {
        offSet: "15m",
        data: {
          selectedDate: {
            relative: {
              value: 15,
              period: "m",
              label: "Minutes",
            },
          },
        },
      };

      timeShifts.push(newTimeShift);
      if (
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
      }
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].config.time_shift.push({
        offSet: newTimeShift.offSet,
      });
    };

    const removeTimeShift = (index: any) => {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].config.time_shift.splice(index, 1);
    };

    const showColorPalette = computed(() => {
      return [
        "area",
        "area-stacked",
        "bar",
        "h-bar",
        "line",
        "scatter",
        "stacked",
        "h-stacked",
        "pie",
        "donut",
        "gauge",
      ].includes(dashboardPanelData.data.type);
    });

    const showTrellisConfig = computed(() => {
      const supportedTypes = ["area", "bar", "h-bar", "line", "scatter"];
      return supportedTypes.includes(dashboardPanelData.data.type);
    });

    const isBreakdownFieldEmpty = computed(() => {
      return (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.breakdown?.length == 0
      );
    });

    const hasTimeShifts = computed(() => {
      return (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift?.length > 0
      );
    });

    // Panel default time configuration (v4.0)
    const useDefaultTime = ref(
      !!dashboardPanelData.data.config?.panel_time_enabled,
    );

    // Current panel time range (null = not set)
    const panelTimeRange = ref(
      dashboardPanelData.data.config?.panel_time_range ?? null,
    );

    // Picker value - initialize from existing config or default
    const existingRange = dashboardPanelData.data.config?.panel_time_range;
    const pickerValue = ref(
      existingRange
        ? (convertPanelTimeRangeToPicker(existingRange) ?? {
            type: "relative",
            valueType: "relative",
            relativeTimePeriod: "15m",
          })
        : {
            type: "relative",
            valueType: "relative",
            relativeTimePeriod: "15m",
          },
    );

    // Whether the picker is open (after clicking "+Set")
    const showTimePicker = ref(false);

    // Ref to the DateTimePickerDashboard component
    const panelTimePickerRef = ref(null);

    // Format picker value for tooltip display using the DateTime component's display value
    const formattedPickerValue = computed(() => {
      if (!panelTimePickerRef.value?.dateTimePicker?.getDisplayValue) {
        return "";
      }
      return panelTimePickerRef.value.dateTimePicker.getDisplayValue;
    });

    // Toggle on/off
    const onToggleDefaultTime = (enabled: boolean) => {
      dashboardPanelData.data.config.panel_time_enabled = enabled;

      if (!enabled) {
        // Clear everything when turning off
        dashboardPanelData.data.config.panel_time_range = null;
        panelTimeRange.value = null;
        showTimePicker.value = false;
      }
    };

    // Auto-save: watch picker value changes and sync to config
    watch(
      pickerValue,
      (newValue) => {
        if (
          newValue &&
          useDefaultTime.value &&
          (showTimePicker.value || panelTimeRange.value !== null)
        ) {
          const timeRange = buildPanelTimeRange(newValue as any);
          dashboardPanelData.data.config.panel_time_range = timeRange;
          panelTimeRange.value = timeRange;
        }
      },
      { deep: true },
    );

    // When pivot mode activates: disable conflicting features and
    // initialize pivot config values (undefined → false/0 defaults).
    // Without this, q-toggle shows undefined as OFF but conversion
    // may treat undefined differently — causing a mismatch.
    watch(
      () => isPivotMode.value,
      (active) => {
        if (active) {
          dashboardPanelData.data.config.table_transpose = false;
          dashboardPanelData.data.config.table_dynamic_columns = false;
          if (
            dashboardPanelData.data.config.table_pivot_show_row_totals ===
            undefined
          ) {
            dashboardPanelData.data.config.table_pivot_show_row_totals = false;
          }
          if (
            dashboardPanelData.data.config.table_pivot_show_col_totals ===
            undefined
          ) {
            dashboardPanelData.data.config.table_pivot_show_col_totals = false;
          }
          if (
            dashboardPanelData.data.config.table_pivot_sticky_row_totals ===
            undefined
          ) {
            dashboardPanelData.data.config.table_pivot_sticky_row_totals = false;
          }
          if (
            dashboardPanelData.data.config.table_pivot_sticky_col_totals ===
            undefined
          ) {
            dashboardPanelData.data.config.table_pivot_sticky_col_totals = false;
          }
        }
      },
      { immediate: true },
    );

    // Cancel (remove set time via X icon) → back to "+Set" button
    const onCancelPanelTime = () => {
      dashboardPanelData.data.config.panel_time_range = null;
      panelTimeRange.value = null;
      showTimePicker.value = false;
      // Reset pickerValue to default so next "+Set" shows fresh default
      pickerValue.value = {
        type: "relative",
        valueType: "relative",
        relativeTimePeriod: "15m",
      };
    };
    // ΓöÇΓöÇ Section keyword arrays ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const generalKeywords = [
      "description",
      "step",
      "time",
      "panel time",
      "duration",
      "general",
      "promql",
      "panel default time",
      "use default time",
      "set panel time",
      "step value",
      "promql step",
      "default duration",
    ];

    const legendKeywords = [
      "legend",
      "show legend",
      "position",
      "legend type",
      "legend width",
      "legend height",
      "chart align",
      "chart alignment",
      "scroll",
      "plain",
      "promql legend",
      "align",
      "legend override",
      "legend width unit",
      "legend height unit",
    ];

    const dataKeywords = [
      "unit",
      "decimals",
      "limit",
      "top results",
      "top n",
      "others",
      "connect null",
      "no value",
      "data",
      "query limit",
      "show top n values",
      "others series",
      "connect null values",
      "no value replacement",
      "custom unit",
    ];

    const axisKeywords = [
      "axis",
      "border",
      "y axis",
      "y min",
      "y max",
      "gridlines",
      "grid",
      "axis width",
      "y-axis min",
      "y-axis max",
      "x axis",
      "show border",
      "show gridlines",
      "axis border",
    ];

    const labelsKeywords = [
      "label",
      "label position",
      "rotate",
      "truncate",
      "label rotate",
      "axis label",
      "overflow",
      "font size",
      "label font",
      "label truncate",
      "axis label rotate",
      "axis label truncate",
    ];

    const lineStyleKeywords = [
      "line",
      "symbol",
      "interpolation",
      "thickness",
      "smooth",
      "step",
      "linear",
      "line style",
      "line thickness",
      "fill area",
      "line interpolation",
      "show symbol",
      "step before",
      "step after",
    ];

    const tableKeywords = [
      "table",
      "wrap",
      "transpose",
      "dynamic",
      "columns",
      "pagination",
      "rows per page",
      "value mapping",
      "override",
      "column width",
      "wrap text",
      "row background",
      "sticky header",
      "column border",
      "wrap table",
      "table transpose",
      "table dynamic",
    ];

    const mapKeywords = [
      "map",
      "basemap",
      "latitude",
      "longitude",
      "zoom",
      "symbol",
      "layer",
      "weight",
      "geomap",
      "map type",
      "initial view",
      "map symbol",
      "layer type",
      "fixed value",
      "minimum",
      "maximum",
    ];

    const gaugeKeywords = [
      "gauge",
      "min",
      "max",
      "minimum",
      "maximum",
      "gauge min",
      "gauge max",
      "gauge pointer",
      "arc width",
    ];

    const layoutKeywords = [
      "layout",
      "trellis",
      "columns",
      "group",
      "small multiples",
      "trellis columns",
      "layout rows",
      "trellis layout",
      "num of columns",
      "group by y axis",
    ];

    const colorsKeywords = [
      "color",
      "palette",
      "color by series",
      "theme",
      "colors",
      "color palette",
      "color scheme",
      "custom color",
    ];

    const drilldownKeywords = [
      "drilldown",
      "drill",
      "link",
      "navigate",
      "drilldown url",
      "target",
      "open in",
    ];

    const comparisonKeywords = [
      "comparison",
      "time shift",
      "compare",
      "offset",
      "period",
      "comparison against",
    ];

    const markLinesKeywords = [
      "mark line",
      "mark",
      "threshold",
      "reference",
      "mark lines",
      "baseline",
    ];

    const backgroundKeywords = [
      "background",
      "background color",
      "metric",
      "bg color",
      "panel background",
    ];

    // ΓöÇΓöÇ Search and section expansion state ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const searchQuery = ref("");
    const expandedSections = ref<Record<string, boolean>>({
      general: true,
      legend: true,
      data: true,
      axis: true,
      labels: true,
      lineStyle: true,
      table: true,
      map: true,
      gauge: true,
      layout: true,
      colors: true,
      drilldown: true,
      comparison: true,
      markLines: true,
      background: true,
    });

    // Word-boundary match: query must start at a word boundary within the keyword
    const matchesSearch = (keyword: string, query: string): boolean => {
      const k = keyword.toLowerCase();
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}`).test(k);
    };

    const sectionVisible = (keywords: string[]) => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q) return true;
      return keywords.some((k) => matchesSearch(k, q));
    };

    // Item-level filter: same logic but applied to individual config rows
    const itemVisible = (keywords: string[]) => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q) return true;
      return keywords.some((k) => matchesSearch(k, q));
    };

    const isExpanded = (key: string, _keywords: string[]) => {
      return expandedSections.value[key] ?? true;
    };

    // Save/restore expansion state around search sessions
    const beforeSearchExpandedSections = ref<Record<string, boolean> | null>(
      null,
    );
    watch(searchQuery, (newQ, oldQ) => {
      if (newQ && !oldQ) {
        // Search just started — save state and expand all sections
        beforeSearchExpandedSections.value = { ...expandedSections.value };
        Object.keys(expandedSections.value).forEach((key) => {
          expandedSections.value[key] = true;
        });
      } else if (!newQ && oldQ) {
        // Search cleared — restore previous state
        if (beforeSearchExpandedSections.value) {
          expandedSections.value = { ...beforeSearchExpandedSections.value };
          beforeSearchExpandedSections.value = null;
        }
      }
    });

    // ΓöÇΓöÇ hasContent guards — query-aware: when searching, also verify that the
    // items matching the query are actually renderable (their v-if is true).
    const legendSectionHasContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q)
        return (
          shouldShowLegendsToggle(dashboardPanelData) ||
          shouldShowLegendPosition(dashboardPanelData) ||
          shouldShowLegendType(dashboardPanelData) ||
          shouldShowLegendWidth(dashboardPanelData) ||
          shouldShowLegendHeight(dashboardPanelData) ||
          shouldApplyChartAlign(dashboardPanelData) ||
          (promqlMode.value &&
            dashboardPanelData.data.type !== "geomap" &&
            dashboardPanelData.data.type !== "maps")
        );
      if (
        ["legend", "show legend", "legends"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowLegendsToggle(dashboardPanelData)
      ) return true;
      if (
        ["legend position", "position", "legend"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowLegendPosition(dashboardPanelData)
      ) return true;
      if (
        ["legend type", "type", "scroll", "plain", "legend"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowLegendType(dashboardPanelData)
      ) return true;
      if (
        ["legend width", "legend height", "width", "height", "legend"].some(
          (k) => matchesSearch(k, q),
        ) &&
        (shouldShowLegendWidth(dashboardPanelData) ||
          shouldShowLegendHeight(dashboardPanelData))
      ) return true;
      if (
        ["align", "chart align", "chart alignment"].some((k) =>
          matchesSearch(k, q),
        ) && shouldApplyChartAlign(dashboardPanelData)
      ) return true;
      if (
        ["promql legend", "legend", "query", "legend label"].some((k) =>
          matchesSearch(k, q),
        ) &&
        promqlMode.value &&
        dashboardPanelData.data.type !== "geomap" &&
        dashboardPanelData.data.type !== "maps"
      ) return true;
      return false;
    });

    const axisSectionHasContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q)
        return (
          shouldShowAxisConfig(dashboardPanelData) ||
          shouldShowCartesianAxisConfig(dashboardPanelData) ||
          shouldShowGridlines(dashboardPanelData)
        );
      if (
        ["axis width"].some((k) => matchesSearch(k, q)) &&
        shouldShowAxisConfig(dashboardPanelData)
      ) return true;
      if (
        ["border", "axis border", "show border"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowAxisConfig(dashboardPanelData)
      ) return true;
      if (
        ["y axis", "y min", "y max", "y-axis min", "y-axis max", "y axis min", "y axis max"].some(
          (k) => matchesSearch(k, q),
        ) && shouldShowCartesianAxisConfig(dashboardPanelData)
      ) return true;
      if (
        ["gridlines", "grid", "show gridlines"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowGridlines(dashboardPanelData)
      ) return true;
      return false;
    });

    const labelsSectionHasContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q)
        return (
          shouldShowCartesianAxisConfig(dashboardPanelData) ||
          shouldShowAxisLabelConfig(dashboardPanelData)
        );
      if (
        ["label position", "position", "label"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowCartesianAxisConfig(dashboardPanelData)
      ) return true;
      if (
        ["label rotate", "rotate", "label"].some((k) =>
          matchesSearch(k, q),
        ) && shouldShowCartesianAxisConfig(dashboardPanelData)
      ) return true;
      if (
        ["axis label", "axis label rotate", "axis label truncate", "rotate", "truncate"].some(
          (k) => matchesSearch(k, q),
        ) && shouldShowAxisLabelConfig(dashboardPanelData)
      ) return true;
      return false;
    });

    const lineStyleSectionHasContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q)
        return (
          shouldShowAreaLineStyleConfig(dashboardPanelData) ||
          shouldShowLineThickness(dashboardPanelData, promqlMode.value)
        );
      if (
        ["symbol", "show symbol"].some((k) => matchesSearch(k, q)) &&
        shouldShowAreaLineStyleConfig(dashboardPanelData)
      ) return true;
      if (
        ["interpolation", "line interpolation", "smooth", "step", "linear", "step before", "step after"].some(
          (k) => matchesSearch(k, q),
        ) && shouldShowAreaLineStyleConfig(dashboardPanelData)
      ) return true;
      if (
        ["line thickness", "thickness"].some((k) => matchesSearch(k, q)) &&
        shouldShowLineThickness(dashboardPanelData, promqlMode.value)
      ) return true;
      return false;
    });

    const dataSectionHasVisibleContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q) return true;
      // unit + decimals have no v-if — always renderable
      if (["unit", "decimals"].some((k) => matchesSearch(k, q))) return true;
      // custom unit — only renderable when unit is 'custom'
      if (
        matchesSearch("custom unit", q) &&
        dashboardPanelData.data.config.unit === "custom"
      )
        return true;
      // limit — gated by !promqlMode && !customQuery
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];
      if (
        ["limit", "query limit"].some((k) => matchesSearch(k, q)) &&
        !promqlMode.value &&
        !currentQuery?.customQuery
      )
        return true;
      // top results + others — gated by shouldShowTopResultsConfig
      if (
        [
          "top results",
          "top n",
          "others",
          "show top n values",
          "others series",
          "top n values",
        ].some((k) => matchesSearch(k, q)) &&
        shouldShowTopResultsConfig(dashboardPanelData, promqlMode.value)
      )
        return true;
      // connect null — gated by shouldShowAreaLineStyleConfig
      if (
        ["connect null", "connect null values"].some((k) =>
          matchesSearch(k, q),
        ) &&
        shouldShowAreaLineStyleConfig(dashboardPanelData)
      )
        return true;
      // no value replacement — gated by shouldShowNoValueReplacement
      if (
        ["no value", "no value replacement"].some((k) => matchesSearch(k, q)) &&
        shouldShowNoValueReplacement(dashboardPanelData, promqlMode.value)
      )
        return true;
      return false;
    });

    const layoutSectionHasVisibleContent = computed(() => {
      const q = (searchQuery.value ?? "").trim().toLowerCase();
      if (!q) return true;
      // Trellis select — always renderable when section is visible
      if (
        ["trellis", "layout", "trellis layout"].some((k) =>
          matchesSearch(k, q),
        )
      )
        return true;
      // Columns input — only renders when trellis layout is 'custom'
      if (
        ["columns", "num of columns", "trellis columns"].some((k) =>
          matchesSearch(k, q),
        ) && dashboardPanelData.data.config.trellis?.layout === "custom"
      )
        return true;
      // Group toggle — only renders when trellis layout is set
      if (
        ["group", "group by y axis", "trellis"].some((k) =>
          matchesSearch(k, q),
        ) &&
        !!dashboardPanelData.data.config.trellis?.layout &&
        !(isBreakdownFieldEmpty.value || hasTimeShifts.value)
      )
        return true;
      return false;
    });

    // ΓöÇΓöÇ Global expand / collapse toggle ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const allSectionsExpanded = computed(() =>
      Object.values(expandedSections.value).some((v) => v === true),
    );

    const toggleAllSections = () => {
      const expand = !allSectionsExpanded.value;
      Object.keys(expandedSections.value).forEach((key) => {
        expandedSections.value[key] = expand;
      });
    };

    // ΓöÇΓöÇ anySectionVisible ΓÇô drives the "No results" empty state ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const anySectionVisible = computed(() => {
      return (
        sectionVisible(generalKeywords) ||
        (sectionVisible(legendKeywords) && legendSectionHasContent.value) ||
        (sectionVisible(dataKeywords) && dataSectionHasVisibleContent.value) ||
        (sectionVisible(axisKeywords) && axisSectionHasContent.value) ||
        (sectionVisible(labelsKeywords) && labelsSectionHasContent.value) ||
        (sectionVisible(lineStyleKeywords) &&
          lineStyleSectionHasContent.value) ||
        (dashboardPanelData.data.type === "table" &&
          sectionVisible(tableKeywords)) ||
        ((dashboardPanelData.data.type === "geomap" ||
          dashboardPanelData.data.type === "maps") &&
          sectionVisible(mapKeywords)) ||
        (dashboardPanelData.data.type === "gauge" &&
          sectionVisible(gaugeKeywords)) ||
        (showTrellisConfig.value && sectionVisible(layoutKeywords) && layoutSectionHasVisibleContent.value) ||
        (showColorPalette.value && sectionVisible(colorsKeywords)) ||
        (shouldShowDrilldown(dashboardPanelData, dashboardPanelDataPageKey) &&
          sectionVisible(drilldownKeywords)) ||
        (shouldShowTimeShift(
          dashboardPanelData,
          promqlMode.value,
          dashboardPanelDataPageKey,
        ) &&
          sectionVisible(comparisonKeywords)) ||
        (shouldShowCartesianAxisConfig(dashboardPanelData) &&
          sectionVisible(markLinesKeywords)) ||
        (dashboardPanelData.data.type === "metric" &&
          sectionVisible(backgroundKeywords))
      );
    });

    // Clear legend width when switching away from plain type or when position is not right
    watchEffect(() => {
      if (
        dashboardPanelData.data.config.legends_type !== "plain" ||
        dashboardPanelData.data.config.legends_position !== "right"
      ) {
        // Clear the legend width value when conditions no longer allow width customization
        if (dashboardPanelData.data.config.legend_width) {
          dashboardPanelData.data.config.legend_width.value = null;
        }
      }
    });

    // Clear legend height when switching away from plain type or when position is not bottom/auto
    watchEffect(() => {
      if (
        dashboardPanelData.data.config.legends_type !== "plain" ||
        (dashboardPanelData.data.config.legends_position !== null &&
          dashboardPanelData.data.config.legends_position !== "bottom")
      ) {
        // Clear the legend height value when conditions no longer allow height customization
        if (dashboardPanelData.data.config.legend_height) {
          dashboardPanelData.data.config.legend_height.value = null;
        }
      }
    });

    return {
      t,
      dashboardPanelData,
      promqlMode,
      basemapTypeOptions,
      mapTypeOptions,
      layerTypeOptions,
      symbolOptions,
      legendsPositionOptions,
      legendTypeOptions,
      chartAlignOptions,
      unitOptions,
      labelPositionOptions,
      showSymbol,
      lineInterpolationOptions,
      isWeightFieldPresent,
      setUnit,
      setHeightUnit,
      handleBlur,
      legendWidthValue,
      legendHeightValue,
      dashboardSelectfieldPromQlList,
      selectPromQlNameOption,
      addTimeShift,
      removeTimeShift,
      showColorPalette,
      trellisOptions,
      showTrellisConfig,
      isBreakdownFieldEmpty,
      hasTimeShifts,
      dashboardPanelDataPageKey,
      store,
      shouldShowLegendsToggle,
      shouldShowLegendPosition,
      shouldShowLegendType,
      shouldShowLegendWidth,
      shouldShowLegendHeight,
      shouldShowLegendWidthUnitContainer,
      shouldShowLegendHeightUnitContainer,
      shouldApplyChartAlign,
      shouldShowGridlines,
      shouldShowTopResultsConfig,
      shouldShowAreaLineStyleConfig,
      shouldShowNoValueReplacement,
      shouldShowAxisConfig,
      shouldShowCartesianAxisConfig,
      shouldShowAxisLabelConfig,
      shouldShowLineThickness,
      shouldShowDrilldown,
      shouldShowTimeShift,
      // Panel default time configuration (v4.0)
      useDefaultTime,
      panelTimeRange,
      pickerValue,
      showTimePicker,
      panelTimePickerRef,
      formattedPickerValue,
      onToggleDefaultTime,
      onCancelPanelTime,
      searchQuery,
      expandedSections,
      sectionVisible,
      itemVisible,
      isExpanded,
      // keyword arrays
      generalKeywords,
      legendKeywords,
      dataKeywords,
      axisKeywords,
      labelsKeywords,
      lineStyleKeywords,
      tableKeywords,
      mapKeywords,
      gaugeKeywords,
      layoutKeywords,
      colorsKeywords,
      drilldownKeywords,
      comparisonKeywords,
      markLinesKeywords,
      backgroundKeywords,
      // hasContent / empty-state computeds
      legendSectionHasContent,
      axisSectionHasContent,
      labelsSectionHasContent,
      lineStyleSectionHasContent,
      dataSectionHasVisibleContent,
      layoutSectionHasVisibleContent,
      anySectionVisible,
      allSectionsExpanded,
      toggleAllSections,
      isPivotMode,
    };
  },
});
</script>

<style lang="scss" scoped>
:deep(.selectedLabel span) {
  text-transform: none !important;
}

.space {
  margin-top: 10px;
  margin-bottom: 10px;
}

.input-disabled-overlay {
  :deep(input) {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  :deep(.q-field__label) {
    opacity: 1 !important;
    pointer-events: auto !important;
  }
}

// Ensure label icons are always interactive
:deep(.q-field__label) {
  pointer-events: auto !important;

  .q-icon {
    pointer-events: auto !important;
  }
}

.input-container {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
}

.input-container button-group {
  border: 1px solid gray !important;
  border-radius: 9px;
}

.input-container button {
  display: block;
  cursor: pointer;
  background-color: #f0eaea;
  border: none;
  font-size: 13px;
  padding: 2px 8px;
}

.input-container button-left {
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}

.input-container button-right {
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}

.input-container button.active {
  background-color: var(--q-primary) !important;
  font-weight: bold;
  color: white;
}

.unit-container {
  width: auto;
  display: flex;
  height: 36px;
  margin-top: 9px;
  width: 100px;
}

.config-legend-input {
  min-width: 80px;
}

.panel-time-picker-container {
  overflow: hidden;
}

.panel-time-picker-btn {
  overflow: hidden;
  min-width: 0;

  :deep(.date-time-button) {
    min-width: 0 !important;
    max-width: 100%;

    .q-btn__content {
      flex-wrap: nowrap;
      overflow: hidden;

      .block {
        flex: 1 1 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}

.config-search-wrapper {
  padding: 4px 4px;
  top: 0;
  z-index: 10;
  background-color: var(--o2-card-bg-solid);
}

:deep(.q-expansion-item--collapsed),
:deep(.q-expansion-item--expanded) {
  .q-item__section--side {
    padding-right: 8px !important;
    min-width: 32px !important;
  }
}

.config-section-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 8px;
  margin-left: 12px;
}

.config-no-results {
  text-align: center;
}
</style>
