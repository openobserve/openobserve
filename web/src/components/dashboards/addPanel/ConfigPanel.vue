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
    <div class="mx-3 max-w-75">
      <div class="text-compact text-input-label-text mb-1.5 font-medium">
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
      class="bg-card-glass-solid sticky top-0 z-30 flex h-11 items-center gap-1 px-2"
      data-test="dashboard-config-search-wrapper"
    >
      <ConfigPanelSearch v-model="searchQuery" class="min-w-0 flex-1" />
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
        <template #icon-left
          ><OIcon :name="allSectionsExpanded ? 'unfold-less' : 'unfold-more'" size="sm"
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
      <OIcon name="search-off" size="md" class="text-icon-color mb-1" />
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <div v-show="isConfigOptionVisible('general', 'description')" class="max-w-75">
          <div class="text-compact text-input-label-text mb-1.5 font-medium">
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
          :placeholder="
            t('dashboard.intervalInputPlaceholder', {
              example: raw('30s, 1m, 5m, 1h'),
            })
          "
          data-test="dashboard-config-step-value"
        >
          <template #tooltip>
            <OTooltip max-width="15.625rem">
              <template #content>
                <b>{{ t("dashboard.stepPrefix") }}</b>
                {{ t("dashboard.stepValueTooltip") }}
                <br />
                {{ t("dashboard.stepValueExample", { example: raw("10s, 1h") }) }}
              </template>
            </OTooltip>
          </template>
        </OInput>

        <OSwitch
          v-if="promqlMode && exemplarsSwitchEligible"
          v-show="isConfigOptionVisible('general', 'show-exemplars')"
          v-model="dashboardPanelDataModel.data.config.show_exemplars"
          :label="t('dashboard.showExemplarsLabel')"
          data-test="dashboard-config-show-exemplars"
          size="lg"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.showExemplarsHelp')" max-width="15.625rem" />
          </template>
        </OSwitch>

        <!-- Panel Default Time Configuration -->
        <div v-show="isConfigOptionVisible('general', 'panel-default-time')">
          <div class="flex items-center">
            <OSwitch
              v-model="useDefaultTime"
              :label="t('dashboard.panelTimeEnabled')"
              data-test="dashboard-config-allow-panel-time"
              size="lg"
              @change="onToggleDefaultTime"
            />
            <OButton variant="ghost" size="icon" class="mt-1" @click.stop icon-left="info-outline">
              <OTooltip :content="t('dashboard.useDefaultTimeTooltip')" max-width="15.625rem" />
            </OButton>
          </div>

          <div v-if="useDefaultTime" class="mt-2">
            <div class="text-compact text-input-label-text mb-1.5 font-medium">
              {{ t("dashboard.defaultDuration") }}
            </div>
            <div
              v-if="showTimePicker || (panelTimeRange !== null && panelTimeRange !== undefined)"
              class="flex flex-nowrap items-center overflow-visible"
            >
              <div class="panel-time-picker-btn min-w-0 flex-[1_1_0] overflow-visible">
                <DateTimePickerDashboard
                  ref="panelTimePickerRef"
                  v-model="pickerValue"
                  :auto-apply-dashboard="true"
                  :hide-relative-timezone="true"
                  :hide-range-shift="true"
                  menu-align="end"
                  data-test="dashboard-config-panel-time-picker"
                  class="w-fit max-w-full min-w-0 overflow-hidden"
                />
                <OTooltip :content="raw(formattedPickerValue)" max-width="20rem" />
              </div>
              <OIcon
                class="ms-2 me-1 flex-shrink-0 shrink-0 cursor-pointer"
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
        (dashboardPanelData.data.type === 'geomap' || dashboardPanelData.data.type === 'maps')
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
          :data-test-selected-value="String(dashboardPanelDataModel.data.config.legends_position)"
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
          :data-test-selected-value="String(dashboardPanelDataModel.data.config.legends_type)"
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

        <div class="flex flex-wrap gap-2" v-show="isConfigOptionVisible('legend', 'legend-size')">
          <!-- Legend Width + unit selector -->
          <div
            v-if="shouldShowLegendWidth(dashboardPanelData)"
            class="flex w-full min-w-0 items-end justify-between gap-1.5"
          >
            <OInput
              v-model.number="legendWidthValue"
              :label="t('common.legendWidth')"
              type="number"
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-width"
              class="min-w-0 flex-1"
            />
            <div
              class="mt-2.25 flex shrink-0 items-center gap-1"
              v-if="shouldShowLegendWidthUnitContainer(dashboardPanelData)"
            >
              <OButton
                @click="setUnit('px')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config.legend_width?.unit === null ||
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
                :active="dashboardPanelData?.data?.config?.legend_width?.unit === '%'"
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
            class="flex w-full min-w-0 items-end justify-between gap-1.5"
          >
            <OInput
              v-model.number="legendHeightValue"
              :label="t('dashboard.legendHeight')"
              type="number"
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-legend-height"
              class="min-w-0 flex-1"
            />
            <div
              class="mt-2.25 flex shrink-0 items-center gap-1"
              v-if="shouldShowLegendHeightUnitContainer(dashboardPanelData)"
            >
              <OButton
                @click="setHeightUnit('px')"
                variant="outline"
                :active="
                  dashboardPanelData?.data?.config.legend_height?.unit === null ||
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
                :active="dashboardPanelData?.data?.config?.legend_height?.unit === '%'"
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
          :data-test-selected-value="String(dashboardPanelDataModel.data.config.chart_align)"
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

        <OToggleGroup
          v-if="shouldShowCartesianSeriesConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'chart-tooltip-mode')"
          type="single"
          label-position="top"
          :label="t('dashboard.chartTooltipMode')"
          v-model="chartTooltipModeModel"
          data-test="dashboard-config-tooltip_mode"
          :data-test-selected-value="chartTooltipModeModel"
        >
          <OToggleGroupItem
            v-for="opt in chartTooltipModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-tooltip_mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-if="shouldShowCartesianSeriesConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('legend', 'tooltip-sort')"
          type="single"
          label-position="top"
          :label="t('dashboard.tooltipSort')"
          v-model="tooltipSortModel"
          data-test="dashboard-config-tooltip_sort"
          :data-test-selected-value="tooltipSortModel"
        >
          <OToggleGroupItem
            v-for="opt in tooltipSortOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-tooltip_sort-option"
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
              :label="t('common.queryNumber', { index: Number(index) + 1 })"
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
            dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex].config
              .promql_legend
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
                  class="ms-1"
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OSelect
          v-show="isConfigOptionVisible('data', 'unit')"
          v-model="dashboardPanelDataModel.data.config.unit"
          :options="unitOptions"
          :label="t('dashboard.unitLabel')"
          :valueKey="'value'"
          :labelKey="'label'"
          searchable
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
          :error="
            decimalsTouched &&
            typeof dashboardPanelData.data.config.decimals === 'number' &&
            (dashboardPanelData.data.config.decimals < 0 ||
              dashboardPanelData.data.config.decimals > 100)
          "
          :error-message="t('dashboard.decimalsMustBeBetween')"
          :label="t('dashboard.decimals')"
          data-test="dashboard-config-decimals"
        />

        <div
          class="flex gap-2"
          v-if="dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-color-range')"
        >
          <OInput
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.heatmap_color_min"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('dashboard.heatmapColorMin')"
            :error="isHeatmapColorRangeInvalid"
            @update:model-value="
              (value: string | number) =>
                (dashboardPanelDataModel.data.config.heatmap_color_min =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-heatmap_color_min"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <b>{{ t("dashboard.heatmapColorMinTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.heatmapColorMinTooltipDescription") }}
                </template>
              </OTooltip>
            </template>
          </OInput>
          <OInput
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.heatmap_color_max"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('dashboard.heatmapColorMax')"
            :error="isHeatmapColorRangeInvalid"
            :error-message="t('dashboard.heatmapColorRangeInvalid')"
            @update:model-value="
              (value: string | number) =>
                (dashboardPanelDataModel.data.config.heatmap_color_max =
                  value !== '' ? value : null)
            "
            data-test="dashboard-config-heatmap_color_max"
          >
            <template #tooltip>
              <OTooltip :side-offset="8">
                <template #content>
                  <b>{{ t("dashboard.heatmapColorMaxTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.heatmapColorMaxTooltipDescription") }}
                </template>
              </OTooltip>
            </template>
          </OInput>
        </div>

        <OSelect
          v-if="dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-palette')"
          v-model="heatmapPaletteModel"
          :options="heatmapPaletteOptions"
          :label="t('dashboard.heatmapPalette')"
          :valueKey="'value'"
          :labelKey="'label'"
          data-test="dashboard-config-heatmap_palette"
        />

        <OSwitch
          v-if="dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-palette-reverse')"
          v-model="dashboardPanelDataModel.data.config.heatmap_palette_reverse"
          :label="t('dashboard.heatmapPaletteReverse')"
          data-test="dashboard-config-heatmap_palette_reverse"
          size="lg"
        />

        <OToggleGroup
          v-if="dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-color-scale')"
          type="single"
          label-position="top"
          :label="t('dashboard.heatmapColorScale')"
          v-model="heatmapColorScaleModel"
          data-test="dashboard-config-heatmap_color_scale"
          :data-test-selected-value="heatmapColorScaleModel"
        >
          <OToggleGroupItem
            v-for="opt in heatmapColorScaleOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-heatmap_color_scale-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <div
          v-if="dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-cells')"
          class="flex gap-2"
        >
          <OInput
            class="min-w-0 flex-1"
            :model-value="dashboardPanelData.data.config.heatmap_cell_gap ?? null"
            type="number"
            :min="0"
            :label="t('dashboard.heatmapCellGap')"
            :placeholder="t('dashboard.heatmapCellGapPlaceholder')"
            data-test="dashboard-config-heatmap_cell_gap"
            @update:model-value="(value: any) => setNumberConfig('heatmap_cell_gap', value)"
          />
          <OInput
            class="min-w-0 flex-1"
            :model-value="dashboardPanelData.data.config.heatmap_hide_below ?? null"
            type="number"
            :label="t('dashboard.heatmapHideBelow')"
            :placeholder="t('dashboard.sortNone')"
            data-test="dashboard-config-heatmap_hide_below"
            @update:model-value="(value: any) => setNumberConfig('heatmap_hide_below', value)"
          >
            <template #tooltip>
              <OTooltip :content="t('dashboard.heatmapHideBelowTooltip')" max-width="15.625rem" />
            </template>
          </OInput>
        </div>

        <div
          v-if="dashboardPanelData.data.type === 'distribution'"
          v-show="isConfigOptionVisible('data', 'distribution-buckets')"
          class="flex flex-col gap-2.5"
        >
          <div class="flex gap-2">
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.distribution_bucket_count ?? null"
              type="number"
              :min="1"
              :label="t('dashboard.distributionBucketCount')"
              :placeholder="t('dashboard.distributionBucketCountPlaceholder')"
              :disabled="dashboardPanelData.data.config.distribution_bucket_size != null"
              data-test="dashboard-config-distribution_bucket_count"
              @update:model-value="
                (value: any) => setNumberConfig('distribution_bucket_count', value)
              "
            />
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.distribution_bucket_size ?? null"
              type="number"
              :min="0"
              :label="t('dashboard.distributionBucketSize')"
              :placeholder="t('dashboard.auto')"
              data-test="dashboard-config-distribution_bucket_size"
              @update:model-value="
                (value: any) => setNumberConfig('distribution_bucket_size', value)
              "
            >
              <template #tooltip>
                <OTooltip
                  :content="t('dashboard.distributionBucketSizeTooltip')"
                  max-width="15.625rem"
                />
              </template>
            </OInput>
          </div>
          <OInput
            :model-value="dashboardPanelData.data.config.distribution_bucket_offset ?? null"
            type="number"
            :label="t('dashboard.distributionBucketOffset')"
            :placeholder="t('dashboard.zeroPlaceholder')"
            data-test="dashboard-config-distribution_bucket_offset"
            @update:model-value="
              (value: any) => setNumberConfig('distribution_bucket_offset', value)
            "
          >
            <template #tooltip>
              <OTooltip
                :content="t('dashboard.distributionBucketOffsetTooltip')"
                max-width="15.625rem"
              />
            </template>
          </OInput>
        </div>

        <OSwitch
          v-if="dashboardPanelData.data.type === 'treemap'"
          v-show="isConfigOptionVisible('data', 'treemap-breadcrumb')"
          :model-value="dashboardPanelData.data.config.treemap_show_breadcrumb !== false"
          :label="t('dashboard.treemapShowBreadcrumb')"
          data-test="dashboard-config-treemap_show_breadcrumb"
          size="lg"
          @update:model-value="(value: any) => setDefaultOnFlag('treemap_show_breadcrumb', value)"
        />

        <OSwitch
          v-if="dashboardPanelData.data.type === 'sunburst'"
          v-show="isConfigOptionVisible('data', 'sunburst-labels')"
          :model-value="dashboardPanelData.data.config.sunburst_show_labels !== false"
          :label="t('dashboard.sunburstShowLabels')"
          data-test="dashboard-config-sunburst_show_labels"
          size="lg"
          @update:model-value="(value: any) => setDefaultOnFlag('sunburst_show_labels', value)"
        />

        <template v-if="dashboardPanelData.data.type === 'funnel'">
          <OToggleGroup
            v-show="isConfigOptionVisible('data', 'funnel-sort')"
            type="single"
            label-position="top"
            :label="t('dashboard.funnelSort')"
            v-model="funnelSortModel"
            data-test="dashboard-config-funnel_sort"
            :data-test-selected-value="funnelSortModel"
          >
            <OToggleGroupItem
              v-for="opt in funnelSortOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              data-test="dashboard-config-funnel_sort-option"
              :data-test-label="opt.label"
              >{{ opt.label }}</OToggleGroupItem
            >
          </OToggleGroup>
          <OToggleGroup
            v-show="isConfigOptionVisible('data', 'funnel-orient')"
            type="single"
            label-position="top"
            :label="t('dashboard.barGaugeOrientation')"
            v-model="funnelOrientModel"
            data-test="dashboard-config-funnel_orient"
            :data-test-selected-value="funnelOrientModel"
          >
            <OToggleGroupItem
              v-for="opt in funnelOrientOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              data-test="dashboard-config-funnel_orient-option"
              :data-test-label="opt.label"
              >{{ opt.label }}</OToggleGroupItem
            >
          </OToggleGroup>
          <OSwitch
            v-show="isConfigOptionVisible('data', 'funnel-show-percent')"
            :model-value="dashboardPanelData.data.config.funnel_show_percent === true"
            :label="t('dashboard.funnelShowPercent')"
            data-test="dashboard-config-funnel_show_percent"
            size="lg"
            @update:model-value="(value: any) => setFlagConfig('funnel_show_percent', value)"
          >
            <template #tooltip>
              <OTooltip :content="t('dashboard.funnelShowPercentTooltip')" max-width="15.625rem" />
            </template>
          </OSwitch>
        </template>

        <template v-if="dashboardPanelData.data.type === 'boxplot'">
          <OToggleGroup
            v-show="isConfigOptionVisible('data', 'boxplot-whisker')"
            type="single"
            label-position="top"
            :label="t('dashboard.boxplotWhisker')"
            v-model="boxplotWhiskerModel"
            data-test="dashboard-config-boxplot_whisker"
            :data-test-selected-value="boxplotWhiskerModel"
          >
            <OToggleGroupItem
              v-for="opt in boxplotWhiskerOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              data-test="dashboard-config-boxplot_whisker-option"
              :data-test-label="opt.label"
              >{{ opt.label }}</OToggleGroupItem
            >
          </OToggleGroup>
        </template>

        <template v-if="dashboardPanelData.data.type === 'node-graph'">
          <OToggleGroup
            v-show="isConfigOptionVisible('data', 'node-graph-layout')"
            type="single"
            label-position="top"
            :label="t('dashboard.nodeGraphLayout')"
            v-model="nodeGraphLayoutModel"
            data-test="dashboard-config-node_graph_layout"
            :data-test-selected-value="nodeGraphLayoutModel"
          >
            <OToggleGroupItem
              v-for="opt in nodeGraphLayoutOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              data-test="dashboard-config-node_graph_layout-option"
              :data-test-label="opt.label"
              >{{ opt.label }}</OToggleGroupItem
            >
          </OToggleGroup>
          <OSwitch
            v-show="isConfigOptionVisible('data', 'node-graph-edge-labels')"
            :model-value="dashboardPanelData.data.config.node_graph_show_edge_labels === true"
            :label="t('dashboard.nodeGraphShowEdgeLabels')"
            data-test="dashboard-config-node_graph_show_edge_labels"
            size="lg"
            @update:model-value="
              (value: any) => setFlagConfig('node_graph_show_edge_labels', value)
            "
          />
        </template>

        <OSwitch
          v-if="promqlMode && dashboardPanelData.data.type === 'heatmap'"
          v-show="isConfigOptionVisible('data', 'heatmap-histogram-mode')"
          v-model="heatmapHistogramModeModel"
          :label="t('dashboard.heatmapHistogramMode')"
          data-test="dashboard-config-heatmap_mode"
          size="lg"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.heatmapHistogramModeTooltip')" max-width="15.625rem" />
          </template>
        </OSwitch>

        <OSelect
          v-if="
            promqlMode && dashboardPanelData.data.type === 'heatmap' && heatmapHistogramModeModel
          "
          v-show="isConfigOptionVisible('data', 'bucket-unit')"
          v-model="dashboardPanelDataModel.data.config.bucket_unit"
          :options="bucketUnitOptions"
          :label="t('dashboard.bucketUnit')"
          :valueKey="'value'"
          :labelKey="'label'"
          searchable
          data-test="dashboard-config-bucket_unit"
        />

        <OInput
          v-if="
            promqlMode &&
            dashboardPanelData.data.type === 'heatmap' &&
            heatmapHistogramModeModel &&
            dashboardPanelData.data.config.bucket_unit === 'custom'
          "
          v-show="isConfigOptionVisible('data', 'bucket-unit-custom')"
          v-model="dashboardPanelDataModel.data.config.bucket_unit_custom"
          :label="t('dashboard.bucketUnitCustom')"
          data-test="dashboard-config-bucket_unit_custom"
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
              :label="
                tab.tabName
                  ? raw(tab.tabName)
                  : t('common.queryNumber', { index: Number(index) + 1 })
              "
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
          <div
            class="text-compact text-input-label-text mb-1.5 flex items-center gap-1 font-medium"
          >
            {{ t("dashboard.multiSqlQueryLabel") }}
            <OIcon name="info-outline" size="sm" />
            <OTooltip
              side="top"
              align="center"
              max-width="15.625rem"
              :content="t('dashboard.multiSqlQueryLabelHint')"
            />
          </div>
          <OInput
            :placeholder="raw('{field_name}')"
            v-model="
              dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex]
                .config.query_label
            "
            size="sm"
            class="w-full"
            :data-test="`dashboard-config-legend-${dashboardPanelData.layout.currentQueryIndex}`"
            @focus="
              () => {
                const q =
                  dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
                if (!q.config.query_label) q.config.query_label = '{field_name}';
              }
            "
          />
        </div>

        <OInput
          v-if="
            !promqlMode &&
            !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]
              .customQuery
          "
          v-show="isConfigOptionVisible('data', 'limit')"
          v-model.number="
            dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex].config
              .limit
          "
          type="number"
          :min="0"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.limit = typeof value === 'number' ? value : null)
          "
          @blur="
            () =>
              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
                .limit == null &&
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.limit = 0)
          "
          :placeholder="t('dashboard.zeroPlaceholder')"
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
            (value: any) => (dashboardPanelDataModel.data.config.top_results = value ? value : null)
          "
          :placeholder="t('dashboard.placeholderAll')"
          :disabled="
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.fields
              ?.breakdown?.length == 0
          "
          :label="t('dashboard.showTopNValues')"
          data-test="dashboard-config-top_results"
        >
          <template #tooltip>
            <OTooltip max-width="15.625rem">
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
            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields
              ?.breakdown?.length == 0
          "
          size="lg"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.addOthersSeriesTooltip')" max-width="15.625rem" />
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
            <OTooltip :content="t('dashboard.connectNullValuesTooltip')" max-width="15.625rem" />
          </template>
        </OSwitch>

        <OInput
          v-if="shouldShowConnectNullsThreshold(dashboardPanelData)"
          v-show="isConfigOptionVisible('data', 'connect-nulls-threshold')"
          :model-value="dashboardPanelData.data.config.connect_nulls_threshold ?? null"
          type="number"
          :min="0"
          :label="t('dashboard.connectNullsThreshold')"
          :placeholder="t('dashboard.connectNullsThresholdPlaceholder')"
          data-test="dashboard-config-connect_nulls_threshold"
          @update:model-value="(value: any) => setNumberConfig('connect_nulls_threshold', value)"
        >
          <template #tooltip>
            <OTooltip
              :content="t('dashboard.connectNullsThresholdTooltip')"
              max-width="15.625rem"
            />
          </template>
        </OInput>

        <template v-if="shouldShowScatterEncoding(dashboardPanelData, promqlMode)">
          <div v-show="isConfigOptionVisible('data', 'scatter-encoding')" class="flex gap-2">
            <OSelect
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.scatter_size_field ?? null"
              :options="scatterFieldOptions"
              :label="t('dashboard.scatterSizeField')"
              data-test="dashboard-config-scatter_size_field"
              @update:model-value="(value: any) => setTextConfig('scatter_size_field', value)"
            />
            <OSelect
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.scatter_color_field ?? null"
              :options="scatterFieldOptions"
              :label="t('dashboard.scatterColorField')"
              data-test="dashboard-config-scatter_color_field"
              @update:model-value="(value: any) => setTextConfig('scatter_color_field', value)"
            />
          </div>
          <div
            v-if="dashboardPanelData.data.config.scatter_size_field"
            v-show="isConfigOptionVisible('data', 'scatter-encoding')"
            class="flex gap-2"
          >
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.scatter_size_min ?? null"
              type="number"
              :min="1"
              :label="t('dashboard.scatterSizeMin')"
              :placeholder="raw('4')"
              data-test="dashboard-config-scatter_size_min"
              @update:model-value="(value: any) => setNumberConfig('scatter_size_min', value)"
            />
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.scatter_size_max ?? null"
              type="number"
              :min="1"
              :label="t('dashboard.scatterSizeMax')"
              :placeholder="raw('24')"
              data-test="dashboard-config-scatter_size_max"
              @update:model-value="(value: any) => setNumberConfig('scatter_size_max', value)"
            />
          </div>
        </template>

        <OInput
          v-if="shouldShowNoValueReplacement(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('data', 'no-value-replacement')"
          v-model="dashboardPanelDataModel.data.config.no_value_replacement"
          :placeholder="raw('-')"
          :label="t('dashboard.noValueReplacement')"
          data-test="dashboard-config-no-value-replacement"
        >
          <template #tooltip>
            <OTooltip
              :content="
                ['metric', 'gauge', 'bar-gauge', 'table'].includes(dashboardPanelData.data.type)
                  ? t('dashboard.noValueReplacementTooltipValue')
                  : t('dashboard.noValueReplacementTooltip')
              "
            />
          </template>
        </OInput>
      </div>
    </OCollapsible>

    <!-- Section: State timeline -->
    <OCollapsible
      variant="config"
      v-if="isRowTimeline(dashboardPanelData.data.type)"
      v-show="isSectionVisible('stateTimeline')"
      :model-value="isExpanded('stateTimeline')"
      :icon="SECTION_ICONS.stateTimeline"
      @update:modelValue="
        (v) => {
          expandedSections.stateTimeline = v;
        }
      "
      :label="
        dashboardPanelData.data.type === 'status-history'
          ? t('dashboard.configSectionStatusHistory')
          : t('dashboard.configSectionStateTimeline')
      "
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OInput
          v-show="isConfigOptionVisible('stateTimeline', 'merge-gaps')"
          v-model.number="dashboardPanelDataModel.data.config.merge_gaps"
          type="number"
          :min="0"
          :label="t('dashboard.stateTimelineMergeGaps')"
          :placeholder="t('dashboard.auto')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.merge_gaps =
                typeof value === 'number' ? value : null)
          "
          data-test="dashboard-config-state-timeline-merge-gaps"
        >
          <template #tooltip>
            <OTooltip
              :content="t('dashboard.stateTimelineMergeGapsTooltip')"
              max-width="15.625rem"
            />
          </template>
        </OInput>

        <div class="flex gap-2" v-show="isConfigOptionVisible('stateTimeline', 'row-size')">
          <OInput
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.row_height"
            type="number"
            :min="1"
            :label="t('dashboard.stateTimelineRowHeight')"
            :placeholder="t('dashboard.auto')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.row_height =
                  typeof value === 'number' ? value : null)
            "
            data-test="dashboard-config-state-timeline-row-height"
          />
          <OInput
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.row_gap"
            type="number"
            :min="0"
            :label="t('dashboard.stateTimelineRowGap')"
            :placeholder="t('dashboard.auto')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.row_gap =
                  typeof value === 'number' ? value : null)
            "
            data-test="dashboard-config-state-timeline-row-gap"
          />
        </div>

        <OSwitch
          v-show="isConfigOptionVisible('stateTimeline', 'show-state-text')"
          v-model="showStateTextModel"
          :label="t('dashboard.stateTimelineShowStateText')"
          data-test="dashboard-config-state-timeline-show-state-text"
          size="lg"
        />

        <OSwitch
          v-show="isConfigOptionVisible('stateTimeline', 'status-history-show-values')"
          :model-value="dashboardPanelData.data.config.status_history_show_values !== false"
          :label="t('dashboard.statusHistoryShowValues')"
          data-test="dashboard-config-status_history_show_values"
          size="lg"
          @update:model-value="
            (value: any) => setDefaultOnFlag('status_history_show_values', value)
          "
        />

        <OToggleGroup
          v-show="isConfigOptionVisible('stateTimeline', 'row-sort')"
          type="single"
          label-position="top"
          :label="t('dashboard.stateTimelineRowSort')"
          v-model="rowSortModel"
          data-test="dashboard-config-state-timeline-row-sort"
          :data-test-selected-value="rowSortModel"
        >
          <OToggleGroupItem
            v-for="opt in rowSortOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-state-timeline-row-sort-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-show="isConfigOptionVisible('stateTimeline', 'tooltip-mode')"
          type="single"
          label-position="top"
          :label="t('dashboard.stateTimelineTooltipMode')"
          v-model="tooltipModeModel"
          data-test="dashboard-config-state-timeline-tooltip-mode"
          :data-test-selected-value="tooltipModeModel"
        >
          <OToggleGroupItem
            v-for="opt in tooltipModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-state-timeline-tooltip-mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-show="isConfigOptionVisible('stateTimeline', 'state-value-align')"
          type="single"
          label-position="top"
          :label="t('dashboard.stateValueAlign')"
          v-model="stateValueAlignModel"
          data-test="dashboard-config-state_value_align"
          :data-test-selected-value="stateValueAlignModel"
        >
          <OToggleGroupItem
            v-for="opt in stateValueAlignOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-state_value_align-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OInput
          v-if="shouldShowAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-width')"
          v-model.number="dashboardPanelDataModel.data.config.axis_width"
          :label="t('common.axisWidth')"
          type="number"
          :placeholder="t('dashboard.auto')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.axis_width = value !== '' ? value : null)
          "
          data-test="dashboard-config-axis-width"
        />

        <OSwitch
          v-if="shouldShowAxisBorderConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-border')"
          v-model="dashboardPanelDataModel.data.config.axis_border_show"
          :label="t('dashboard.showBorder')"
          data-test="dashboard-config-axis-border"
          size="lg"
        />

        <OToggleGroup
          v-if="shouldShowHeatmapYSort(dashboardPanelData, promqlMode)"
          v-show="isConfigOptionVisible('axis', 'heatmap-y-sort')"
          type="single"
          label-position="top"
          v-model="heatmapYSortModel"
          data-test="dashboard-config-heatmap_y_sort"
          :data-test-selected-value="heatmapYSortModel"
        >
          <template #label>
            <span class="flex items-center gap-1">
              {{ t("dashboard.heatmapYSort") }}
              <OIcon name="info-outline" size="sm" class="cursor-help">
                <OTooltip :content="t('dashboard.heatmapYSortTooltip')" max-width="15.625rem" />
              </OIcon>
            </span>
          </template>
          <OToggleGroupItem
            v-for="opt in heatmapYSortOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-heatmap_y_sort-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <template v-if="shouldShowHeatmapYBucket(dashboardPanelData, promqlMode)">
          <OToggleGroup
            v-show="isConfigOptionVisible('axis', 'heatmap-y-bucket')"
            type="single"
            label-position="top"
            v-model="heatmapYBucketModeModel"
            data-test="dashboard-config-heatmap_y_bucket"
            :data-test-selected-value="heatmapYBucketModeModel"
          >
            <template #label>
              <span class="flex items-center gap-1">
                {{ t("dashboard.heatmapYBucket") }}
                <OIcon name="info-outline" size="sm" class="cursor-help">
                  <OTooltip :content="t('dashboard.heatmapYBucketTooltip')" max-width="15.625rem" />
                </OIcon>
              </span>
            </template>
            <OToggleGroupItem
              v-for="opt in heatmapYBucketModeOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              data-test="dashboard-config-heatmap_y_bucket-option"
              :data-test-label="opt.label"
              >{{ opt.label }}</OToggleGroupItem
            >
          </OToggleGroup>

          <OInput
            v-if="heatmapYBucketModeModel === 'size'"
            v-show="isConfigOptionVisible('axis', 'heatmap-y-bucket')"
            :model-value="dashboardPanelData.data.config.heatmap_y_bucket?.size ?? null"
            type="number"
            :label="t('dashboard.heatmapYBucketSize')"
            :error="!!heatmapYBucketErrorMessage"
            :error-message="heatmapYBucketErrorMessage"
            @update:model-value="
              (value: string | number) => setHeatmapYBucket({ size: toNumberOrNull(value) })
            "
            data-test="dashboard-config-heatmap_y_bucket_size"
          />

          <OToggleGroup
            v-if="heatmapYBucketModeModel === 'log'"
            v-show="isConfigOptionVisible('axis', 'heatmap-y-bucket')"
            type="single"
            label-position="top"
            :label="t('dashboard.heatmapYBucketBase')"
            v-model="heatmapYBucketBaseModel"
            data-test="dashboard-config-heatmap_y_bucket_base"
            :data-test-selected-value="heatmapYBucketBaseModel"
          >
            <OToggleGroupItem
              v-for="base in heatmapYLogBases"
              :key="base"
              :value="String(base)"
              size="sm"
              data-test="dashboard-config-heatmap_y_bucket_base-option"
              :data-test-label="String(base)"
              >{{ base }}</OToggleGroupItem
            >
          </OToggleGroup>

          <div
            class="flex gap-2"
            v-if="heatmapYBucketModeModel !== 'none'"
            v-show="isConfigOptionVisible('axis', 'heatmap-y-range')"
          >
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.heatmap_y_min ?? null"
              type="number"
              :placeholder="t('dashboard.auto')"
              :label="t('dashboard.heatmapYMin')"
              :error="isHeatmapYRangeInvalid"
              @update:model-value="
                (value: string | number) =>
                  (dashboardPanelDataModel.data.config.heatmap_y_min = toNumberOrNull(value))
              "
              data-test="dashboard-config-heatmap_y_min"
            >
              <template #tooltip>
                <OTooltip :side-offset="8" :content="t('dashboard.heatmapYMinTooltip')" />
              </template>
            </OInput>
            <OInput
              class="min-w-0 flex-1"
              :model-value="dashboardPanelData.data.config.heatmap_y_max ?? null"
              type="number"
              :placeholder="t('dashboard.auto')"
              :label="t('dashboard.heatmapYMax')"
              :error="isHeatmapYRangeInvalid"
              :error-message="t('dashboard.heatmapYRangeInvalid')"
              @update:model-value="
                (value: string | number) =>
                  (dashboardPanelDataModel.data.config.heatmap_y_max = toNumberOrNull(value))
              "
              data-test="dashboard-config-heatmap_y_max"
            >
              <template #tooltip>
                <OTooltip :side-offset="8" :content="t('dashboard.heatmapYMaxTooltip')" />
              </template>
            </OInput>
          </div>
        </template>

        <OToggleGroup
          v-if="!promqlMode && shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'axis-label-mode')"
          type="single"
          label-position="top"
          v-model="axisLabelModeModel"
          data-test="dashboard-config-axis-label-mode"
          :data-test-selected-value="axisLabelModeModel"
        >
          <template #label>
            <span class="flex items-center gap-1">
              {{ t("dashboard.axisLabelMode") }}
              <OIcon
                name="info-outline"
                size="sm"
                class="cursor-help"
                data-test="dashboard-config-axis-label-mode-info"
              >
                <OTooltip :content="t('dashboard.axisLabelModeTooltip')" max-width="15.625rem" />
              </OIcon>
            </span>
          </template>
          <OToggleGroupItem
            v-for="opt in axisLabelModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-axis-label-mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <div
          class="flex gap-2"
          v-if="shouldShowCartesianAxisConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'y-axis')"
        >
          <OInput
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.y_axis_min"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('common.yAxisMin')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.y_axis_min = value !== '' ? value : null)
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
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.y_axis_max"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('common.yAxisMax')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.y_axis_max = value !== '' ? value : null)
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

        <div
          class="flex gap-2"
          v-if="shouldShowCartesianSeriesConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'y-axis-soft-range')"
        >
          <OInput
            class="min-w-0 flex-1"
            :model-value="dashboardPanelData.data.config.y_axis_soft_min ?? null"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('dashboard.yAxisSoftMin')"
            data-test="dashboard-config-y_axis_soft_min"
            @update:model-value="(value: any) => setNumberConfig('y_axis_soft_min', value)"
          >
            <template #tooltip>
              <OTooltip :content="t('dashboard.yAxisSoftRangeTooltip')" max-width="15.625rem" />
            </template>
          </OInput>
          <OInput
            class="min-w-0 flex-1"
            :model-value="dashboardPanelData.data.config.y_axis_soft_max ?? null"
            type="number"
            :placeholder="t('dashboard.auto')"
            :label="t('dashboard.yAxisSoftMax')"
            data-test="dashboard-config-y_axis_soft_max"
            @update:model-value="(value: any) => setNumberConfig('y_axis_soft_max', value)"
          >
            <template #tooltip>
              <OTooltip :content="t('dashboard.yAxisSoftRangeTooltip')" max-width="15.625rem" />
            </template>
          </OInput>
        </div>

        <OToggleGroup
          v-if="shouldShowCartesianSeriesConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'y-axis-scale')"
          type="single"
          label-position="top"
          :label="t('dashboard.yAxisScale')"
          v-model="yAxisScaleModel"
          data-test="dashboard-config-y_axis_scale"
          :data-test-selected-value="yAxisScaleModel"
        >
          <OToggleGroupItem
            v-for="opt in yAxisScaleOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-y_axis_scale-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OSelect
          v-if="
            shouldShowCartesianSeriesConfig(dashboardPanelData) &&
            dashboardPanelData.data.config.y_axis_scale === 'log'
          "
          v-show="isConfigOptionVisible('axis', 'y-axis-scale')"
          v-model="yAxisLogBaseModel"
          :options="yAxisLogBaseOptions"
          :label="t('dashboard.yAxisLogBase')"
          data-test="dashboard-config-y_axis_log_base"
        />

        <OInput
          v-if="shouldShowCartesianSeriesConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'y-axis-label')"
          :model-value="dashboardPanelData.data.config.y_axis_label ?? ''"
          :label="t('dashboard.yAxisLabel')"
          :placeholder="t('dashboard.auto')"
          data-test="dashboard-config-y_axis_label"
          @update:model-value="(value: any) => setTextConfig('y_axis_label', value)"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.yAxisLabelTooltip')" max-width="15.625rem" />
          </template>
        </OInput>

        <OToggleGroup
          v-if="shouldShowStackMode(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'stack-mode')"
          type="single"
          label-position="top"
          v-model="stackModeModel"
          data-test="dashboard-config-stack_mode"
          :data-test-selected-value="stackModeModel"
        >
          <template #label>
            <span class="flex items-center gap-1">
              {{ t("dashboard.stackMode") }}
              <OIcon name="info-outline" size="sm" class="cursor-help">
                <OTooltip :content="t('dashboard.stackModeTooltip')" max-width="15.625rem" />
              </OIcon>
            </span>
          </template>
          <OToggleGroupItem
            v-for="opt in stackModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-stack_mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-if="shouldShowSortOrder(dashboardPanelData)"
          v-show="isConfigOptionVisible('axis', 'sort-order')"
          type="single"
          label-position="top"
          :label="t('dashboard.barSortOrder')"
          v-model="sortOrderModel"
          data-test="dashboard-config-sort_order"
          :data-test-selected-value="sortOrderModel"
        >
          <OToggleGroupItem
            v-for="opt in sortOrderOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-sort_order-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
          :placeholder="t('dashboard.zeroPlaceholder')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.label_option.rotate =
                typeof value === 'number' ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.config.label_option.rotate == null)
                dashboardPanelDataModel.data.config.label_option.rotate = 0;
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
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.axis_label_rotate"
            type="number"
            :placeholder="t('dashboard.zeroPlaceholder')"
            :label="t('dashboard.axisLabelRotate')"
            @update:model-value="
              (value: any) =>
                (dashboardPanelDataModel.data.config.axis_label_rotate =
                  typeof value === 'number' ? value : null)
            "
            @blur="
              () =>
                dashboardPanelData.data.config.axis_label_rotate == null &&
                (dashboardPanelDataModel.data.config.axis_label_rotate = 0)
            "
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
            class="min-w-0 flex-1"
            v-model.number="dashboardPanelDataModel.data.config.axis_label_truncate_width"
            type="number"
            :placeholder="t('dashboard.zeroPlaceholder')"
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
                    <span>{{ t("dashboard.axisLabelTruncateTooltipText") }}</span>
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
          step="any"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.config.line_thickness =
                typeof value == 'number' && value >= 0 ? value : null)
          "
          @blur="
            () => {
              if (dashboardPanelData.data.config.line_thickness == null)
                dashboardPanelDataModel.data.config.line_thickness = 1.5;
            }
          "
          :label="t('dashboard.lineThickness')"
          :placeholder="t('dashboard.lineThicknessDefault')"
          data-test="dashboard-config-line_thickness"
        />

        <OToggleGroup
          v-if="shouldShowAreaLineStyleConfig(dashboardPanelData)"
          v-show="isConfigOptionVisible('lineStyle', 'line-style')"
          type="single"
          label-position="top"
          :label="t('dashboard.lineStyle')"
          v-model="lineStyleModel"
          data-test="dashboard-config-line_style"
          :data-test-selected-value="lineStyleModel"
        >
          <OToggleGroupItem
            v-for="opt in lineStyleOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-line_style-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OInput
          v-if="shouldShowBarRadius(dashboardPanelData)"
          v-show="isConfigOptionVisible('lineStyle', 'bar-radius')"
          :model-value="dashboardPanelData.data.config.bar_radius ?? null"
          type="number"
          :min="0"
          :label="t('dashboard.barRadius')"
          :placeholder="t('dashboard.zeroPlaceholder')"
          data-test="dashboard-config-bar_radius"
          @update:model-value="(value: any) => setNumberConfig('bar_radius', value)"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.barRadiusTooltip')" max-width="15.625rem" />
          </template>
        </OInput>
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
          v-model.number="dashboardPanelDataModel.data.config.table_pagination_rows_per_page"
          type="number"
          :placeholder="t('dashboard.auto')"
          :min="1"
          :label="t('dashboard.rowsPerPage')"
          data-test="dashboard-config-rows-per-page"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.rowsPerPageTooltip')" max-width="15.625rem" />
          </template>
        </OInput>

        <OToggleGroup
          v-show="isConfigOptionVisible('table', 'table-density')"
          type="single"
          label-position="top"
          :label="t('dashboard.tableDensity')"
          v-model="tableDensityModel"
          data-test="dashboard-config-table_density"
          :data-test-selected-value="tableDensityModel"
        >
          <OToggleGroupItem
            v-for="opt in tableDensityOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-table_density-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OSelect
          v-if="!promqlMode && !isPivotMode"
          v-show="isConfigOptionVisible('table', 'table-footer-calcs')"
          :model-value="tableFooterCalcsModel"
          :options="tableFooterCalcOptions"
          multiple
          :label="t('dashboard.tableFooterCalcs')"
          :placeholder="t('dashboard.sortNone')"
          data-test="dashboard-config-table_footer_calcs"
          @update:model-value="(value: any) => setListConfig('table_footer_calcs', value)"
        />
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OSwitch
          v-if="!promqlMode && isPivotMode"
          v-show="isConfigOptionVisible('pivotTable', 'pivot-show-row-totals')"
          v-model="dashboardPanelDataModel.data.config.table_pivot_show_row_totals"
          data-test="dashboard-config-pivot-row-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotShowRowTotals") }}
            <OButton variant="ghost" size="icon" @click.stop icon-left="info-outline">
              <OTooltip :content="t('dashboard.pivotShowRowTotalsTooltip')" max-width="15.625rem" />
            </OButton>
          </template>
        </OSwitch>

        <OSwitch
          v-if="
            !promqlMode && isPivotMode && dashboardPanelData.data.config.table_pivot_show_row_totals
          "
          v-show="isConfigOptionVisible('pivotTable', 'pivot-sticky-col-totals')"
          v-model="dashboardPanelDataModel.data.config.table_pivot_sticky_col_totals"
          data-test="dashboard-config-pivot-sticky-col-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotStickyColTotals") }}
            <OButton variant="ghost" size="icon" @click.stop icon-left="info-outline">
              <OTooltip
                :content="t('dashboard.pivotStickyColTotalsTooltip')"
                max-width="15.625rem"
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
            <OButton variant="ghost" size="icon" @click.stop icon-left="info-outline">
              <OTooltip :content="t('dashboard.pivotShowColTotalsTooltip')" max-width="15.625rem" />
            </OButton>
          </template>
        </OSwitch>

        <OSwitch
          v-if="
            !promqlMode && isPivotMode && dashboardPanelData.data.config.table_pivot_show_col_totals
          "
          v-show="isConfigOptionVisible('pivotTable', 'pivot-sticky-row-totals')"
          v-model="dashboardPanelDataModel.data.config.table_pivot_sticky_row_totals"
          data-test="dashboard-config-pivot-sticky-row-totals"
          size="lg"
        >
          <template #label>
            {{ t("dashboard.pivotStickyRowTotals") }}
            <OButton variant="ghost" size="icon" @click.stop icon-left="info-outline">
              <OTooltip
                :content="t('dashboard.pivotStickyRowTotalsTooltip')"
                max-width="15.625rem"
              />
            </OButton>
          </template>
        </OSwitch>
      </div>
    </OCollapsible>

    <!-- Section: Value Transformations -->
    <OCollapsible
      variant="config"
      v-if="
        ['table', 'metric', 'state-timeline', 'status-history'].includes(
          dashboardPanelData.data.type,
        )
      "
      v-show="isSectionVisible('valueTransformations')"
      :model-value="isExpanded('valueTransformations')"
      :icon="SECTION_ICONS.valueTransformations"
      @update:modelValue="
        (v) => {
          expandedSections.valueTransformations = v;
        }
      "
      class="border-card-glass-border border-t border-solid"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.configSectionValueTransformations") }}</span
        >
        <OIcon name="info-outline" size="sm" />
        <OTooltip
          :content="t('dashboard.configSectionValueTransformationsTooltip')"
          max-width="15.625rem"
        />
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
      class="border-card-glass-border border-t border-solid"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.configSectionFieldOverrides") }}</span
        >
        <OIcon name="info-outline" size="sm" />
        <OTooltip
          :content="t('dashboard.configSectionFieldOverridesTooltip')"
          max-width="15.625rem"
        />
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OButton
          variant="outline"
          size="sm"
          @click="$emit('open-field-overrides')"
          data-test="dashboard-addpanel-config-override-config-add-btn"
        >
          {{ t("dashboard.addFieldOverride") }}
        </OButton>
      </div>
    </OCollapsible>

    <!-- Section: Series Overrides -->
    <OCollapsible
      variant="config"
      v-if="shouldShowSeriesOverrides(dashboardPanelData)"
      v-show="isSectionVisible('seriesOverrides')"
      :model-value="isExpanded('seriesOverrides')"
      :icon="SECTION_ICONS.seriesOverrides"
      @update:modelValue="
        (v) => {
          expandedSections.seriesOverrides = v;
        }
      "
      class="border-card-glass-border border-t border-solid"
      data-test="dashboard-addpanel-config-series-overrides-section"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.configSectionSeriesOverrides") }}</span
        >
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-series-overrides-info"
        />
        <OTooltip
          :content="t('dashboard.configSectionSeriesOverridesTooltip')"
          max-width="15.625rem"
        />
        <OBadge
          v-if="seriesOverrideCount"
          variant="default-soft"
          size="xs"
          :aria-label="
            t('dashboard.seriesOverrideCount', { count: seriesOverrideCount }, seriesOverrideCount)
          "
          data-test="dashboard-addpanel-config-series-overrides-count"
          >{{ seriesOverrideCount }}</OBadge
        >
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OButton
          variant="outline"
          size="sm"
          @click="$emit('open-series-overrides')"
          data-test="dashboard-addpanel-config-series-overrides-add-btn"
        >
          {{ t("dashboard.addSeriesOverride") }}
        </OButton>
      </div>
    </OCollapsible>

    <!-- Section: Map -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'geomap' || dashboardPanelData.data.type == 'maps'"
      v-show="isSectionVisible('map')"
      :model-value="isExpanded('map')"
      :icon="SECTION_ICONS.map"
      @update:modelValue="
        (v) => {
          expandedSections.map = v;
        }
      "
      :label="t('dashboard.configSectionMap')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
              <OTooltip :content="t('dashboard.mapsMapTypeTooltip')" max-width="15.625rem" />
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
              class="min-w-0 flex-1"
              v-model.number="dashboardPanelDataModel.data.config.map_view.lat"
              :label="t('dashboard.latitudeLabel')"
              type="number"
              @blur="handleBlur(dashboardPanelData.data.config.map_view, 0, 'lat')"
              data-test="dashboard-config-latitude"
            />
            <OInput
              class="min-w-0 flex-1"
              v-model.number="dashboardPanelDataModel.data.config.map_view.lng"
              :label="t('dashboard.longitudeLabel')"
              type="number"
              @blur="handleBlur(dashboardPanelData.data.config.map_view, 0, 'lng')"
              data-test="dashboard-config-longitude"
            />
          </div>
          <OInput
            v-model.number="dashboardPanelDataModel.data.config.map_view.zoom"
            :label="t('dashboard.zoomLabel')"
            type="number"
            @blur="handleBlur(dashboardPanelData.data.config.map_view, 1, 'zoom')"
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
              class="min-w-0 flex-1"
              v-if="dashboardPanelData.data.config.map_symbol_style.size === 'by Value'"
              v-model.number="
                dashboardPanelDataModel.data.config.map_symbol_style.size_by_value.min
              "
              :label="t('dashboard.minimum')"
              type="number"
              :min="0"
              @blur="
                handleBlur(dashboardPanelData.data.config.map_symbol_style.size_by_value, 1, 'min')
              "
              data-test="dashboard-config-map-symbol-min"
            />
            <OInput
              class="min-w-0 flex-1"
              v-if="dashboardPanelData.data.config.map_symbol_style.size === 'by Value'"
              v-model.number="
                dashboardPanelDataModel.data.config.map_symbol_style.size_by_value.max
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
            v-if="dashboardPanelData.data.config.map_symbol_style.size === 'fixed'"
            v-model.number="dashboardPanelDataModel.data.config.map_symbol_style.size_fixed"
            :label="t('dashboard.fixedValue')"
            type="number"
            @blur="handleBlur(dashboardPanelData.data.config.map_symbol_style, 2, 'size_fixed')"
            data-test="dashboard-config-map-symbol-fixed"
          />

          <OSelect
            v-model="
              dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex]
                .config.layer_type
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
              dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex]
                .config.weight_fixed
            "
            :label="t('common.weight')"
            type="number"
            @blur="
              handleBlur(
                dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config,
                1,
                'weight_fixed',
              )
            "
            data-test="dashboard-config-weight"
          />

          <OSwitch
            v-show="isConfigOptionVisible('map', 'map-cluster')"
            :model-value="dashboardPanelData.data.config.map_cluster === true"
            :label="t('dashboard.mapCluster')"
            data-test="dashboard-config-map_cluster"
            size="lg"
            @update:model-value="(value: any) => setFlagConfig('map_cluster', value)"
          />
          <OInput
            v-if="dashboardPanelData.data.config.map_cluster === true"
            v-show="isConfigOptionVisible('map', 'map-cluster')"
            :model-value="dashboardPanelData.data.config.map_cluster_radius ?? null"
            type="number"
            :min="1"
            :label="t('dashboard.mapClusterRadius')"
            :placeholder="t('dashboard.auto')"
            data-test="dashboard-config-map_cluster_radius"
            @update:model-value="(value: any) => setNumberConfig('map_cluster_radius', value)"
          >
            <template #tooltip>
              <OTooltip :content="t('dashboard.mapClusterRadiusTooltip')" max-width="15.625rem" />
            </template>
          </OInput>
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Gauge -->
    <OCollapsible
      variant="config"
      v-if="['gauge', 'bar-gauge'].includes(dashboardPanelData.data.type)"
      v-show="isSectionVisible('gauge')"
      :model-value="isExpanded('gauge')"
      :icon="SECTION_ICONS.gauge"
      @update:modelValue="
        (v) => {
          expandedSections.gauge = v;
        }
      "
      :label="t('dashboard.configSectionGauge')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-min')"
          v-model.number="
            dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex].config
              .min
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
              if (
                dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
                  .min == null
              )
                dashboardPanelDataModel.data.queries[
                  dashboardPanelDataModel.layout.currentQueryIndex
                ].config.min = 0;
            }
          "
          data-test="dashboard-config-gauge-min"
        />
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-max')"
          v-model.number="
            dashboardPanelDataModel.data.queries[dashboardPanelData.layout.currentQueryIndex].config
              .max
          "
          type="number"
          :label="t('dashboard.gaugeMaxValue')"
          :placeholder="t('dashboard.hundredPlaceholder')"
          @update:model-value="
            (value: any) =>
              (dashboardPanelDataModel.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].config.max = typeof value === 'number' ? value : null)
          "
          @blur="
            () => {
              if (
                dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
                  .max == null
              )
                dashboardPanelDataModel.data.queries[
                  dashboardPanelDataModel.layout.currentQueryIndex
                ].config.max = 100;
            }
          "
          data-test="dashboard-config-gauge-max"
        />
        <OToggleGroup
          v-show="isConfigOptionVisible('gauge', 'gauge-style')"
          type="single"
          label-position="top"
          :label="t('dashboard.gaugeStyle')"
          v-model="gaugeStyleModel"
          data-test="dashboard-config-gauge_style"
          :data-test-selected-value="gaugeStyleModel"
        >
          <OToggleGroupItem
            v-for="opt in gaugeStyleOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-gauge_style-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-segments')"
          :model-value="dashboardPanelData.data.config.gauge_segments ?? null"
          type="number"
          :min="2"
          :max="100"
          :label="t('dashboard.gaugeSegments')"
          :placeholder="t('dashboard.gaugeSegmentsPlaceholder')"
          data-test="dashboard-config-gauge_segments"
          @update:model-value="(value: any) => setNumberConfig('gauge_segments', value)"
        />
        <OInput
          v-show="isConfigOptionVisible('gauge', 'gauge-neutral')"
          :model-value="dashboardPanelData.data.config.gauge_neutral ?? null"
          type="number"
          :label="t('dashboard.gaugeNeutral')"
          :placeholder="t('dashboard.gaugeNeutralPlaceholder')"
          data-test="dashboard-config-gauge_neutral"
          @update:model-value="(value: any) => setNumberConfig('gauge_neutral', value)"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.gaugeNeutralTooltip')" max-width="15.625rem" />
          </template>
        </OInput>
        <OSwitch
          v-show="isConfigOptionVisible('gauge', 'gauge-round-cap')"
          :model-value="dashboardPanelData.data.config.gauge_round_cap === true"
          :label="t('dashboard.gaugeRoundCap')"
          data-test="dashboard-config-gauge_round_cap"
          size="lg"
          @update:model-value="(value: any) => setFlagConfig('gauge_round_cap', value)"
        />
        <OToggleGroup
          v-show="isConfigOptionVisible('gauge', 'bar-gauge-mode')"
          type="single"
          label-position="top"
          :label="t('dashboard.barGaugeMode')"
          v-model="barGaugeModeModel"
          data-test="dashboard-config-bar_gauge_mode"
          :data-test-selected-value="barGaugeModeModel"
        >
          <OToggleGroupItem
            v-for="opt in barGaugeModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-bar_gauge_mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>
        <OToggleGroup
          v-show="isConfigOptionVisible('gauge', 'bar-gauge-orientation')"
          type="single"
          label-position="top"
          :label="t('dashboard.barGaugeOrientation')"
          v-model="barGaugeOrientationModel"
          data-test="dashboard-config-bar_gauge_orientation"
          :data-test-selected-value="barGaugeOrientationModel"
        >
          <OToggleGroupItem
            v-for="opt in barGaugeOrientationOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-bar_gauge_orientation-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>
        <OSwitch
          v-show="isConfigOptionVisible('gauge', 'bar-gauge-show-unfilled')"
          :model-value="dashboardPanelData.data.config.bar_gauge_show_unfilled !== false"
          :label="t('dashboard.barGaugeShowUnfilled')"
          data-test="dashboard-config-bar_gauge_show_unfilled"
          size="lg"
          @update:model-value="(value: any) => setDefaultOnFlag('bar_gauge_show_unfilled', value)"
        />
      </div>
    </OCollapsible>

    <!-- Section: Pie -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type === 'pie' || dashboardPanelData.data.type === 'donut'"
      v-show="isSectionVisible('pie')"
      :model-value="isExpanded('pie')"
      :icon="SECTION_ICONS.pie"
      @update:modelValue="
        (v) => {
          expandedSections.pie = v;
        }
      "
      :label="t('dashboard.configSectionPie')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OSelect
          v-show="isConfigOptionVisible('pie', 'pie-label-content')"
          :model-value="pieLabelContentModel"
          :options="pieLabelContentOptions"
          multiple
          :label="t('dashboard.pieLabelContent')"
          :placeholder="t('dashboard.pieLabelContentPlaceholder')"
          data-test="dashboard-config-pie_label_content"
          @update:model-value="(value: any) => setListConfig('pie_label_content', value)"
        />
        <OToggleGroup
          v-show="isConfigOptionVisible('pie', 'pie-sort-order')"
          type="single"
          label-position="top"
          :label="t('dashboard.pieSortOrder')"
          v-model="sortOrderModel"
          data-test="dashboard-config-pie_sort_order"
          :data-test-selected-value="sortOrderModel"
        >
          <OToggleGroupItem
            v-for="opt in sortOrderOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-pie_sort_order-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>
        <OInput
          v-show="isConfigOptionVisible('pie', 'pie-other-threshold')"
          :model-value="dashboardPanelData.data.config.pie_other_threshold ?? null"
          type="number"
          :min="0"
          :max="100"
          :label="t('dashboard.pieOtherThreshold')"
          :placeholder="t('dashboard.sortNone')"
          data-test="dashboard-config-pie_other_threshold"
          @update:model-value="(value: any) => setNumberConfig('pie_other_threshold', value)"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.pieOtherThresholdTooltip')" max-width="15.625rem" />
          </template>
        </OInput>
        <OInput
          v-if="dashboardPanelData.data.type === 'donut'"
          v-show="isConfigOptionVisible('pie', 'donut-inner-radius')"
          :model-value="dashboardPanelData.data.config.donut_inner_radius ?? null"
          type="number"
          :min="0"
          :max="95"
          :label="t('dashboard.donutInnerRadius')"
          :placeholder="t('dashboard.auto')"
          data-test="dashboard-config-donut_inner_radius"
          @update:model-value="(value: any) => setNumberConfig('donut_inner_radius', value)"
        >
          <template #tooltip>
            <OTooltip :content="t('dashboard.donutInnerRadiusTooltip')" max-width="15.625rem" />
          </template>
        </OInput>
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
              <OTooltip max-width="15.625rem">
                <template #content>
                  <b>{{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip", { product: raw("Trellis") })
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
            v-model.number="dashboardPanelDataModel.data.config.trellis.num_of_columns"
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
              <OTooltip max-width="15.625rem">
                <template #content>
                  <b>{{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip", { product: raw("Trellis") })
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
                    <b>{{ t("dashboard.groupMultiYAxisTrellisTooltipTitle") }}</b>
                    <br /><br />
                    {{ t("dashboard.groupMultiYAxisTrellisTooltipDescription") }}
                    <br /><br />
                    <b>{{ t("dashboard.groupMultiYAxisTrellisTooltipEnabled") }}</b>
                    <br /><br />
                    <b>{{ t("dashboard.groupMultiYAxisTrellisTooltipDisabled") }}</b>
                    <br /><br />
                    <i>{{ t("dashboard.groupMultiYAxisTrellisTooltipExample") }}</i>
                    <br />
                    {{ t("dashboard.groupMultiYAxisTrellisTooltipEnabledResult") }}
                    <br />
                    {{ t("dashboard.groupMultiYAxisTrellisTooltipDisabledResult") }}
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
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
      class="border-card-glass-border border-t border-solid"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.drilldown") }}</span
        >
        <OIcon name="info-outline" size="sm" data-test="dashboard-addpanel-config-drilldown-info" />
        <OTooltip :content="t('dashboard.drilldownTooltip')" max-width="15.625rem" />
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <Drilldown :variablesData="variablesData" />
      </div>
    </OCollapsible>

    <!-- Section: Comparison -->
    <OCollapsible
      variant="config"
      v-if="shouldShowTimeShift(dashboardPanelData, promqlMode, dashboardPanelDataPageKey)"
      v-show="isSectionVisible('comparison')"
      :model-value="isExpanded('comparison')"
      :icon="SECTION_ICONS.comparison"
      @update:modelValue="
        (v) => {
          expandedSections.comparison = v;
        }
      "
      class="border-card-glass-border border-t border-solid"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.comparisonAgainst") }}</span
        >
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-time-shift-info"
        />
        <OTooltip :content="t('dashboard.comparisonAgainstTooltip')" max-width="15.625rem" />
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <CustomDateTimePicker modelValue="0m" :isFirstEntry="true" :disable="true" />
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
              :excludeMonths="!!promqlMode"
            />
            <OIcon
              class="ms-2 me-1 cursor-pointer"
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
      class="border-card-glass-border border-t border-solid"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.markLines") }}</span
        >
        <OIcon name="info-outline" size="sm" data-test="dashboard-addpanel-config-markline-info" />
        <OTooltip :content="t('dashboard.markLinesTooltip')" max-width="15.625rem" />
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <MarkLineConfig v-show="isConfigOptionVisible('markLines', 'mark-lines')" />
        <MarkAreaConfig v-show="isConfigOptionVisible('markLines', 'mark-areas')" />
      </div>
    </OCollapsible>

    <!-- Section: Thresholds -->
    <OCollapsible
      variant="config"
      v-if="shouldShowThresholds(dashboardPanelData)"
      v-show="isSectionVisible('thresholds')"
      :model-value="isExpanded('thresholds')"
      :icon="SECTION_ICONS.thresholds"
      @update:modelValue="
        (v) => {
          expandedSections.thresholds = v;
        }
      "
      class="border-card-glass-border border-t border-solid"
      data-test="dashboard-addpanel-config-thresholds-section"
    >
      <template #trigger>
        <span
          class="text-compact text-collapsible-label group-data-[state=open]:text-collapsible-icon-open font-medium"
          >{{ t("dashboard.thresholds") }}</span
        >
        <OIcon
          name="info-outline"
          size="sm"
          data-test="dashboard-addpanel-config-thresholds-info"
        />
        <OTooltip :content="t('dashboard.thresholdsTooltip')" max-width="15.625rem" />
        <OBadge
          v-if="thresholdStepCount"
          variant="default-soft"
          size="xs"
          :aria-label="
            t('dashboard.thresholdStepCount', { count: thresholdStepCount }, thresholdStepCount)
          "
          data-test="dashboard-addpanel-config-thresholds-count"
          >{{ thresholdStepCount }}</OBadge
        >
      </template>
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <ThresholdsConfig
          :model-value="dashboardPanelData.data.config.thresholds"
          :chart-type="dashboardPanelData.data.type"
          :unit="dashboardPanelData.data.config.unit"
          :unit-custom="dashboardPanelData.data.config.unit_custom"
          :decimals="dashboardPanelData.data.config.decimals"
          :has-coloured-value-mappings="hasColouredValueMappings"
          @update:model-value="onThresholdsUpdate"
        />
        <div
          v-if="overridesWithStepsCount"
          class="text-text-secondary flex items-center gap-1.5 text-xs"
          data-test="dashboard-config-thresholds-overrides-note"
        >
          <OIcon name="info-outline" size="xs" class="shrink-0" />
          <span>{{
            t(
              "dashboard.thresholdOverridesOwnLimits",
              { count: overridesWithStepsCount },
              overridesWithStepsCount,
            )
          }}</span>
        </div>
      </div>
    </OCollapsible>

    <!-- Section: Metric -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'metric'"
      v-show="isSectionVisible('metric')"
      :model-value="isExpanded('metric')"
      :icon="SECTION_ICONS.metric"
      @update:modelValue="
        (v) => {
          expandedSections.metric = v;
        }
      "
      :label="t('dashboard.configSectionMetric')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <OToggleGroup
          v-show="isConfigOptionVisible('metric', 'stat-change')"
          type="single"
          label-position="top"
          v-model="statChangeModel"
          data-test="dashboard-config-stat_change"
          :data-test-selected-value="statChangeModel"
        >
          <template #label>
            <span class="flex items-center gap-1">
              {{ t("dashboard.statChange") }}
              <OIcon name="info-outline" size="sm" class="cursor-help">
                <OTooltip :content="t('dashboard.statChangeTooltip')" max-width="15.625rem" />
              </OIcon>
            </span>
          </template>
          <OToggleGroupItem
            v-for="opt in statChangeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-stat_change-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-if="statChangeModel !== 'off'"
          v-show="isConfigOptionVisible('metric', 'stat-change-color')"
          type="single"
          label-position="top"
          :label="t('dashboard.statChangeColor')"
          v-model="statChangeColorModel"
          data-test="dashboard-config-stat_change_color"
          :data-test-selected-value="statChangeColorModel"
        >
          <OToggleGroupItem
            v-for="opt in statChangeColorOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-stat_change_color-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OToggleGroup
          v-show="isConfigOptionVisible('metric', 'stat-text-mode')"
          type="single"
          label-position="top"
          :label="t('dashboard.statTextMode')"
          v-model="statTextModeModel"
          data-test="dashboard-config-stat_text_mode"
          :data-test-selected-value="statTextModeModel"
        >
          <OToggleGroupItem
            v-for="opt in statTextModeOptions"
            :key="opt.value"
            :value="opt.value"
            size="sm"
            data-test="dashboard-config-stat_text_mode-option"
            :data-test-label="opt.label"
            >{{ opt.label }}</OToggleGroupItem
          >
        </OToggleGroup>

        <OInput
          v-show="isConfigOptionVisible('metric', 'value-font-size')"
          :model-value="dashboardPanelData.data.config.value_font_size ?? null"
          type="number"
          :min="1"
          :label="t('dashboard.valueFontSize')"
          :placeholder="t('dashboard.auto')"
          data-test="dashboard-config-value_font_size"
          @update:model-value="(value: any) => setNumberConfig('value_font_size', value)"
        />
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
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <BackGroundColorConfig />
      </div>
    </OCollapsible>

    <!-- Section: Sparkline (metric only) -->
    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'metric'"
      v-show="isSectionVisible('sparkline')"
      :model-value="isExpanded('sparkline')"
      :icon="SECTION_ICONS.sparkline"
      @update:modelValue="
        (v) => {
          expandedSections.sparkline = v;
        }
      "
      :label="t('dashboard.configSectionSparkline')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <SparklineConfig />
      </div>
    </OCollapsible>

    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'logs'"
      v-show="isSectionVisible('logs')"
      :model-value="isExpanded('logs')"
      :icon="SECTION_ICONS.logs"
      @update:modelValue="
        (v) => {
          expandedSections.logs = v;
        }
      "
      :label="t('dashboard.chartSelection.logs')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <LogsPanelConfig :is-option-visible="(id: string) => isConfigOptionVisible('logs', id)" />
      </div>
    </OCollapsible>

    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'alert-list'"
      v-show="isSectionVisible('alertList')"
      :model-value="isExpanded('alertList')"
      :icon="SECTION_ICONS.alertList"
      @update:modelValue="
        (v) => {
          expandedSections.alertList = v;
        }
      "
      :label="t('dashboard.chartSelection.alertList')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <AlertListPanelConfig
          :is-option-visible="(id: string) => isConfigOptionVisible('alertList', id)"
        />
      </div>
    </OCollapsible>

    <OCollapsible
      variant="config"
      v-if="dashboardPanelData.data.type == 'flame-graph'"
      v-show="isSectionVisible('flameGraph')"
      :model-value="isExpanded('flameGraph')"
      :icon="SECTION_ICONS.flameGraph"
      @update:modelValue="
        (v) => {
          expandedSections.flameGraph = v;
        }
      "
      :label="t('dashboard.chartSelection.flameGraph')"
      class="border-card-glass-border border-t border-solid"
    >
      <div class="o2-input box-border flex flex-col gap-2.5 overflow-x-hidden px-3 py-2.5">
        <FlameGraphPanelConfig
          :is-option-visible="(id: string) => isConfigOptionVisible('flameGraph', id)"
        />
      </div>
    </OCollapsible>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import {
  STAT_CHANGE_COLORS,
  STAT_CHANGE_MODES,
  STAT_TEXT_MODES,
} from "@/utils/dashboard/metricOptions";
import { GAUGE_STYLES, STATE_VALUE_ALIGNS } from "@/utils/dashboard/panelTypeOptions";
import { BAR_GAUGE_MODES, BAR_GAUGE_ORIENTATIONS } from "@/utils/dashboard/convertBarGaugeData";
import { FUNNEL_ORIENTS, FUNNEL_SORTS } from "@/utils/dashboard/convertFunnelData";
import { BOXPLOT_WHISKERS } from "@/utils/dashboard/convertBoxplotData";
import { NODE_GRAPH_LAYOUTS } from "@/utils/dashboard/convertNodeGraphData";
import { isRowTimeline } from "@/utils/dashboard/chartTypeGroups";
import { TABLE_DENSITIES } from "@/utils/dashboard/tableOptions";
import { isExemplarEligible } from "@/utils/dashboard/exemplars/exemplarEligibility";
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
import { DEFAULT_HEATMAP_PALETTE, HEATMAP_PALETTES } from "@/utils/dashboard/heatmapPalettes";
import {
  DEFAULT_HEATMAP_COLOR_SCALE,
  HEATMAP_COLOR_SCALES,
  HEATMAP_MAX_ROWS,
  isHeatmapColorRangeInverted,
} from "@/utils/dashboard/heatmapDefaults";
import { addCommasToNumber } from "@/utils/formatters";
import { PROMETHEUS_HISTOGRAM_MODE } from "@/utils/dashboard/promql/convertPromQLHeatmapChart";
import {
  HEATMAP_Y_LOG_BASES,
  HEATMAP_Y_SORTS,
  heatmapYBucketCount,
  heatmapYBucketError,
  heatmapYBucketing,
  heatmapYRangeOf,
  isHeatmapYRangeInverted,
} from "@/utils/dashboard/heatmapYAxis";
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  inject,
  nextTick,
  onBeforeMount,
  onMounted,
  ref,
  markRaw,
  unref,
  watchEffect,
  watch,
} from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { AxisLabelMode } from "@/utils/dashboard/fieldLabel";
import Drilldown from "./Drilldown.vue";
import ValueMapping from "./ValueMapping.vue";
import ColorBySeries from "./ColorBySeries.vue";
import MarkLineConfig from "./MarkLineConfig.vue";
import MarkAreaConfig from "./MarkAreaConfig.vue";
import ThresholdsConfig from "./ThresholdsConfig.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import ColorPaletteDropDown from "./ColorPaletteDropDown.vue";
import BackGroundColorConfig from "./BackGroundColorConfig.vue";
import SparklineConfig from "./SparklineConfig.vue";
import ConfigPanelSearch from "./ConfigPanelSearch.vue";
import { getSeriesOverrideEntries } from "@/composables/dashboard/useSeriesFormatting";
import {
  isShown,
  revealAndFocus,
  usePanelEditorFocus,
  waitForElement,
} from "@/composables/dashboard/usePanelEditorFocus";
import {
  shouldShowSeriesOverrides,
  shouldShowHeatmapYBucket,
  shouldShowHeatmapYSort,
  shouldShowThresholds,
  useConfigPanel,
} from "../../../composables/dashboard/useConfigPanel";
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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { useStore } from "vuex";

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
  shouldShowAxisBorderConfig,
  shouldShowCartesianAxisConfig,
  shouldShowAxisLabelConfig,
  shouldShowLineThickness,
  shouldShowDrilldown,
  shouldShowTimeShift,
  shouldShowStackMode,
  shouldShowSortOrder,
  shouldShowBarRadius,
  shouldShowScatterEncoding,
  shouldShowConnectNullsThreshold,
  shouldShowCartesianSeriesConfig,
} from "@/utils/dashboard/configUtils";
import { SECTION_ICONS } from "@/utils/dashboard/searchLabelsConfig";
import { resolveTooltipSort } from "@/utils/dashboard/tooltipSort";
import { getFieldLabel } from "@/utils/dashboard/fieldLabel";

const LogsPanelConfig = defineAsyncComponent(() => import("./LogsPanelConfig.vue"));
const AlertListPanelConfig = defineAsyncComponent(() => import("./AlertListPanelConfig.vue"));
const FlameGraphPanelConfig = defineAsyncComponent(() => import("./FlameGraphPanelConfig.vue"));

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
    MarkAreaConfig,
    ThresholdsConfig,
    CustomDateTimePicker,
    DateTimePickerDashboard,
    ColorPaletteDropDown,
    BackGroundColorConfig,
    SparklineConfig,
    LogsPanelConfig,
    AlertListPanelConfig,
    FlameGraphPanelConfig,
    PromQLChartConfig,
    OButton,
    OTooltip,
    OIcon,
    OCollapsible,
    OBadge,
  },
  props: ["variablesData", "panelData"],
  emits: ["open-field-overrides", "open-series-overrides"],
  setup() {
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { t } = useI18nTyped();
    const { dashboardPanelData, promqlMode, isPivotMode } = useDashboardPanelData(
      dashboardPanelDataPageKey,
      t,
    );

    // Alias for template v-model mutation sites; same reference, no behavior change.
    const dashboardPanelDataModel = computed(() => dashboardPanelData);

    // Segmented toggle (OToggleGroup) proxies for few-option config selects.
    // OToggleGroup drops null/empty values (its single-select deselect guard),
    // so we bridge the stored `null` ("Auto"/"None") to a sentinel string and
    // back. Options iterate the same arrays used by the old OSelect.
    const TOGGLE_AUTO = "__auto__";
    const toggleModel = (key: string) =>
      computed({
        get: () => (dashboardPanelData.data.config as Record<string, unknown>)[key] ?? TOGGLE_AUTO,
        set: (v: unknown) => {
          (dashboardPanelData.data.config as Record<string, unknown>)[key] =
            v === TOGGLE_AUTO ? null : v;
        },
      });
    const axisLabelModeModel = computed({
      get: (): AxisLabelMode => dashboardPanelData.data.config.axis_label_mode ?? "auto",
      set: (v: AxisLabelMode) => {
        dashboardPanelData.data.config.axis_label_mode = v;
      },
    });
    const axisLabelModeOptions: { label: I18nText; value: AxisLabelMode }[] = [
      { label: t("dashboard.auto"), value: "auto" },
      { label: t("common.show"), value: "show" },
      { label: t("common.hide"), value: "hide" },
    ];
    const showStateTextModel = computed({
      get: () => dashboardPanelData.data.config.show_state_text !== false,
      set: (v: boolean) => {
        dashboardPanelData.data.config.show_state_text = v;
      },
    });
    const rowSortModel = computed({
      get: (): string => dashboardPanelData.data.config.row_sort ?? "name",
      set: (v: string) => {
        dashboardPanelData.data.config.row_sort = v;
      },
    });
    const tooltipModeModel = computed({
      get: (): string => dashboardPanelData.data.config.tooltip_mode ?? "segment",
      set: (v: string) => {
        dashboardPanelData.data.config.tooltip_mode = v;
      },
    });
    const tooltipModeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.stateTimelineTooltipSegment"), value: "segment" },
      { label: t("dashboard.stateTimelineTooltipAllRows"), value: "all_rows" },
    ];
    const rowSortOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.stateTimelineSortName"), value: "name" },
      { label: t("dashboard.stateTimelineSortNonOkTime"), value: "non_ok_time" },
    ];
    const config = () => dashboardPanelData.data.config as Record<string, any>;
    // An empty or cleared field drops the key, so the panel renders as if it was never set.
    const setNumberConfig = (key: string, value: unknown) => {
      const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof numeric === "number" && Number.isFinite(numeric)) config()[key] = numeric;
      else delete config()[key];
    };
    const setTextConfig = (key: string, value: unknown) => {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) config()[key] = text;
      else delete config()[key];
    };
    const choiceModel = <T extends string>(key: string, allowed: readonly T[], fallback: T) =>
      computed({
        get: (): T => (allowed.includes(config()[key]) ? config()[key] : fallback),
        set: (v: T) => {
          if (allowed.includes(v)) config()[key] = v;
        },
      });
    const chartTooltipModeModel = choiceModel("tooltip_mode", ["single", "all", "hidden"], "all");
    const chartTooltipModeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.chartTooltipSingle"), value: "single" },
      { label: t("dashboard.chartTooltipAll"), value: "all" },
      { label: t("common.hide"), value: "hidden" },
    ];
    const tooltipSortModel = computed({
      get: () => resolveTooltipSort(config()),
      set: (v: string) => {
        if (["none", "asc", "desc"].includes(v)) config().tooltip_sort = v;
      },
    });
    const sortChoiceOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.sortNone"), value: "none" },
      { label: t("dashboard.heatmapYSortAsc"), value: "asc" },
      { label: t("dashboard.heatmapYSortDesc"), value: "desc" },
    ];
    const tooltipSortOptions = sortChoiceOptions;
    const sortOrderModel = choiceModel("sort_order", ["none", "asc", "desc"], "none");
    const sortOrderOptions = sortChoiceOptions;
    const yAxisScaleModel = choiceModel("y_axis_scale", ["linear", "log"], "linear");
    const yAxisScaleOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.yAxisScaleLinear"), value: "linear" },
      { label: t("dashboard.yAxisScaleLog"), value: "log" },
    ];
    const yAxisLogBaseModel = computed({
      get: () => (Number(config().y_axis_log_base) === 2 ? 2 : 10),
      set: (v: number) => {
        config().y_axis_log_base = Number(v) === 2 ? 2 : 10;
      },
    });
    const yAxisLogBaseOptions = [
      { label: raw("2"), value: 2 },
      { label: raw("10"), value: 10 },
    ];
    const stackModeModel = choiceModel("stack_mode", ["normal", "percent"], "normal");
    const stackModeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.stackModeNormal"), value: "normal" },
      { label: t("dashboard.stackModePercent"), value: "percent" },
    ];
    const lineStyleModel = choiceModel("line_style", ["solid", "dashed", "dotted"], "solid");
    const lineStyleOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.lineStyleSolid"), value: "solid" },
      { label: t("dashboard.lineStyleDashed"), value: "dashed" },
      { label: t("dashboard.lineStyleDotted"), value: "dotted" },
    ];
    const setFlagConfig = (key: string, value: unknown) => {
      if (value === true) config()[key] = true;
      else delete config()[key];
    };
    // For a flag that is on by default: only turning it off is stored.
    const setDefaultOnFlag = (key: string, value: unknown) => {
      if (value === false) config()[key] = false;
      else delete config()[key];
    };
    const setListConfig = (key: string, value: unknown) => {
      const list = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      if (list.length > 0) config()[key] = list;
      else delete config()[key];
    };
    const listModel = (key: string) =>
      computed(() => (Array.isArray(config()[key]) ? config()[key] : []));
    const statChangeModel = choiceModel("stat_change", STAT_CHANGE_MODES, "off");
    const statChangeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.statChangeOff"), value: "off" },
      { label: t("dashboard.statChangePercent"), value: "percent" },
      { label: t("dashboard.statChangeAbsolute"), value: "absolute" },
    ];
    const statChangeColorModel = choiceModel("stat_change_color", STAT_CHANGE_COLORS, "standard");
    const statChangeColorOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.statChangeColorStandard"), value: "standard" },
      { label: t("dashboard.statChangeColorInverted"), value: "inverted" },
      { label: t("dashboard.statChangeColorNeutral"), value: "neutral" },
    ];
    const statTextModeModel = choiceModel("stat_text_mode", STAT_TEXT_MODES, "value");
    const statTextModeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.statTextModeValue"), value: "value" },
      { label: t("dashboard.statTextModeValueAndName"), value: "value_and_name" },
      { label: t("dashboard.statTextModeName"), value: "name" },
    ];
    const gaugeStyleModel = choiceModel("gauge_style", GAUGE_STYLES, "semi");
    const gaugeStyleOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.gaugeStyleSemi"), value: "semi" },
      { label: t("dashboard.gaugeStyleArc"), value: "arc" },
      { label: t("dashboard.gaugeStyleCircle"), value: "circle" },
    ];
    const barGaugeModeModel = choiceModel("bar_gauge_mode", BAR_GAUGE_MODES, "gradient");
    const barGaugeModeOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.barGaugeModeGradient"), value: "gradient" },
      { label: t("dashboard.barGaugeModeLcd"), value: "lcd" },
      { label: t("dashboard.barGaugeModeBasic"), value: "basic" },
    ];
    const barGaugeOrientationModel = choiceModel(
      "bar_gauge_orientation",
      BAR_GAUGE_ORIENTATIONS,
      "horizontal",
    );
    const barGaugeOrientationOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.barGaugeOrientationHorizontal"), value: "horizontal" },
      { label: t("dashboard.barGaugeOrientationVertical"), value: "vertical" },
    ];
    const funnelSortModel = choiceModel("funnel_sort", FUNNEL_SORTS, "descending");
    const funnelSortOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.funnelSortDescending"), value: "descending" },
      { label: t("dashboard.funnelSortAscending"), value: "ascending" },
      { label: t("dashboard.funnelSortNone"), value: "none" },
    ];
    const funnelOrientModel = choiceModel("funnel_orient", FUNNEL_ORIENTS, "vertical");
    const funnelOrientOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.barGaugeOrientationVertical"), value: "vertical" },
      { label: t("dashboard.barGaugeOrientationHorizontal"), value: "horizontal" },
    ];
    const boxplotWhiskerModel = choiceModel("boxplot_whisker", BOXPLOT_WHISKERS, "minmax");
    const boxplotWhiskerOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.boxplotWhiskerMinMax"), value: "minmax" },
      { label: t("dashboard.boxplotWhiskerIqr"), value: "iqr" },
    ];
    const nodeGraphLayoutModel = choiceModel("node_graph_layout", NODE_GRAPH_LAYOUTS, "force");
    const nodeGraphLayoutOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.nodeGraphLayoutForce"), value: "force" },
      { label: t("dashboard.nodeGraphLayoutCircular"), value: "circular" },
    ];
    // Absent, the converters label SQL slices by percent and PromQL slices by all three, so the picker starts there.
    const pieLabelContentModel = computed(() => {
      const saved = config().pie_label_content;
      if (Array.isArray(saved)) return saved;
      return unref(promqlMode) ? ["name", "value", "percent"] : ["percent"];
    });
    const pieLabelContentOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.pieLabelName"), value: "name" },
      { label: t("dashboard.pieLabelValue"), value: "value" },
      { label: t("dashboard.pieLabelPercent"), value: "percent" },
    ];
    const tableDensityModel = choiceModel("table_density", TABLE_DENSITIES, "compact");
    const tableDensityOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.tableDensityCompact"), value: "compact" },
      { label: t("dashboard.tableDensityStandard"), value: "standard" },
      { label: t("dashboard.tableDensityComfortable"), value: "comfortable" },
    ];
    const tableFooterCalcsModel = listModel("table_footer_calcs");
    const tableFooterCalcOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.tableFooterCalcSum"), value: "sum" },
      { label: t("dashboard.tableFooterCalcMean"), value: "mean" },
      { label: t("dashboard.tableFooterCalcMin"), value: "min" },
      { label: t("dashboard.tableFooterCalcMax"), value: "max" },
      { label: t("dashboard.tableFooterCalcCount"), value: "count" },
      { label: t("dashboard.tableFooterCalcLast"), value: "last" },
    ];
    const stateValueAlignModel = choiceModel(
      "state_value_align",
      STATE_VALUE_ALIGNS as readonly string[],
      "left",
    );
    const stateValueAlignOptions: { label: I18nText; value: string }[] = [
      { label: t("dashboard.alignLeft"), value: "left" },
      { label: t("dashboard.alignCenter"), value: "center" },
      { label: t("dashboard.alignRight"), value: "right" },
    ];
    const scatterFieldOptions = computed(() => [
      { label: t("dashboard.sortNone"), value: null },
      ...(
        dashboardPanelData.data.queries?.[dashboardPanelData.layout.currentQueryIndex]?.fields?.y ??
        []
      ).map((field: any) => ({
        label: raw(getFieldLabel(field, dashboardPanelData.data.config) || field?.alias || ""),
        value: field?.alias ?? null,
      })),
    ]);
    const legendsPositionModel = toggleModel("legends_position");
    const legendsTypeModel = toggleModel("legends_type");
    const chartAlignModel = toggleModel("chart_align");
    const toggleItemValue = (value: unknown) =>
      value === null || value === undefined ? TOGGLE_AUTO : value;

    const store = useStore();

    const basemapTypeOptions = [
      {
        label: raw("OpenStreetMap"),
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
        dashboardPanelData.data.config.legend_width.value = value !== "" ? value : null;
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
        dashboardPanelData.data.config.legend_height.value = value !== "" ? value : null;
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
    // Single source of truth — shared with the column-formatting dialog. Labels are
    // already translated; raw() only re-brands the `string` the helper widens to.
    const unitOptions = computed(() =>
      getUnitOptions(t, dashboardPanelData.data.config.unit).map((o) => ({
        ...o,
        label: raw(o.label),
      })),
    );
    const bucketUnitOptions = computed(() =>
      getUnitOptions(t, dashboardPanelData.data.config.bucket_unit).map((o) => ({
        ...o,
        label: raw(o.label),
      })),
    );

    const heatmapPaletteLabels: Record<string, I18nText> = {
      spectral: t("dashboard.heatmapPaletteSpectral"),
      viridis: t("dashboard.heatmapPaletteViridis"),
      magma: t("dashboard.heatmapPaletteMagma"),
      inferno: t("dashboard.heatmapPaletteInferno"),
      blues: t("dashboard.heatmapPaletteBlues"),
      greens: t("dashboard.heatmapPaletteGreens"),
      reds: t("dashboard.heatmapPaletteReds"),
      "rd-yl-bu": t("dashboard.heatmapPaletteRdYlBu"),
    };
    const heatmapPaletteOptions = Object.keys(HEATMAP_PALETTES).map((value) => ({
      label: heatmapPaletteLabels[value],
      value,
    }));
    const heatmapPaletteModel = computed({
      get: () => dashboardPanelData.data.config.heatmap_palette ?? DEFAULT_HEATMAP_PALETTE,
      set: (value: string) => {
        dashboardPanelData.data.config.heatmap_palette = value;
      },
    });
    const heatmapColorScaleLabels: Record<string, I18nText> = {
      linear: t("dashboard.heatmapColorScaleLinear"),
      sqrt: t("dashboard.heatmapColorScaleSqrt"),
      log: t("dashboard.heatmapColorScaleLog"),
    };
    const heatmapColorScaleOptions = HEATMAP_COLOR_SCALES.map((value) => ({
      label: heatmapColorScaleLabels[value],
      value,
    }));
    const heatmapColorScaleModel = computed({
      get: (): string =>
        dashboardPanelData.data.config.heatmap_color_scale ?? DEFAULT_HEATMAP_COLOR_SCALE,
      set: (value: string) => {
        dashboardPanelData.data.config.heatmap_color_scale = value;
      },
    });
    const heatmapHistogramModeModel = computed({
      get: () => dashboardPanelData.data.config.heatmap_mode === PROMETHEUS_HISTOGRAM_MODE,
      set: (on: SwitchValue) => {
        dashboardPanelData.data.config.heatmap_mode = on ? PROMETHEUS_HISTOGRAM_MODE : null;
      },
    });
    const heatmapYSortLabels: Record<string, I18nText> = {
      data: t("dashboard.heatmapYSortData"),
      asc: t("dashboard.heatmapYSortAsc"),
      desc: t("dashboard.heatmapYSortDesc"),
    };
    // The converter always orders bucket rows by value, so data order is not on offer then.
    const heatmapYBucketsActive = computed(
      () =>
        shouldShowHeatmapYBucket(dashboardPanelData, !!promqlMode.value) &&
        !!heatmapYBucketing(dashboardPanelData.data.config),
    );
    const heatmapYSortOptions = computed(() =>
      HEATMAP_Y_SORTS.filter((value) => !(heatmapYBucketsActive.value && value === "data")).map(
        (value) => ({ label: heatmapYSortLabels[value], value }),
      ),
    );
    const heatmapYSortModel = computed({
      get: (): string => {
        const sort = dashboardPanelData.data.config.heatmap_y_sort;
        if (heatmapYBucketsActive.value) return sort === "desc" ? "desc" : "asc";
        return sort ?? "data";
      },
      set: (value: string) => {
        dashboardPanelData.data.config.heatmap_y_sort = value === "data" ? null : value;
      },
    });
    const heatmapYBucketModeOptions = [
      { label: t("dashboard.heatmapYBucketNone"), value: "none" },
      { label: t("dashboard.heatmapYBucketSizeMode"), value: "size" },
      { label: t("dashboard.heatmapYBucketLogMode"), value: "log" },
    ];
    const toNumberOrNull = (value: unknown): number | null =>
      value === "" || value === null || value === undefined ? null : Number(value);
    const setHeatmapYBucket = (patch: Record<string, unknown>) => {
      dashboardPanelData.data.config.heatmap_y_bucket = {
        ...(dashboardPanelData.data.config.heatmap_y_bucket ?? {}),
        ...patch,
      };
    };
    const heatmapYBucketModeModel = computed({
      get: (): string => dashboardPanelData.data.config.heatmap_y_bucket?.mode ?? "none",
      set: (mode: string) => {
        if (mode === "none") {
          dashboardPanelData.data.config.heatmap_y_bucket = null;
          dashboardPanelData.data.config.heatmap_y_min = null;
          dashboardPanelData.data.config.heatmap_y_max = null;
        } else if (mode === "log") {
          setHeatmapYBucket({
            mode,
            base: dashboardPanelData.data.config.heatmap_y_bucket?.base ?? HEATMAP_Y_LOG_BASES[0],
          });
        } else {
          setHeatmapYBucket({ mode });
        }
      },
    });
    const heatmapYBucketBaseModel = computed({
      get: (): string =>
        String(dashboardPanelData.data.config.heatmap_y_bucket?.base ?? HEATMAP_Y_LOG_BASES[0]),
      set: (base: string) => setHeatmapYBucket({ base: Number(base) }),
    });

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
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields;
      return !!layoutFields?.weight;
    });

    const handleBlur = (field: any, key: any, value: any) => {
      if (!field[value]) {
        field[value] = key;
      }
    };

    const selectPromQlNameOption = (option: any) => {
      const inputValue =
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
          .promql_legend;

      // Find the index of the last opening brace '{'
      const openingBraceIndex = inputValue.lastIndexOf("{");

      //if { is not present add it at the start and than return

      const fieldName = (option as any)?.value ?? option;
      if (openingBraceIndex === -1) {
        const newValue = "{" + inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
        return newValue;
      } else {
        const newValue = inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
        return newValue;
      }
    };

    const dashboardSelectfieldPromQlList = computed(() => {
      // Get fields from groupedFields based on current query's stream
      const currentQuery =
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex];
      const currentStream = currentQuery?.fields?.stream;

      if (!currentStream) return [];

      // Find the current stream in groupedFields
      const streamFields = dashboardPanelData.meta.streamFields.groupedFields.find(
        (group: any) => group.name === currentStream,
      );

      if (!streamFields?.schema) return [];

      return streamFields.schema.map((it: any) => {
        return {
          label: raw(it.name),
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
        !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
          .time_shift
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
        "bar-gauge",
        "distribution",
        "treemap",
        "sunburst",
        "funnel",
        "boxplot",
        "node-graph",
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
        queries.length === 0 || queries.some((q: any) => (q?.fields?.breakdown?.length ?? 0) === 0)
      );
    });

    const hasTimeShifts = computed(() => {
      return (
        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].config
          .time_shift?.length > 0
      );
    });

    // Panel default time configuration (v4.0)
    const useDefaultTime = ref(!!dashboardPanelData.data.config?.panel_time_enabled);

    // Current panel time range (null = not set)
    const panelTimeRange = ref(dashboardPanelData.data.config?.panel_time_range ?? null);

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
          if (dashboardPanelData.data.config.table_pivot_show_row_totals === undefined) {
            dashboardPanelData.data.config.table_pivot_show_row_totals = false;
          }
          if (dashboardPanelData.data.config.table_pivot_show_col_totals === undefined) {
            dashboardPanelData.data.config.table_pivot_show_col_totals = false;
          }
          if (dashboardPanelData.data.config.table_pivot_sticky_row_totals === undefined) {
            dashboardPanelData.data.config.table_pivot_sticky_row_totals = false;
          }
          if (dashboardPanelData.data.config.table_pivot_sticky_col_totals === undefined) {
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

    const exemplarsSwitchEligible = computed(() => isExemplarEligible(dashboardPanelData.data));

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

    // "Use Top N" on a dashboard notice lands on the Top N input, opening its section first.
    const { pendingFocus, takeFocus } = usePanelEditorFocus();
    watch(
      pendingFocus,
      async () => {
        if (!takeFocus("top-n")) return;
        searchQuery.value = "";
        expandedSections.value.data = true;
        const el = await waitForElement(() => {
          const found = document.querySelector<HTMLElement>(
            '[data-test="dashboard-config-top_results"]',
          );
          return isShown(found) ? found : null;
        });
        if (el) revealAndFocus(el);
      },
      { immediate: true },
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

    const isHeatmapColorRangeInvalid = computed(() =>
      isHeatmapColorRangeInverted(dashboardPanelData.data.config),
    );

    const isHeatmapYRangeInvalid = computed(() =>
      isHeatmapYRangeInverted(dashboardPanelData.data.config),
    );

    // Mirrors the builder, which generates no query while these settings are rejected.
    const heatmapYBucketErrorMessage = computed(() => {
      const config = dashboardPanelData.data.config;
      const error = heatmapYBucketError(config);
      if (error === "invalidSize") return t("dashboard.heatmapYBucketSizeInvalid");
      if (error !== "tooManyBuckets") return undefined;
      const count = heatmapYBucketCount(
        { mode: "size", size: Number(config.heatmap_y_bucket.size) },
        heatmapYRangeOf(config),
      );
      return t("dashboard.heatmapYBucketTooMany", {
        count: addCommasToNumber(count ?? 0),
        max: addCommasToNumber(HEATMAP_MAX_ROWS),
      });
    });

    const thresholdStepCount = computed(
      () => dashboardPanelData.data.config.thresholds?.steps?.length ?? 0,
    );
    const hasColouredValueMappings = computed(() =>
      (dashboardPanelData.data.config.mappings ?? []).some(
        (mapping: { color?: string | null; textColor?: string | null }) =>
          !!(mapping?.color || mapping?.textColor),
      ),
    );
    // Override steps still draw when the panel steps are cleared, so point the user at them.
    const seriesOverrideEntries = computed(() =>
      getSeriesOverrideEntries(dashboardPanelData.data.config.override_config),
    );
    const overridesWithStepsCount = computed(
      () =>
        seriesOverrideEntries.value.filter((entry) =>
          entry.config.some(
            (item: any) => item?.type === "thresholds" && !!item?.value?.steps?.length,
          ),
        ).length,
    );
    const seriesOverrideCount = computed(() => seriesOverrideEntries.value.length);
    // Removing the last step deletes the key so the panel saves exactly as before thresholds existed.
    const onThresholdsUpdate = (value: object | undefined) => {
      if (value === undefined) delete dashboardPanelData.data.config.thresholds;
      else dashboardPanelData.data.config.thresholds = value;
    };

    return {
      raw,
      isHeatmapColorRangeInvalid,
      axisLabelModeModel,
      axisLabelModeOptions,
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
      showStateTextModel,
      rowSortModel,
      rowSortOptions,
      tooltipModeModel,
      setNumberConfig,
      setFlagConfig,
      setDefaultOnFlag,
      isRowTimeline,
      setListConfig,
      statChangeModel,
      statChangeOptions,
      statChangeColorModel,
      statChangeColorOptions,
      statTextModeModel,
      statTextModeOptions,
      gaugeStyleModel,
      gaugeStyleOptions,
      barGaugeModeModel,
      barGaugeModeOptions,
      barGaugeOrientationModel,
      barGaugeOrientationOptions,
      funnelSortModel,
      funnelSortOptions,
      funnelOrientModel,
      funnelOrientOptions,
      boxplotWhiskerModel,
      boxplotWhiskerOptions,
      nodeGraphLayoutModel,
      nodeGraphLayoutOptions,
      pieLabelContentModel,
      pieLabelContentOptions,
      tableDensityModel,
      tableDensityOptions,
      tableFooterCalcsModel,
      tableFooterCalcOptions,
      stateValueAlignModel,
      stateValueAlignOptions,
      setTextConfig,
      chartTooltipModeModel,
      chartTooltipModeOptions,
      tooltipSortModel,
      tooltipSortOptions,
      sortOrderModel,
      sortOrderOptions,
      yAxisScaleModel,
      yAxisScaleOptions,
      yAxisLogBaseModel,
      yAxisLogBaseOptions,
      stackModeModel,
      stackModeOptions,
      lineStyleModel,
      lineStyleOptions,
      scatterFieldOptions,
      shouldShowStackMode,
      shouldShowSortOrder,
      shouldShowBarRadius,
      shouldShowScatterEncoding,
      shouldShowConnectNullsThreshold,
      shouldShowCartesianSeriesConfig,
      tooltipModeOptions,
      unitOptions,
      bucketUnitOptions,
      heatmapPaletteOptions,
      heatmapPaletteModel,
      heatmapColorScaleOptions,
      heatmapColorScaleModel,
      heatmapHistogramModeModel,
      heatmapYSortOptions,
      heatmapYSortModel,
      heatmapYBucketModeOptions,
      heatmapYBucketModeModel,
      heatmapYBucketBaseModel,
      heatmapYLogBases: HEATMAP_Y_LOG_BASES,
      heatmapYBucketErrorMessage,
      isHeatmapYRangeInvalid,
      setHeatmapYBucket,
      toNumberOrNull,
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
      shouldShowAxisBorderConfig,
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
      exemplarsSwitchEligible,
      isConfigOptionVisible,
      anySectionVisible,
      allSectionsExpanded,
      toggleAllSections,
      isPivotMode,
      decimalsTouched,
      SECTION_ICONS,
      shouldShowHeatmapYBucket,
      shouldShowHeatmapYSort,
      shouldShowThresholds,
      thresholdStepCount,
      hasColouredValueMappings,
      onThresholdsUpdate,
      shouldShowSeriesOverrides,
      seriesOverrideCount,
      overridesWithStepsCount,
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
