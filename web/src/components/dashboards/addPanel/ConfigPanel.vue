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
  <div v-if="dashboardPanelData.data.type == 'custom_chart'" class="pb-8">
    <div class="max-w-75 mx-3">
      <div class="mb-1.5 text-compact font-medium text-input-label-text">
        {{ t("dashboard.description") }}
      </div>
      <OTextarea
        v-model="dashboardPanelDataModel.data.description"
        autogrow
        data-test="dashboard-config-description"
      />
    </div>
  </div>
  <div v-else class="pb-8">
    <!-- Search bar (sticky; h-11 matches the config section headers' sticky top) -->
    <div
      class="sticky top-0 z-30 flex h-11 items-center gap-1 px-2 bg-card-glass-solid"
      data-test="dashboard-config-search-wrapper"
    >
      <ConfigPanelSearch v-model="searchQuery" class="flex-1 min-w-0" />
      <OButton
        variant="ghost"
        size="icon"
        @click="toggleAllSections"
        data-test="dashboard-config-toggle-all-sections-btn"
        :data-test-all-expanded="String(allSectionsExpanded)"
        :aria-label="
          allSectionsExpanded
            ? t('dashboard.collapseAllSections')
            : t('dashboard.expandAllSections')
        "
      >
        <template #icon-left><OIcon
            :name="allSectionsExpanded ? 'unfold-less' : 'unfold-more'"
            size="sm"
        /></template>
        <OTooltip
          :content="
            allSectionsExpanded
              ? t('dashboard.collapseAllSections')
              : t('dashboard.expandAllSections')
          "
        />
      </OButton>
    </div>

    <!-- No results empty state -->
    <div
      v-if="searchQuery && !anySectionVisible"
      class="column items-center py-4 text-center"
      data-test="dashboard-config-no-results"
    >
      <OIcon name="search-off" size="md" class="mb-1 text-icon-color" />
      <div class="text-text-muted text-xs">
        {{ t("dashboard.configPanelNoResultsFound", { query: searchQuery }) }}
      </div>
    </div>

    <!-- Section: General -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('general')"
      :model-value="isExpanded('general')"
      :icon="SECTION_ICONS.general"
      @update:modelValue="
        (v) => {
          expandedSections.general = v;
        }
      "
      :label="t('dashboard.configSectionGeneral')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <div
          v-show="isConfigOptionVisible('general', 'description')"
          class="max-w-75"
        >
          <div class="mb-1.5 text-compact font-medium text-input-label-text">
            {{ t("dashboard.description") }}
          </div>
          <OTextarea
            v-model="dashboardPanelDataModel.data.description"
            autogrow
            data-test="dashboard-config-description"
          />
        </div>

        <OInput
          v-if="promqlMode"
          v-show="isConfigOptionVisible('general', 'step')"
          v-model="dashboardPanelDataModel.data.config.step_value"
          type="text"
          :label="t('dashboard.stepValue')"
          :placeholder="t('dashboard.intervalInputPlaceholder')"
          data-test="dashboard-config-step-value"
        >
          <template #tooltip>
            <OTooltip max-width="250px">
              <template #content>
                <b>Step - </b>
                {{ t("dashboard.stepValueTooltip") }}
                <br />
                {{ t("dashboard.stepValueExample") }}
              </template>
            </OTooltip>
          </template>
        </OInput>

        <!-- Panel Default Time Configuration -->
        <div
          v-show="isConfigOptionVisible('general', 'panel-default-time')"
        >
          <div class="flex items-center">
            <OSwitch
              v-model="useDefaultTime"
              :label="t('dashboard.panelTimeEnabled')"
              data-test="dashboard-config-allow-panel-time"
              size="lg"
              @change="onToggleDefaultTime"
            />
            <OButton
              variant="ghost"
              size="icon"
              class="mt-1"
              @click.stop
              icon-left="info-outline"
            >
              <OTooltip
                :content="t('dashboard.useDefaultTimeTooltip')"
                max-width="250px"
              />
            </OButton>
          </div>

          <div v-if="useDefaultTime" class="mt-2">
            <div class="mb-1.5 text-compact font-medium text-input-label-text">
              {{ t("dashboard.defaultDuration") }}
            </div>
            <div
              v-if="
                showTimePicker ||
                (panelTimeRange !== null && panelTimeRange !== undefined)
              "
              class="flex items-center flex-nowrap overflow-visible"
            >
              <div class="panel-time-picker-btn flex-[1_1_0] min-w-0 overflow-visible">
                <DateTimePickerDashboard
                  ref="panelTimePickerRef"
                  v-model="pickerValue"
                  :auto-apply-dashboard="true"
                  :hide-relative-timezone="true"
                  menu-align="end"
                  data-test="dashboard-config-panel-time-picker"
                  class="w-fit min-w-0 max-w-full overflow-hidden"
                />
                <OTooltip :content="formattedPickerValue" max-width="320px" />
              </div>
              <OIcon
                class="mr-1 ml-2 flex-shrink-0 cursor-pointer shrink-0"
                size="sm"
                name="close"
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
    </OCollapsible>

    <!-- Section: PromQL Table Configuration -->
    <OCollapsible
      variant="config"
      v-if="promqlMode && dashboardPanelData.data.type === 'table'"
      v-show="isSectionVisible('promqlTable')"
      :model-value="isExpanded('promqlTable')"
      :icon="SECTION_ICONS.promqlTable"
      @update:modelValue="
        (v) => {
          expandedSections.promqlTable = v;
        }
      "
      :label="t('dashboard.configSectionPromqlTable')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <PromQLChartConfig
          :chart-type="dashboardPanelData.data.type"
          :is-config-option-visible="isConfigOptionVisible"
        />
      </div>
    </OCollapsible>

    <!-- Section: Geographic Configuration -->
    <OCollapsible
      variant="config"
      v-if="
        promqlMode &&
        (dashboardPanelData.data.type === 'geomap' ||
          dashboardPanelData.data.type === 'maps')
      "
      v-show="isSectionVisible('geographic')"
      :model-value="isExpanded('geographic')"
      :icon="SECTION_ICONS.geographic"
      @update:modelValue="
        (v) => {
          expandedSections.geographic = v;
        }
      "
      :label="t('dashboard.configSectionGeographic')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <PromQLChartConfig :chart-type="dashboardPanelData.data.type" />
      </div>
    </OCollapsible>

    <!-- Section: Legend -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('legend')"
      :model-value="isExpanded('legend')"
      :icon="SECTION_ICONS.legend"
      @update:modelValue="
        (v) => {
          expandedSections.legend = v;
        }
      "
      :label="t('dashboard.configSectionLegend')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="o2-input flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSwitch
          v-if="shouldShowLegendsToggle(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'show-legends')"
          v-model="dashboardPanelDataModel.data.config.show_legends"
          :label="t('dashboard.showLegendsLabel')"
          data-test="dashboard-config-show-legend"
          size="lg"
        />

        <OToggleGroup
          v-if="shouldShowLegendPosition(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'legend-position')"
          type="single"
          label-position="top"
          :label="t('dashboard.legendsPositionLabel')"
          v-model="legendsPositionModel"
          data-test="dashboard-config-legend-position"
          :data-test-selected-value="
            String(dashboardPanelDataModel.data.config.legends_position)
          "
        >
          <OToggleGroupItem
            v-for="opt in legendsPositionOptions"
            :key="String(opt.value)"
            :value="toggleItemValue(opt.value)"
            size="sm"
            data-test="dashboard-config-legend-position-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-if="shouldShowLegendType(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'legend-type')"
          type="single"
          label-position="top"
          :label="t('dashboard.legendsType')"
          v-model="legendsTypeModel"
          data-test="dashboard-config-legends-scrollable"
          :data-test-selected-value="
            String(dashboardPanelDataModel.data.config.legends_type)
          "
        >
          <OToggleGroupItem
            v-for="opt in legendTypeOptions"
            :key="String(opt.value)"
            :value="toggleItemValue(opt.value)"
            size="sm"
            data-test="dashboard-config-legends-scrollable-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <div class="flex gap-2 flex-wrap"
          v-show="isConfigOptionVisible('legend', 'legend-size')"
        >
          <!-- Legend Width + unit selector -->
          <div
            v-if="shouldShowLegendWidth(dashboardPanelData)"
            class="flex items-end justify-between gap-1.5 w-full min-w-0"
          >
            <OInput
              v-model.number="legendWidthValue"
              :label="t('common.legendWidth')"
              type="number"
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-width"
              class="flex-1 min-w-0"
            />
            <div
              class="flex items-center gap-1 mt-2.25 shrink-0"
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
            class="flex items-end justify-between gap-1.5 w-full min-w-0"
          >
            <OInput
              v-model.number="legendHeightValue"
              :label="t('dashboard.legendHeight')"
              type="number"
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-height"
              class="flex-1 min-w-0"
            />
            <div
              class="flex items-center gap-1 mt-2.25 shrink-0"
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

        <OToggleGroup
          v-if="shouldApplyChartAlign(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'chart-align')"
          type="single"
          label-position="top"
          :label="t('dashboard.chartAlign')"
          v-model="chartAlignModel"
          data-test="dashboard-config-chart-align"
          :data-test-selected-value="
            String(dashboardPanelDataModel.data.config.chart_align)
          "
        >
          <OToggleGroupItem
            v-for="opt in chartAlignOptions"
            :key="String(opt.value)"
            :value="toggleItemValue(opt.value)"
            size="sm"
            data-test="dashboard-config-chart-align-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <div
          v-if="
            promqlMode &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="isConfigOptionVisible('legend', 'promql-legend')"
          class="showLabelOnTop font-semibold"
        >
          {{ t("dashboard.query") }}
          <OTabs
            v-model="dashboardPanelDataModel.layout.currentQueryIndex"
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

        <OCombobox
          v-if="
            promqlMode &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="isConfigOptionVisible('legend', 'promql-legend-label')"
          :label="t('common.legend')"
          v-model="
            dashboardPanelDataModel.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.promql_legend
          "
          :items="dashboardSelectfieldPromQlList"
          search-regex="(?:{([^}]*)(?:{.*})*$|([a-zA-Z-_]+)$)"
          :value-replace-fn="selectPromQlNameOption"
          data-test="dashboard-config-promql-legend"
        >
          <template v-slot:label>
            <div class="flex items-center">
              {{ t("dashboard.legendLabel") }}
              <div>
                <OIcon
                  class="ml-1"
                  size="sm"
                  name="info-outline"
                  data-test="dashboard-config-promql-legend-info"
                />
                <OTooltip :content="t('dashboard.overrideMessage')" />
              </div>
            </div>
          </template>
        </OCombobox>
      </div>
    </OCollapsible>

    <!-- Section: Data -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('data')"
      :model-value="isExpanded('data')"
      :icon="SECTION_ICONS.data"
      @update:modelValue="
        (v) => {
          expandedSections.data = v;
        }
      "
      :label="t('dashboard.configSectionData')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="o2-input flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSelect
          v-show="isConfigOptionVisible('data', 'unit')"
          v-model="dashboardPanelDataModel.data.config.unit"
          :options="unitOptions"
          :label="t('dashboard.unitLabel')"
          :valueKey="'value'"
          :labelKey="'label'"
          data-test="dashboard-config-unit"
        />

        <OInput
          v-if="dashboardPanelData.data.config.unit == 'custom'"
          v-show="isConfigOptionVisible('data', 'custom-unit')"
          v-model="dashboardPanelDataModel.data.config.unit_custom"
          :label="t('dashboard.customunitLabel')"
          data-test="dashboard-config-custom-unit"
        />

        <OInput
          v-show="isConfigOptionVisible('data', 'decimals')"
          type="number"
          v-model.number="dashboardPanelDataModel.data.config.decimals"
          min="0"
          max="100"
          @update:model-value="
            (val: string | number) => {
              if (typeof val === 'number' && (val < 0 || val > 100)) {
                decimalsTouched = true;
              }
            }
          "
          @blur="
            () => {
              decimalsTouched = true;
              const val = dashboardPanelData.data.config.decimals;
              // Empty field → silently reset to default 2
              if (val == null || val === '') {
                dashboardPanelDataModel.data.config.decimals = 2;
              }
              // Invalid value (out of range) → keep it and show error
            }
          "
          :error="decimalsTouched && typeof dashboardPanelData.data.config.decimals === 'number' && (dashboardPanelData.data.config.decimals < 0 || dashboardPanelData.data.config.decimals > 100)"
          :error-message="t('dashboard.decimalsMustBeBetween')"
          :label="t('dashboard.decimals')"
          data-test="dashboard-config-decimals"
        />

        <!-- Multi-SQL: extra query-tabs visible when SQL has 2+ queries
             (promql query-tabs are rendered separately above). Not for
             geomap/maps which don't support multi-query. -->
        <div
          v-if="
            !promqlMode &&
            dashboardPanelData.data.queries.length > 1 &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          class="showLabelOnTop font-semibold"
        >
          {{ t("dashboard.query") }}
          <OTabs
            v-model="dashboardPanelDataModel.layout.currentQueryIndex"
            dense
            mobile-arrows
            data-test="dashboard-config-query-tab"
          >
            <OTab
              v-for="(tab, index) in dashboardPanelData.data.queries"
              :key="index"
              :name="index"
              :label="tab.tabName || (t('dashboard.queryLabel') + ' ' + (Number(index) + 1))"
              :data-test="`dashboard-config-query-tab-${index}`"
            >
            </OTab>
          </OTabs>
        </div>

        <!-- Multi-SQL: per-query custom legend label, visible only for SQL with 2+ queries -->
        <div
          v-if="
            !promqlMode &&
            dashboardPanelData.data.queries.length > 1 &&
            dashboardPanelData.data.type != 'geomap' &&
            dashboardPanelData.data.type != 'maps'
          "
          v-show="isConfigOptionVisible('data', 'query-label')"
        >
          <div class="flex items-center gap-1 mb-1.5 text-compact font-medium text-input-label-text">
            {{ t("dashboard.multiSqlQueryLabel") }}
            <OIcon name="info-outline" size="sm" />
            <OTooltip
              side="top"
              align="center"
              max-width="250px"
              :content="t('dashboard.multiSqlQueryLabelHint')"
            />
          </div>
          <OInput
            v-model="
              dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.query_label
            "
            size="sm"
            placeholder="{field_name}"
            class="w-full"
            :data-test="`dashboard-config-legend-${dashboardPanelData.layout.currentQueryIndex}`"
            @focus="() => {
              const q = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
              if (!q.config.query_label) q.config.query_label = '{field_name}';
            }"
          />
        </div>

        <OInput
          v-if="
            !promqlMode &&
            !dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].customQuery
          "
          v-show="isConfigOptionVisible('data', 'limit')"
          v-model.number="
            dashboardPanelDataModel.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.limit
          "
          type="number"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.limit = typeof value === 'number' ? value : null)
          "
          @blur="() => dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.limit == null && (dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex].config.limit = 0)"
          placeholder="0"
          :label="t('dashboard.queryLimit')"
          data-test="dashboard-config-limit"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.limitForQueryResult')" />
          </template>
        </OInput>

        <OInput
          v-if="shouldShowTopResultsConfig(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('data', 'top-results')"
          v-model.number="dashboardPanelDataModel.data.config.top_results"
          type="number"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.top_results = value
                ? value
                : null)
          "
          :placeholder="t('dashboard.placeholderAll')"
          :disabled="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.breakdown?.length == 0
          "
          :label="t('dashboard.showTopNValues')"
          data-test="dashboard-config-top_results"
        >
          <template #tooltip>
            <OTooltip max-width="250px">
              <template #content>
                <b>{{ t("dashboard.topNTooltipTitle") }}</b>
                <br /><br />
                {{ t("dashboard.topNTooltipDescription") }}
              </template>
            </OTooltip>
          </template>
        </OInput>

        <OSwitch
          v-if="shouldShowTopResultsConfig(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('data', 'top-results-others')"
          v-model="dashboardPanelDataModel.data.config.top_results_others"
          :label="t('dashboard.addOthersSeries')"
          data-test="dashboard-config-top_results_others"
          :disabled="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.breakdown?.length == 0
          "
          size="lg"
        >
          <template #tooltip>
            <OTooltip
              :content="t('dashboard.addOthersSeriesTooltip')"
              max-width="250px"
            />
          </template>
        </OSwitch>

        <OSwitch
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('data', 'connect-nulls')"
          v-model="dashboardPanelDataModel.data.config.connect_nulls"
          :label="t('dashboard.connectNullValues')"
          data-test="dashboard-config-connect-null-values"
          size="lg"
        >
          <template #tooltip>
            <OTooltip
              :content="t('dashboard.connectNullValuesTooltip')"
              max-width="250px"
            />
          </template>
        </OSwitch>

        <OInput
          v-if="shouldShowNoValueReplacement(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('data', 'no-value-replacement')"
          v-model="dashboardPanelDataModel.data.config.no_value_replacement"
          placeholder="-"
          :label="t('dashboard.noValueReplacement')"
          data-test="dashboard-config-no-value-replacement"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.noValueReplacementTooltip')" />
          </template>
        </OInput>
      </div>
    </OCollapsible>

    <!-- Section: Axis -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('axis')"
      :model-value="isExpanded('axis')"
      :icon="SECTION_ICONS.axis"
      @update:modelValue="
        (v) => {
          expandedSections.axis = v;
        }
      "
      :label="t('dashboard.configSectionAxis')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OInput
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-width')"
          v-model.number="dashboardPanelDataModel.data.config.axis_width"
          :label="t('common.axisWidth')"
          type="number"
          :placeholder="t('dashboard.auto')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.axis_width =
                value !== '' ? value : null)
          "
          data-test="dashboard-config-axis-width"
        />

        <OSwitch
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-border')"
          v-model="dashboardPanelDataModel.data.config.axis_border_show"
          :label="t('dashboard.showBorder')"
          data-test="dashboard-config-axis-border"
          size="lg"
        />

        <div
          class="flex gap-2"
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'y-axis')"
        >
          <OInput
            class="flex-1 min-w-0"
            v-model.number="dashboardPanelDataModel.data.config.y_axis_min"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('common.yAxisMin')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.y_axis_min =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-y_axis_min"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <b>{{ t("dashboard.yAxisMinTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.yAxisMinTooltipDescription") }}
                </template>
              </OTooltip>
            </template>
          </OInput>
          <OInput
            class="flex-1 min-w-0"
            v-model.number="dashboardPanelDataModel.data.config.y_axis_max"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('common.yAxisMax')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.y_axis_max =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-y_axis_max"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <b>{{ t("dashboard.yAxisMaxTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.yAxisMaxTooltipDescription") }}
                </template>
              </OTooltip>
            </template>
          </OInput>
        </div>

        <OSwitch
          v-if="shouldShowGridlines(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'gridlines')"
          v-model="dashboardPanelDataModel.data.config.show_gridlines"
          :label="t('dashboard.showGridlines')"
          data-test="dashboard-config-show-gridlines"
          size="lg"
        />
      </div>
    </OCollapsible>

    <!-- Section: Labels -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('labels')"
      :model-value="isExpanded('labels')"
      :icon="SECTION_ICONS.labels"
      @update:modelValue="
        (v) => {
          expandedSections.labels = v;
        }
      "
      :label="t('dashboard.configSectionLabels')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSelect
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('labels', 'label-position')"
          v-model="dashboardPanelDataModel.data.config.label_option.position"
          :options="labelPositionOptions"
          :label="t('dashboard.labelPosition')"
          :valueKey="'value'"
          :labelKey="'label'"
          data-test="dashboard-config-label-position"
        />

        <OInput
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('labels', 'label-rotate')"
          v-model.number="dashboardPanelDataModel.data.config.label_option.rotate"
          :label="t('dashboard.labelRotate')"
          type="number"
          placeholder="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.label_option.rotate =
                typeof value === 'number' ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.config.label_option.rotate == null)
                dashboardPanelDataModel.data.config.label_option.rotate = 0
            }
          "
          data-test="dashboard-config-label-rotate"
        />

        <div
          class="flex gap-2"
          v-if="shouldShowAxisLabelConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('labels', 'axis-label')"
        >
          <OInput
            class="flex-1 min-w-0"
            v-model.number="dashboardPanelDataModel.data.config.axis_label_rotate"
            type="number"
            placeholder="0"
            :label="t('dashboard.axisLabelRotate')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.axis_label_rotate =
                  typeof value === 'number' ? value : null)
            "
            @blur="() => dashboardPanelData.data.config.axis_label_rotate == null && (dashboardPanelDataModel.data.config.axis_label_rotate = 0)"
            data-test="dashboard-config-axis-label-rotate"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <div>
                    <span>{{ t("dashboard.axisLabelRotateTooltipText") }}</span>
                    <br /><br />
                    <b>{{ t("dashboard.axisLabelTooltipNotePrefix") }}</b>
                    <span>{{ t("dashboard.axisLabelTooltipNoteText") }}</span>
                  </div>
                </template>
              </OTooltip>
            </template>
          </OInput>
          <OInput
            class="flex-1 min-w-0"
            v-model.number="
              dashboardPanelDataModel.data.config.axis_label_truncate_width
            "
            type="number"
            placeholder="0"
            :label="t('dashboard.axisLabelTruncate')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.axis_label_truncate_width =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-axis-label-truncate"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <div>
                    <span>{{
                      t("dashboard.axisLabelTruncateTooltipText")
                    }}</span>
                    <br /><br />
                    <b>{{ t("dashboard.axisLabelTooltipNotePrefix") }}</b>
                    <span>{{ t("dashboard.axisLabelTooltipNoteText") }}</span>
                  </div>
                </template>
              </OTooltip>
            </template>
          </OInput>
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Line Style -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('lineStyle')"
      :model-value="isExpanded('lineStyle')"
      :icon="SECTION_ICONS.lineStyle"
      @update:modelValue="
        (v) => {
          expandedSections.lineStyle = v;
        }
      "
      :label="t('dashboard.configSectionLineStyle')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="o2-input flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSelect
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('lineStyle', 'symbol')"
          v-model="dashboardPanelDataModel.data.config.show_symbol"
          :options="showSymbol"
          :label="t('dashboard.showSymbol')"
          :valueKey="'value'"
          :labelKey="'label'"
          data-test="dashboard-config-show_symbol"
        />

        <OSelect
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('lineStyle', 'interpolation')"
          v-model="dashboardPanelDataModel.data.config.line_interpolation"
          :options="lineInterpolationOptions"
          :label="t('dashboard.lineInterpolation')"
          :valueKey="'value'"
          :labelKey="'label'"
          data-test="dashboard-config-line_interpolation"
        />

        <OInput
          v-if="shouldShowLineThickness(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('lineStyle', 'line-thickness')"
          v-model.number="dashboardPanelDataModel.data.config.line_thickness"
          type="number"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.line_thickness =
                typeof value == 'number' && value >= 0 ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.config.line_thickness == null)
                dashboardPanelDataModel.data.config.line_thickness = 1.5
            }
          "
          :label="t('dashboard.lineThickness')"
          :placeholder="t('dashboard.lineThicknessDefault')"
          data-test="dashboard-config-line_thickness"
        />
      </div>
    </OCollapsible>

    <!-- Section: Table -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="isSectionVisible('table')"
      :model-value="isExpanded('table')"
      :icon="SECTION_ICONS.table"
      @update:modelValue="
        (v) => {
          expandedSections.table = v;
        }
      "
      :label="t('dashboard.configSectionTable')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSwitch
          v-show="isConfigOptionVisible('table', 'wrap')"
          v-model="dashboardPanelDataModel.data.config.wrap_table_cells"
          :label="t('dashboard.wraptext')"
          data-test="dashboard-config-wrap-table-cells"
          size="lg"
        />

        <OSwitch
          v-if="!promqlMode"
          v-show="isConfigOptionVisible('table', 'transpose')"
          v-model="dashboardPanelDataModel.data.config.table_transpose"
          :label="t('dashboard.tableTranspose')"
          data-test="dashboard-config-table_transpose"
          :disabled="isPivotMode"
          size="lg"
        />

        <OSwitch
          v-if="!promqlMode"
          v-show="isConfigOptionVisible('table', 'dynamic-columns')"
          v-model="dashboardPanelDataModel.data.config.table_dynamic_columns"
          :label="t('dashboard.tableDynamicColumns')"
          data-test="dashboard-config-table_dynamic_columns"
          :disabled="isPivotMode"
          size="lg"
        />

        <OSwitch
          v-show="isConfigOptionVisible('table', 'filtering')"
          v-model="dashboardPanelDataModel.data.config.table_filtering"
          :label="t('dashboard.tableFiltering')"
          data-test="dashboard-config-table-filtering"
          size="lg"
        />

        <OSwitch
          v-show="isConfigOptionVisible('table', 'pagination')"
          v-model="dashboardPanelDataModel.data.config.table_pagination"
          :label="t('dashboard.pagination')"
          data-test="dashboard-config-show-pagination"
          size="lg"
        />

        <OInput
          v-if="dashboardPanelData.data.config.table_pagination"
          v-show="isConfigOptionVisible('table', 'rows-per-page')"
          v-model.number="
            dashboardPanelDataModel.data.config.table_pagination_rows_per_page
          "
          type="number"
          :placeholder="t('dashboard.auto')"
          :min="1"
          :label="t('dashboard.rowsPerPage')"
          data-test="dashboard-config-rows-per-page"
        >
          <template #tooltip>
            <OTooltip
              :content="t('dashboard.rowsPerPageTooltip')"
              max-width="250px"
            />
          </template>
        </OInput>
      </div>
    </OCollapsible>

    <!-- Section: Pivot Table -->
    <OCollapsible
      variant="config"
      v-show="isSectionVisible('pivotTable')"
      :model-value="isExpanded('pivotTable')"
      :icon="SECTION_ICONS.pivotTable"
      @update:modelValue="
        (v) => {
          expandedSections.pivotTable = v;
        }
      "
      :label="t('dashboard.configSectionPivotTable')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OSwitch
          v-if="!promqlMode && isPivotMode"
          v-show="isConfigOptionVisible('pivotTable', 'pivot-show-row-totals')"
          v-model="dashboardPanelDataModel.data.config.table_pivot_show_row_totals"
          data-test="dashboard-config-pivot-row-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotShowRowTotals") }}
            <OButton
              variant="ghost"
              size="icon"
              @click.stop
              icon-left="info-outline"
            >
              <OTooltip
                :content="t('dashboard.pivotShowRowTotalsTooltip')"
                max-width="250px"
              />
            </OButton>
          </template>
        </OSwitch>

        <OSwitch
          v-if="
            !promqlMode &&
            isPivotMode &&
            dashboardPanelData.data.config.table_pivot_show_row_totals
          "
          v-show="
            isConfigOptionVisible('pivotTable', 'pivot-sticky-col-totals')
          "
          v-model="dashboardPanelDataModel.data.config.table_pivot_sticky_col_totals"
          data-test="dashboard-config-pivot-sticky-col-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotStickyColTotals") }}
            <OButton
              variant="ghost"
              size="icon"
              @click.stop
              icon-left="info-outline"
            >
              <OTooltip
                :content="t('dashboard.pivotStickyColTotalsTooltip')"
                max-width="250px"
              />
            </OButton>
          </template>
        </OSwitch>

        <OSwitch
          v-if="!promqlMode && isPivotMode"
          v-show="isConfigOptionVisible('pivotTable', 'pivot-show-col-totals')"
          v-model="dashboardPanelDataModel.data.config.table_pivot_show_col_totals"
          data-test="dashboard-config-pivot-col-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotShowColTotals") }}
            <OButton
              variant="ghost"
              size="icon"
              @click.stop
              icon-left="info-outline"
            >
              <OTooltip
                :content="t('dashboard.pivotShowColTotalsTooltip')"
                max-width="250px"
              />
            </OButton>
          </template>
        </OSwitch>

        <OSwitch
          v-if="
            !promqlMode &&
            isPivotMode &&
            dashboardPanelData.data.config.table_pivot_show_col_totals
          "
          v-show="
            isConfigOptionVisible('pivotTable', 'pivot-sticky-row-totals')
          "
          v-model="dashboardPanelDataModel.data.config.table_pivot_sticky_row_totals"
          data-test="dashboard-config-pivot-sticky-row-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotStickyRowTotals") }}
            <OButton
              variant="ghost"
              size="icon"
              @click.stop
              icon-left="info-outline"
            >
              <OTooltip
                :content="t('dashboard.pivotStickyRowTotalsTooltip')"
                max-width="250px"
              />
            </OButton>
          </template>
        </OSwitch>
      </div>
    </OCollapsible>

    <!-- Section: Value Transformations -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="isSectionVisible('valueTransformations')"
      :model-value="isExpanded('valueTransformations')"
      :icon="SECTION_ICONS.valueTransformations"
      @update:modelValue="
        (v) => {
          expandedSections.valueTransformations = v;
        }
      "
      class="border-t border-solid border-card-glass-border"
    >
      <template #trigger>
        <span class="text-compact font-medium text-collapsible-label group-data-[state=open]:text-collapsible-icon-open">{{
          t("dashboard.configSectionValueTransformations")
        }}</span>
        <OIcon name="info-outline" size="sm" />
        <OTooltip
          :content="t('dashboard.configSectionValueTransformationsTooltip')"
          max-width="250px"
        />
      </template>
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <ValueMapping />
      </div>
    </OCollapsible>

    <!-- Section: Field Overrides -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'table'"
      v-show="isSectionVisible('fieldOverrides')"
      :model-value="isExpanded('fieldOverrides')"
      :icon="SECTION_ICONS.fieldOverrides"
      @update:modelValue="
        (v) => {
          expandedSections.fieldOverrides = v;
        }
      "
      class="border-t border-solid border-card-glass-border"
    >
      <template #trigger>
        <span class="text-compact font-medium text-collapsible-label group-data-[state=open]:text-collapsible-icon-open">{{
          t("dashboard.configSectionFieldOverrides")
        }}</span>
        <OIcon name="info-outline" size="sm" />
        <OTooltip
          :content="t('dashboard.configSectionFieldOverridesTooltip')"
          max-width="250px"
        />
      </template>
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OverrideConfig
          :dashboardPanelData="dashboardPanelData"
          :panelData="panelData"
        />
      </div>
    </OCollapsible>

    <!-- Section: Map -->
    <OCollapsible
      variant="config"
      v-if="
        dashboardPanelData.data.type == 'geomap' ||
        dashboardPanelData.data.type == 'maps'
      "
      v-show="isSectionVisible('map')"
      :model-value="isExpanded('map')"
      :icon="SECTION_ICONS.map"
      @update:modelValue="
        (v) => {
          expandedSections.map = v;
        }
      "
      :label="t('dashboard.configSectionMap')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="o2-input flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <div v-if="dashboardPanelData.data.type == 'maps'">
          <OSelect
            v-model="dashboardPanelDataModel.data.config.map_type.type"
            :options="mapTypeOptions"
            :valueKey="'value'"
            :labelKey="'label'"
            :label="t('dashboard.mapsMapType')"
            data-test="dashboard-config-map-type"
          >
            <template #tooltip>
              <OTooltip
                :content="t('dashboard.mapsMapTypeTooltip')"
                max-width="250px"
              />
            </template>
          </OSelect>
        </div>

        <OSelect
          v-if="dashboardPanelData.data.type == 'geomap'"
          v-model="dashboardPanelDataModel.data.config.base_map.type"
          :options="basemapTypeOptions"
          :valueKey="'value'"
          :labelKey="'label'"
          :label="t('dashboard.basemapLabel')"
          data-test="dashboard-config-basemap"
        />

        <div v-if="dashboardPanelData.data.type == 'geomap'" class="flex flex-col gap-y-3">
          <span>{{ t("dashboard.initialView") }}</span>
          <div class="flex gap-2">
            <OInput
              class="flex-1 min-w-0"
              v-model.number="dashboardPanelDataModel.data.config.map_view.lat"
              :label="t('dashboard.latitudeLabel')"
              type="number"
              @blur="
                handleBlur(dashboardPanelData.data.config.map_view, 0, 'lat')
              "
              data-test="dashboard-config-latitude"
            />
            <OInput
              class="flex-1 min-w-0"
              v-model.number="dashboardPanelDataModel.data.config.map_view.lng"
              :label="t('dashboard.longitudeLabel')"
              type="number"
              @blur="
                handleBlur(dashboardPanelData.data.config.map_view, 0, 'lng')
              "
              data-test="dashboard-config-longitude"
            />
          </div>
          <OInput
            v-model.number="dashboardPanelDataModel.data.config.map_view.zoom"
            :label="t('dashboard.zoomLabel')"
            type="number"
            @blur="
              handleBlur(dashboardPanelData.data.config.map_view, 1, 'zoom')
            "
            data-test="dashboard-config-zoom"
          />

          <OSelect
            v-model="dashboardPanelDataModel.data.config.map_symbol_style.size"
            :label="t('dashboard.symbolsize')"
            :options="symbolOptions"
            :valueKey="'value'"
            :labelKey="'label'"
            data-test="dashboard-config-symbol"
          />

          <div class="flex gap-2">
            <OInput
              class="flex-1 min-w-0"
              v-if="
                dashboardPanelData.data.config.map_symbol_style.size ===
                'by Value'
              "
              v-model.number="
                dashboardPanelDataModel.data.config.map_symbol_style.size_by_value
                  .min
              "
              :label="t('dashboard.minimum')"
              type="number"
              :min="0"
              @blur="
                handleBlur(
                  dashboardPanelData.data.config.map_symbol_style.size_by_value,
                  1,
                  'min',
                )
              "
              data-test="dashboard-config-map-symbol-min"
            />
            <OInput
              class="flex-1 min-w-0"
              v-if="
                dashboardPanelData.data.config.map_symbol_style.size ===
                'by Value'
              "
              v-model.number="
                dashboardPanelDataModel.data.config.map_symbol_style.size_by_value
                  .max
              "
              :label="t('dashboard.maximum')"
              type="number"
              :min="0"
              @blur="
                handleBlur(
                  dashboardPanelData.data.config.map_symbol_style.size_by_value,
                  100,
                  'max',
                )
              "
              data-test="dashboard-config-map-symbol-max"
            />
          </div>

          <OInput
            v-if="
              dashboardPanelData.data.config.map_symbol_style.size === 'fixed'
            "
            v-model.number="
              dashboardPanelDataModel.data.config.map_symbol_style.size_fixed
            "
            :label="t('dashboard.fixedValue')"
            type="number"
            @blur="
              handleBlur(
                dashboardPanelData.data.config.map_symbol_style,
                2,
                'size_fixed',
              )
            "
            data-test="dashboard-config-map-symbol-fixed"
          />

          <OSelect
            v-model="
              dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.layer_type
            "
            :options="layerTypeOptions"
            :label="t('dashboard.layerType')"
            :valueKey="'value'"
            :labelKey="'label'"
            data-test="dashboard-config-layer-type"
          />

          <OInput
            v-if="!isWeightFieldPresent"
            v-model.number="
              dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.weight_fixed
            "
            :label="t('common.weight')"
            type="number"
            @blur="
              handleBlur(
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config,
                1,
                'weight_fixed',
              )
            "
            data-test="dashboard-config-weight"
          />
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Gauge -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type === 'gauge'"
      v-show="isSectionVisible('gauge')"
      :model-value="isExpanded('gauge')"
      :icon="SECTION_ICONS.gauge"
      @update:modelValue="
        (v) => {
          expandedSections.gauge = v;
        }
      "
      :label="t('dashboard.configSectionGauge')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-min')"
          v-model.number="
            dashboardPanelDataModel.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.min
          "
          type="number"
          :label="t('dashboard.gaugeMinValue')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.min = typeof value === 'number' ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.min == null)
                dashboardPanelDataModel.data.queries[dashboardPanelDataModel.layout.currentQueryIndex].config.min = 0
            }
          "
          data-test="dashboard-config-gauge-min"
        />
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-max')"
          v-model.number="
            dashboardPanelDataModel.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].config.max
          "
          type="number"
          :label="t('dashboard.gaugeMaxValue')"
          placeholder="100"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.max = typeof value === 'number' ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config.max == null)
                dashboardPanelDataModel.data.queries[dashboardPanelDataModel.layout.currentQueryIndex].config.max = 100
            }
          "
          data-test="dashboard-config-gauge-max"
        />
      </div>
    </OCollapsible>

    <!-- Section: Layout -->
    <OCollapsible
      variant="config"
      v-if="showTrellisConfig"
      v-show="isSectionVisible('layout')"
      :model-value="isExpanded('layout')"
      :icon="SECTION_ICONS.layout"
      @update:modelValue="
        (v) => {
          expandedSections.layout = v;
        }
      "
      :label="t('dashboard.configSectionLayout')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <div v-show="isConfigOptionVisible('layout', 'trellis-layout')">
          <OSelect
            :label="t('dashboard.trellisLayout')"
            data-test="dashboard-trellis-chart"
            v-model="dashboardPanelDataModel.data.config.trellis.layout"
            :options="trellisOptions"
            :valueKey="'value'"
            :labelKey="'label'"
            :disabled="isBreakdownFieldEmpty || hasTimeShifts"
          >
            <template #tooltip>
              <OTooltip max-width="250px">
                <template #content>
                  <b>{{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip")
                  }}</b>
                </template>
              </OTooltip>
            </template>
          </OSelect>
        </div>

        <div
          v-if="dashboardPanelData.data.config.trellis?.layout === 'custom'"
          v-show="isConfigOptionVisible('layout', 'trellis-columns')"
        >
          <OInput
            v-model.number="
              dashboardPanelDataModel.data.config.trellis.num_of_columns
            "
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('dashboard.numOfColumns')"
            data-test="trellis-chart-num-of-columns"
            :disabled="isBreakdownFieldEmpty || hasTimeShifts"
            :min="1"
            :max="16"
            @update:model-value="
              (value: any) =>
                dashboardPanelData.data.config.trellis.num_of_columns > 16
                  ? (dashboardPanelDataModel.data.config.trellis.num_of_columns = 16)
                  : value
            "
          >
            <template #tooltip>
              <OTooltip max-width="250px">
                <template #content>
                  <b>{{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip")
                  }}</b>
                </template>
              </OTooltip>
            </template>
          </OInput>
        </div>

        <div
          v-if="
            dashboardPanelData.data.config.trellis?.layout &&
            !(isBreakdownFieldEmpty || hasTimeShifts)
          "
          v-show="isConfigOptionVisible('layout', 'trellis-group-by')"
          class="flex items-center"
        >
          <OSwitch
            v-model="dashboardPanelDataModel.data.config.trellis.group_by_y_axis"
            :label="t('dashboard.groupMultiYAxisTrellis')"
            data-test="dashboard-config-trellis-group-by-y-axis"
            size="lg"
          >
            <template #tooltip>
              <OTooltip>
                <template #content>
                  <div>
                    <b>{{
                      t("dashboard.groupMultiYAxisTrellisTooltipTitle")
                    }}</b>
                    <br /><br />
                    {{
                      t("dashboard.groupMultiYAxisTrellisTooltipDescription")
                    }}
                    <br /><br />
                    <b>{{
                      t("dashboard.groupMultiYAxisTrellisTooltipEnabled")
                    }}</b>
                    <br /><br />
                    <b>{{
                      t("dashboard.groupMultiYAxisTrellisTooltipDisabled")
                    }}</b>
                    <br /><br />
                    <i>{{
                      t("dashboard.groupMultiYAxisTrellisTooltipExample")
                    }}</i>
                    <br />
                    {{
                      t("dashboard.groupMultiYAxisTrellisTooltipEnabledResult")
                    }}
                    <br />
                    {{
                      t("dashboard.groupMultiYAxisTrellisTooltipDisabledResult")
                    }}
                  </div>
                </template>
              </OTooltip>
            </template>
          </OSwitch>
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Colors -->
    <OCollapsible
      variant="config"
      v-if="showColorPalette"
      v-show="isSectionVisible('colors')"
      :model-value="isExpanded('colors')"
      :icon="SECTION_ICONS.colors"
      @update:modelValue="
        (v) => {
          expandedSections.colors = v;
        }
      "
      :label="t('dashboard.configSectionColors')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <ColorPaletteDropDown />
        <ColorBySeries :colorBySeriesData="panelData" />
      </div>
    </OCollapsible>

    <!-- Section: Drilldown -->
    <OCollapsible
      variant="config"
      v-if="shouldShowDrilldown(dashboardPanelData, dashboardPanelDataPageKey)"
      v-show="isSectionVisible('drilldown')"
      :model-value="isExpanded('drilldown')"
      :icon="SECTION_ICONS.drilldown"
      @update:modelValue="
        (v) => {
          expandedSections.drilldown = v;
        }
      "
      class="border-t border-solid border-card-glass-border"
    >
      <template #trigger>
        <span class="text-compact font-medium text-collapsible-label group-data-[state=open]:text-collapsible-icon-open">{{
          t("dashboard.drilldown")
        }}</span>
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-drilldown-info"
        />
        <OTooltip
          :content="t('dashboard.drilldownTooltip')"
          max-width="250px"
        />
      </template>
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <Drilldown :variablesData="variablesData" />
      </div>
    </OCollapsible>

    <!-- Section: Comparison -->
    <OCollapsible
      variant="config"
      v-if="
        shouldShowTimeShift(
          dashboardPanelData,
          promqlMode,
          dashboardPanelDataPageKey,
        )
      "
      v-show="isSectionVisible('comparison')"
      :model-value="isExpanded('comparison')"
      :icon="SECTION_ICONS.comparison"
      @update:modelValue="
        (v) => {
          expandedSections.comparison = v;
        }
      "
      class="border-t border-solid border-card-glass-border"
    >
      <template #trigger>
        <span class="text-compact font-medium text-collapsible-label group-data-[state=open]:text-collapsible-icon-open">{{
          t("dashboard.comparisonAgainst")
        }}</span>
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-time-shift-info"
        />
        <OTooltip
          :content="t('dashboard.comparisonAgainstTooltip')"
          max-width="250px"
        />
      </template>
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
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
            <OIcon
              class="mr-1 ml-2 cursor-pointer"
              size="sm"
              name="close"
              @click="removeTimeShift(index)"
              :data-test="`dashboard-addpanel-config-time-shift-remove-${index}`"
            />
          </div>
        </div>
        <div class="self-start">
          <OButton
            variant="outline"
            size="sm"
            @click="addTimeShift"
            data-test="dashboard-addpanel-config-time-shift-add-btn"
          >{{ t("dashboard.addButton") }}</OButton
          >
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Mark Lines -->
    <OCollapsible
      variant="config"
      v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
      v-show="isSectionVisible('markLines')"
      :model-value="isExpanded('markLines')"
      :icon="SECTION_ICONS.markLines"
      @update:modelValue="
        (v) => {
          expandedSections.markLines = v;
        }
      "
      class="border-t border-solid border-card-glass-border"
    >
      <template #trigger>
        <span class="text-compact font-medium text-collapsible-label group-data-[state=open]:text-collapsible-icon-open">{{
          t("dashboard.markLines")
        }}</span>
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-markline-info"
        />
        <OTooltip
          :content="t('dashboard.markLinesTooltip')"
          max-width="250px"
        />
      </template>
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <MarkLineConfig />
      </div>
    </OCollapsible>

    <!-- Section: Background -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'metric'"
      v-show="isSectionVisible('background')"
      :model-value="isExpanded('background')"
      :icon="SECTION_ICONS.background"
      @update:modelValue="
        (v) => {
          expandedSections.background = v;
        }
      "
      :label="t('dashboard.configSectionBackground')"
      class="border-t border-solid border-card-glass-border"
    >
      <div class="flex flex-col gap-2.5 px-3 py-2.5 overflow-x-hidden box-border">
        <BackGroundColorConfig />
      </div>
    </OCollapsible>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { type SwitchValue } from "@/lib/forms/Switch/OSwitch.types";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import {
  computed,
  defineComponent,
  inject,
  nextTick,
  onBeforeMount,
  onMounted,
  ref,
} from "vue";
import { useI18n } from "vue-i18n";
import Drilldown from "./Drilldown.vue";
import ValueMapping from "./ValueMapping.vue";
import ColorBySeries from "./ColorBySeries.vue";
import MarkLineConfig from "./MarkLineConfig.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import ColorPaletteDropDown from "./ColorPaletteDropDown.vue";
import BackGroundColorConfig from "./BackGroundColorConfig.vue";
import OverrideConfig from "./OverrideConfig.vue";
import ConfigPanelSearch from "./ConfigPanelSearch.vue";
import { useConfigPanel } from "../../../composables/dashboard/useConfigPanel";
import LinearIcon from "@/components/icons/dashboards/LinearIcon.vue";
import NoSymbol from "@/components/icons/dashboards/NoSymbol.vue";
import Smooth from "@/components/icons/dashboards/Smooth.vue";
import StepBefore from "@/components/icons/dashboards/StepBefore.vue";
import StepAfter from "@/components/icons/dashboards/StepAfter.vue";
import StepMiddle from "@/components/icons/dashboards/StepMiddle.vue";
import PromQLChartConfig from "./PromQLChartConfig.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
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
import { SECTION_ICONS } from "@/utils/dashboard/searchLabelsConfig";

export default defineComponent({
  components: {
    OTabs,
    OTab,
    OInput,
    OTextarea,
    OSelect,
    OToggleGroup,
    OToggleGroupItem,
    OSwitch,
    ConfigPanelSearch,
    Drilldown,
    ValueMapping,
    ColorBySeries,
    OCombobox,
    MarkLineConfig,
    CustomDateTimePicker,
    DateTimePickerDashboard,
    ColorPaletteDropDown,
    BackGroundColorConfig,
    OverrideConfig,
    PromQLChartConfig,
    OButton,
    OTooltip,
    OIcon,
    OCollapsible,
  },
  props: ["dashboardPanelData", "variablesData", "panelData"],
  setup(props) {
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData, promqlMode, isPivotMode } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    // Alias for template v-model mutation sites; same reference, no behavior change.
    const dashboardPanelDataModel = computed(() => dashboardPanelData);

    // Segmented toggle (OToggleGroup) proxies for few-option config selects.
    // OToggleGroup drops null/empty values (its single-select deselect guard),
    // so we bridge the stored `null` ("Auto"/"None") to a sentinel string and
    // back. Options iterate the same arrays used by the old OSelect.
    const TOGGLE_AUTO = "__auto__";
    const toggleModel = (key: string) =>
      computed({
        get: () =>
          (dashboardPanelData.data.config as Record<string, unknown>)[key] ??
          TOGGLE_AUTO,
        set: (v: unknown) => {
          (dashboardPanelData.data.config as Record<string, unknown>)[key] =
            v === TOGGLE_AUTO ? null : v;
        },
      });
    const legendsPositionModel = toggleModel("legends_position");
    const legendsTypeModel = toggleModel("legends_type");
    const chartAlignModel = toggleModel("chart_align");
    const toggleItemValue = (value: unknown) =>
      value === null || value === undefined ? TOGGLE_AUTO : value;

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
      // Normalize config fields that default to null but may arrive as undefined
      // when loaded from older panels (backend omits null fields in JSON response).
      const nullableConfigKeys = [
        "legends_position",
        "legends_type",
        "chart_align",
        "unit",
        "unit_custom",
      ] as const;
      nullableConfigKeys.forEach((key) => {
        if (dashboardPanelData.data.config[key] === undefined) {
          dashboardPanelData.data.config[key] = null;
        }
      });
      if (dashboardPanelData.data.config.label_option?.position === undefined) {
        if (dashboardPanelData.data.config.label_option) {
          dashboardPanelData.data.config.label_option.position = null;
        }
      }

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

      // by default, tableFiltering is disabled
      if (!dashboardPanelData.data.config.table_filtering) {
        dashboardPanelData.data.config.table_filtering = false;
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
    // Single source of truth — shared with the column-formatting dialog.
    const unitOptions = getUnitOptions(t);

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

      const fieldName = (option as any)?.value ?? option;
      if (openingBraceIndex === -1) {
        const newValue =
          "{" + inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
        return newValue;
      } else {
        const newValue =
          inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
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

    // Trellis requires EVERY query to have a breakdown field, so treat the
    // breakdown as "empty" (disabling the trellis options) when ANY query is
    // missing one — not just the currently selected query tab.
    const isBreakdownFieldEmpty = computed(() => {
      const queries = dashboardPanelData.data.queries || [];
      return (
        queries.length === 0 ||
        queries.some((q: any) => (q?.fields?.breakdown?.length ?? 0) === 0)
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
    const panelTimePickerRef = ref<{
      dateTimePicker?: { getDisplayValue: string };
    } | null>(null);

    // Format picker value for tooltip display using the DateTime component's display value
    const formattedPickerValue = computed(() => {
      if (!panelTimePickerRef.value?.dateTimePicker?.getDisplayValue) {
        return "";
      }
      return panelTimePickerRef.value.dateTimePicker.getDisplayValue;
    });

    // Toggle on/off
    const onToggleDefaultTime = (value: SwitchValue) => {
      const enabled = value as boolean;
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
    // initialize pivot config values (undefined ? false defaults).
    // Without this, the toggle shows undefined as OFF but conversion
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

    // Focus the search box when the config panel opens so users can start
    // filtering settings right away.
    onMounted(() => {
      nextTick(() => {
        const searchInput = document.getElementById(
          "dashboard-config-panel-search-input",
        ) as HTMLInputElement | null;
        searchInput?.focus();
      });
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

    const decimalsTouched = ref(false);

    return {
      legendsPositionModel,
      legendsTypeModel,
      chartAlignModel,
      toggleItemValue,
      t,
      dashboardPanelData,
      dashboardPanelDataModel,
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
      decimalsTouched,
      SECTION_ICONS,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:DateTimePicker): truncate the picker label and size the arrow
   inside the date-time button — targets the picker's internal DOM via :deep(). */
.panel-time-picker-btn :deep(.date-time-button .date-time-label) {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-time-picker-btn :deep(.date-time-button .date-time-arrow) {
  flex-shrink: 0;
  font-size: var(--text-lg) !important;
}
</style>
