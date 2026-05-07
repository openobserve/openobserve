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
  <div v-if="dashboardPanelData.data.type == 'custom_chart'" class="tw:pb-8">
    <div class="tw:max-w-[300px] tw:mx-3">
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
        <OButton variant="ghost" size="icon" @click="toggleAllSections">
          <template #icon-left
            ><q-icon
              :name="allSectionsExpanded ? 'unfold_less' : 'unfold_more'"
          /></template>
        </OButton>
        <ConfigPanelSearch v-model="searchQuery" />
      </div>
    </div>

    <!-- No results empty state -->
    <div
      v-if="searchQuery && !anySectionVisible"
      class="config-no-results column items-center q-py-lg"
    >
      <q-icon name="search_off" size="24px" class="q-mb-xs text-grey-5" />
      <div class="text-grey-6 text-caption">
        {{ t("dashboard.configPanelNoResultsFound", { query: searchQuery }) }}
      </div>
    </div>

    <!-- Section: General -->
    <q-expansion-item
      v-show="isSectionVisible('general')"
      :model-value="isExpanded('general')"
      @update:model-value="
        (v) => {
          expandedSections.general = v;
        }
      "
      :label="t('dashboard.configSectionGeneral')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <div
          v-show="isConfigOptionVisible('general', 'description')"
          class="tw:max-w-[300px]"
        >
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
          v-show="isConfigOptionVisible('general', 'step')"
          v-model="dashboardPanelData.data.config.step_value"
          type="text"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :placeholder="t('dashboard.intervalInputPlaceholder')"
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
          v-show="isConfigOptionVisible('general', 'panel-default-time')"
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
            <OButton variant="ghost" size="icon" class="tw:mt-1" @click.stop>
              <template #icon-left><q-icon name="info_outline" /></template>
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
            </OButton>
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
              <OButton
                variant="outline"
                size="sm"
                @click="showTimePicker = true"
                data-test="dashboard-config-set-panel-time"
                >{{ t("common.set") }}</OButton
              >
            </div>
          </div>
        </div>

        <PromQLChartConfig
          v-if="
            promqlMode &&
            dashboardPanelData.data.type !== 'table' &&
            dashboardPanelData.data.type !== 'geomap' &&
            dashboardPanelData.data.type !== 'maps'
          "
          v-show="isConfigOptionVisible('general', 'promql-chart-config')"
          :chart-type="dashboardPanelData.data.type"
          :is-config-option-visible="isConfigOptionVisible"
        />
      </div>
    </q-expansion-item>

    <!-- Section: PromQL Table Configuration -->
    <q-expansion-item
      v-if="promqlMode && dashboardPanelData.data.type === 'table'"
      v-show="isSectionVisible('promqlTable')"
      :model-value="isExpanded('promqlTable')"
      @update:model-value="
        (v) => {
          expandedSections.promqlTable = v;
        }
      "
      :label="t('dashboard.configSectionPromqlTable')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <PromQLChartConfig
          :chart-type="dashboardPanelData.data.type"
          :is-config-option-visible="isConfigOptionVisible"
        />
      </div>
    </q-expansion-item>

    <!-- Section: Geographic Configuration -->
    <q-expansion-item
      v-if="
        promqlMode &&
        (dashboardPanelData.data.type === 'geomap' ||
          dashboardPanelData.data.type === 'maps')
      "
      v-show="isSectionVisible('geographic')"
      :model-value="isExpanded('geographic')"
      @update:model-value="
        (v) => {
          expandedSections.geographic = v;
        }
      "
      :label="t('dashboard.configSectionGeographic')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <PromQLChartConfig :chart-type="dashboardPanelData.data.type" />
      </div>
    </q-expansion-item>

    <!-- Section: Legend -->
    <q-expansion-item
      v-show="isSectionVisible('legend')"
      :model-value="isExpanded('legend')"
      @update:model-value="
        (v) => {
          expandedSections.legend = v;
        }
      "
      :label="t('dashboard.configSectionLegend')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-toggle
          v-if="shouldShowLegendsToggle(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'show-legends')"
          v-model="dashboardPanelData.data.config.show_legends"
          :label="t('dashboard.showLegendsLabel')"
          data-test="dashboard-config-show-legend"
          class="tw:h-[30px] o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-select
          v-if="shouldShowLegendPosition(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'legend-position')"
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

        <q-select
          v-if="shouldShowLegendType(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'legend-type')"
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
          v-show="isConfigOptionVisible('legend', 'legend-size')"
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
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-width"
              hide-bottom-space
            ></q-input>
            <div
              class="unit-container"
              v-if="shouldShowLegendWidthUnitContainer(dashboardPanelData)"
            >
              <OButton
                @click="setUnit('px')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config.legend_width?.unit ===
                    null ||
                  dashboardPanelData?.data?.config?.legend_width?.unit === 'px'
                "
                size="sm"
                :data-test="`dashboard-config-legend-width-unit-${
                  dashboardPanelData?.data?.config?.legend_width?.unit === 'px'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                px
              </OButton>
              <OButton
                @click="setUnit('%')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config?.legend_width?.unit === '%'
                "
                size="sm"
                :data-test="`dashboard-config-legend-width-unit-${
                  dashboardPanelData?.data?.config?.legend_width?.unit === '%'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                %
              </OButton>
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
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-height"
              hide-bottom-space
            ></q-input>
            <div
              class="unit-container"
              v-if="shouldShowLegendHeightUnitContainer(dashboardPanelData)"
            >
              <OButton
                @click="setHeightUnit('px')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config.legend_height?.unit ===
                    null ||
                  dashboardPanelData?.data?.config?.legend_height?.unit === 'px'
                "
                size="sm"
                :data-test="`dashboard-config-legend-height-unit-${
                  dashboardPanelData?.data?.config?.legend_height?.unit === 'px'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                px
              </OButton>
              <OButton
                @click="setHeightUnit('%')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config?.legend_height?.unit === '%'
                "
                size="sm"
                :data-test="`dashboard-config-legend-height-unit-${
                  dashboardPanelData?.data?.config?.legend_height?.unit === '%'
                    ? 'active'
                    : 'inactive'
                }`"
              >
                %
              </OButton>
            </div>
          </div>
        </div>

        <q-select
          v-if="shouldApplyChartAlign(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'chart-align')"
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
          v-show="isConfigOptionVisible('legend', 'promql-legend')"
          class="showLabelOnTop"
          style="font-weight: 600"
        >
          {{ t("dashboard.query") }}
          <OTabs
            v-model="dashboardPanelData.layout.currentQueryIndex"
            dense
            mobile-arrows
            data-test="dashboard-config-query-tab"
          >
            <OTab
              v-for="(tab, index) in dashboardPanelData.data.queries"
              :key="index"
              :name="index"
              :label="`${t('dashboard.queryLabel')} ${Number(index) + 1}`"
              :data-test="`dashboard-config-query-tab-${index}`"
            >
            </OTab>
          </OTabs>
        </div>

        <CommonAutoComplete
          v-if="
            promqlMode &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="isConfigOptionVisible('legend', 'promql-legend-label')"
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
          class="showLabelOnTop q-mt-sm"
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
      v-show="isSectionVisible('data')"
      :model-value="isExpanded('data')"
      @update:model-value="
        (v) => {
          expandedSections.data = v;
        }
      "
      :label="t('dashboard.configSectionData')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-select
          v-show="isConfigOptionVisible('data', 'unit')"
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
          v-show="isConfigOptionVisible('data', 'custom-unit')"
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
          v-show="isConfigOptionVisible('data', 'decimals')"
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
          v-show="isConfigOptionVisible('data', 'limit')"
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
          v-show="isConfigOptionVisible('data', 'top-results')"
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
          :placeholder="t('dashboard.placeholderAll')"
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
          v-show="isConfigOptionVisible('data', 'top-results-others')"
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
          v-show="isConfigOptionVisible('data', 'connect-nulls')"
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
          v-show="isConfigOptionVisible('data', 'no-value-replacement')"
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
      v-show="isSectionVisible('axis')"
      :model-value="isExpanded('axis')"
      @update:model-value="
        (v) => {
          expandedSections.axis = v;
        }
      "
      :label="t('dashboard.configSectionAxis')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-input
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-width')"
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
          :placeholder="t('dashboard.auto')"
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
          v-show="isConfigOptionVisible('axis', 'axis-border')"
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
          v-show="isConfigOptionVisible('axis', 'y-axis')"
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
            :placeholder="t('dashboard.auto')"
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
            :placeholder="t('dashboard.auto')"
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
          v-show="isConfigOptionVisible('axis', 'gridlines')"
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
      v-show="isSectionVisible('labels')"
      :model-value="isExpanded('labels')"
      @update:model-value="
        (v) => {
          expandedSections.labels = v;
        }
      "
      :label="t('dashboard.configSectionLabels')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-select
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('labels', 'label-position')"
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
              : t('dashboard.none')
          }`"
          data-test="dashboard-config-label-position"
        >
        </q-select>

        <q-input
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('labels', 'label-rotate')"
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
          v-show="isConfigOptionVisible('labels', 'axis-label')"
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
                <span>{{ t("dashboard.axisLabelRotate") }}</span>
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
                      <span>{{
                        t("dashboard.axisLabelRotateTooltipText")
                      }}</span>
                      <br /><br />
                      <b>{{ t("dashboard.axisLabelTooltipNotePrefix") }}</b>
                      <span>{{ t("dashboard.axisLabelTooltipNoteText") }}</span>
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
                <span>{{ t("dashboard.axisLabelTruncate") }}</span>
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
                      <span>{{
                        t("dashboard.axisLabelTruncateTooltipText")
                      }}</span>
                      <br /><br />
                      <b>{{ t("dashboard.axisLabelTooltipNotePrefix") }}</b>
                      <span>{{ t("dashboard.axisLabelTooltipNoteText") }}</span>
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
      v-show="isSectionVisible('lineStyle')"
      :model-value="isExpanded('lineStyle')"
      @update:model-value="
        (v) => {
          expandedSections.lineStyle = v;
        }
      "
      :label="t('dashboard.configSectionLineStyle')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body o2-input">
        <q-select
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('lineStyle', 'symbol')"
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
          v-show="isConfigOptionVisible('lineStyle', 'interpolation')"
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
          v-show="isConfigOptionVisible('lineStyle', 'line-thickness')"
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
      v-show="isSectionVisible('table')"
      :model-value="isExpanded('table')"
      @update:model-value="
        (v) => {
          expandedSections.table = v;
        }
      "
      :label="t('dashboard.configSectionTable')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-toggle
          v-show="isConfigOptionVisible('table', 'wrap')"
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
          v-show="isConfigOptionVisible('table', 'transpose')"
          v-model="dashboardPanelData.data.config.table_transpose"
          :label="t('dashboard.tableTranspose')"
          data-test="dashboard-config-table_transpose"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :disable="isPivotMode"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-toggle
          v-if="!promqlMode"
          v-show="isConfigOptionVisible('table', 'dynamic-columns')"
          v-model="dashboardPanelData.data.config.table_dynamic_columns"
          :label="t('dashboard.tableDynamicColumns')"
          data-test="dashboard-config-table_dynamic_columns"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
          :disable="isPivotMode"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

        <q-toggle
          v-show="isConfigOptionVisible('table', 'pagination')"
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
          v-show="isConfigOptionVisible('table', 'rows-per-page')"
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
          :placeholder="t('dashboard.auto')"
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
      </div>
    </q-expansion-item>

    <!-- Section: Pivot Table -->
    <q-expansion-item
      v-show="isSectionVisible('pivotTable')"
      :model-value="isExpanded('pivotTable')"
      @update:model-value="
        (v) => {
          expandedSections.pivotTable = v;
        }
      "
      :label="t('dashboard.configSectionPivotTable')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-toggle
          v-if="!promqlMode && isPivotMode"
          v-show="isConfigOptionVisible('pivotTable', 'pivot-show-row-totals')"
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
        >
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.pivotShowRowTotalsTooltip") }}
            </q-tooltip>
          </OButton>
        </q-toggle>

        <q-toggle
          v-if="
            !promqlMode &&
            isPivotMode &&
            dashboardPanelData.data.config.table_pivot_show_row_totals
          "
          v-show="
            isConfigOptionVisible('pivotTable', 'pivot-sticky-col-totals')
          "
          v-model="dashboardPanelData.data.config.table_pivot_sticky_col_totals"
          :label="t('dashboard.pivotStickyColTotals')"
          data-test="dashboard-config-pivot-sticky-col-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg tw:pl-4"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        >
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.pivotStickyColTotalsTooltip") }}
            </q-tooltip>
          </OButton>
        </q-toggle>

        <q-toggle
          v-if="!promqlMode && isPivotMode"
          v-show="isConfigOptionVisible('pivotTable', 'pivot-show-col-totals')"
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
        >
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.pivotShowColTotalsTooltip") }}
            </q-tooltip>
          </OButton>
        </q-toggle>

        <q-toggle
          v-if="
            !promqlMode &&
            isPivotMode &&
            dashboardPanelData.data.config.table_pivot_show_col_totals
          "
          v-show="
            isConfigOptionVisible('pivotTable', 'pivot-sticky-row-totals')
          "
          v-model="dashboardPanelData.data.config.table_pivot_sticky_row_totals"
          :label="t('dashboard.pivotStickyRowTotals')"
          data-test="dashboard-config-pivot-sticky-row-totals"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg tw:pl-4"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        >
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
              max-width="250px"
            >
              {{ t("dashboard.pivotStickyRowTotalsTooltip") }}
            </q-tooltip>
          </OButton>
        </q-toggle>
      </div>
    </q-expansion-item>

    <!-- Section: Value Transformations -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="isSectionVisible('valueTransformations')"
      :model-value="isExpanded('valueTransformations')"
      @update:model-value="
        (v) => {
          expandedSections.valueTransformations = v;
        }
      "
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <template #header>
        <div style="display: flex; align-items: center; flex: 1; min-width: 0">
          {{ t("dashboard.configSectionValueTransformations") }}
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="bottom middle"
              self="top middle"
              max-width="250px"
            >
              {{ t("dashboard.configSectionValueTransformationsTooltip") }}
            </q-tooltip>
          </OButton>
        </div>
      </template>
      <div class="config-section-body">
        <ValueMapping />
      </div>
    </q-expansion-item>

    <!-- Section: Field Overrides -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="isSectionVisible('fieldOverrides')"
      :model-value="isExpanded('fieldOverrides')"
      @update:model-value="
        (v) => {
          expandedSections.fieldOverrides = v;
        }
      "
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <template #header>
        <div style="display: flex; align-items: center; flex: 1; min-width: 0">
          {{ t("dashboard.configSectionFieldOverrides") }}
          <OButton variant="ghost" size="icon" @click.stop>
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="bottom middle"
              self="top middle"
              max-width="250px"
            >
              {{ t("dashboard.configSectionFieldOverridesTooltip") }}
            </q-tooltip>
          </OButton>
        </div>
      </template>
      <div class="config-section-body hide-child-title">
        <OverrideConfig
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
      v-show="isSectionVisible('map')"
      :model-value="isExpanded('map')"
      @update:model-value="
        (v) => {
          expandedSections.map = v;
        }
      "
      :label="t('dashboard.configSectionMap')"
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
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.mapsMapType") }}
              <q-icon class="q-ml-xs" size="20px" name="info" />
              <q-tooltip class="bg-grey-8" max-width="250px">
                {{ t("dashboard.mapsMapTypeTooltip") }}
              </q-tooltip>
            </div>
          </template>
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
      v-show="isSectionVisible('gauge')"
      :model-value="isExpanded('gauge')"
      @update:model-value="
        (v) => {
          expandedSections.gauge = v;
        }
      "
      :label="t('dashboard.configSectionGauge')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-input
          v-show="isConfigOptionVisible('gauge', 'gauge-min')"
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
          v-show="isConfigOptionVisible('gauge', 'gauge-max')"
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
      v-show="isSectionVisible('layout')"
      :model-value="isExpanded('layout')"
      @update:model-value="
        (v) => {
          expandedSections.layout = v;
        }
      "
      :label="t('dashboard.configSectionLayout')"
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <div class="config-section-body">
        <q-select
          v-show="isConfigOptionVisible('layout', 'trellis-layout')"
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
            dashboardPanelData.data.config.trellis?.layout ??
            t('dashboard.none')
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
          v-show="isConfigOptionVisible('layout', 'trellis-columns')"
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
            :placeholder="t('dashboard.auto')"
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
          v-show="isConfigOptionVisible('layout', 'trellis-group-by')"
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
      v-show="isSectionVisible('colors')"
      :model-value="isExpanded('colors')"
      @update:model-value="
        (v) => {
          expandedSections.colors = v;
        }
      "
      :label="t('dashboard.configSectionColors')"
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
      v-show="isSectionVisible('drilldown')"
      :model-value="isExpanded('drilldown')"
      @update:model-value="
        (v) => {
          expandedSections.drilldown = v;
        }
      "
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <template #header>
        <div style="display: flex; align-items: center; flex: 1; min-width: 0">
          {{ t("dashboard.drilldown") }}
          <OButton
            variant="ghost"
            size="icon"
            data-test="dashboard-addpanel-config-drilldown-info"
            @click.stop
          >
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="bottom middle"
              self="top middle"
              max-width="250px"
            >
              {{ t("dashboard.drilldownTooltip") }}
            </q-tooltip>
          </OButton>
        </div>
      </template>
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
      v-show="isSectionVisible('comparison')"
      :model-value="isExpanded('comparison')"
      @update:model-value="
        (v) => {
          expandedSections.comparison = v;
        }
      "
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <template #header>
        <div style="display: flex; align-items: center; flex: 1; min-width: 0">
          {{ t("dashboard.comparisonAgainst") }}
          <OButton
            variant="ghost"
            size="icon"
            data-test="dashboard-addpanel-config-time-shift-info"
            @click.stop
          >
            <template #icon-left><q-icon name="info_outline" /></template>
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
          </OButton>
        </div>
      </template>
      <div class="config-section-body">
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
        <div style="align-self: flex-start">
          <OButton
            variant="outline"
            size="sm"
            @click="addTimeShift"
            data-test="dashboard-addpanel-config-time-shift-add-btn"
            >{{ t("dashboard.addButton") }}</OButton
          >
        </div>
      </div>
    </q-expansion-item>

    <!-- Section: Mark Lines -->
    <q-expansion-item
      v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
      v-show="isSectionVisible('markLines')"
      :model-value="isExpanded('markLines')"
      @update:model-value="
        (v) => {
          expandedSections.markLines = v;
        }
      "
      header-class="tw:font-semibold tw:text-[13px] tw:min-h-[36px] tw:px-3 tw:bg-[var(--o2-section-header-bg)] tw:hover:opacity-80 tw:transition-opacity tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]"
      switch-toggle-side
      expand-icon="chevron_right"
      expanded-icon="keyboard_arrow_down"
      expand-icon-class="text-grey-6"
    >
      <template #header>
        <div style="display: flex; align-items: center; flex: 1; min-width: 0">
          {{ t("dashboard.markLines") }}
          <OButton
            variant="ghost"
            size="icon"
            data-test="dashboard-addpanel-config-markline-info"
            @click.stop
          >
            <template #icon-left><q-icon name="info_outline" /></template>
            <q-tooltip
              class="bg-grey-8"
              anchor="bottom middle"
              self="top middle"
              max-width="250px"
            >
              {{ t("dashboard.markLinesTooltip") }}
            </q-tooltip>
          </OButton>
        </div>
      </template>
      <div class="config-section-body">
        <MarkLineConfig />
      </div>
    </q-expansion-item>

    <!-- Section: Background -->
    <q-expansion-item
      v-if="dashboardPanelData.data.type == 'metric'"
      v-show="isSectionVisible('background')"
      :model-value="isExpanded('background')"
      @update:model-value="
        (v) => {
          expandedSections.background = v;
        }
      "
      :label="t('dashboard.configSectionBackground')"
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
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
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
import ConfigPanelSearch from "./ConfigPanelSearch.vue";
import { useConfigPanel } from "../../../composables/dashboard/useConfigPanel";
import { SectionId } from "../../../utils/dashboard/searchLabelsConfig";
import LinearIcon from "@/components/icons/dashboards/LinearIcon.vue";
import NoSymbol from "@/components/icons/dashboards/NoSymbol.vue";
import Smooth from "@/components/icons/dashboards/Smooth.vue";
import StepBefore from "@/components/icons/dashboards/StepBefore.vue";
import StepAfter from "@/components/icons/dashboards/StepAfter.vue";
import StepMiddle from "@/components/icons/dashboards/StepMiddle.vue";
import PromQLChartConfig from "./PromQLChartConfig.vue";
import OButton from "@/lib/core/Button/OButton.vue";
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
    OTabs,
    OTab,
    ConfigPanelSearch,
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
    OButton,
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
    // initialize pivot config values (undefined → false defaults).
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

    // Cancel (remove set time via X icon) back to "+Set" button
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

    const {
      searchQuery,
      expandedSections,
      isConfigOptionVisible,
      isSectionVisible,
      isExpanded,
      toggleSection,
      resetSearch,
      allSectionsExpanded,
      toggleAllSections,
      anySectionVisible,
    } = useConfigPanel(
      dashboardPanelData,
      promqlMode,
      dashboardPanelDataPageKey,
      showTrellisConfig,
      showColorPalette,
      isPivotMode,
    );

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
      isExpanded,
      isSectionVisible,
      isConfigOptionVisible,
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

.unit-container {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 9px;
}

.config-legend-input {
  min-width: 80px;
}

.panel-time-picker-container {
  overflow: hidden;
}

.panel-time-picker-btn {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;

  :deep(.date-time-button) {
    width: fit-content;
    min-width: 0 !important;
    max-width: 100%;
    overflow: hidden;

    .date-time-label {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .date-time-arrow {
      flex-shrink: 0;
      font-size: 18px !important;
    }
  }
}

.config-search-wrapper {
  padding: 4px 4px;
  top: 0;
  z-index: 10;
  background-color: var(--o2-card-bg-solid);
  border-bottom: 1px solid var(--o2-border-color);
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
