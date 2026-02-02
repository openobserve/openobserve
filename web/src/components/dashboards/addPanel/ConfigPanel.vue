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
  <div
    v-if="dashboardPanelData.data.type == 'custom_chart'"
    style="padding-bottom: 30px"
  >
    <div class="" style="max-width: 300px">
      <div class="q-mb-sm" style="font-weight: 600">
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
  <div v-else style="padding-bottom: 30px">
    <div class="" style="max-width: 300px">
      <div class="q-mb-sm" style="font-weight: 600">
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

    <div class="space"></div>

    <q-input
      v-if="promqlMode"
      v-model="dashboardPanelData.data.config.step_value"
      type="text"
      color="input-border"
      bg-color="input-bg"
      class="q-py-sm showLabelOnTop"
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

    <div class="space"></div>

    <!-- PromQL Chart-Specific Configuration -->
    <PromQLChartConfig
      v-if="promqlMode"
      :chart-type="dashboardPanelData.data.type"
    />

    <div class="space"></div>

    <div v-if="showTrellisConfig" class="q-mb-sm">
      <q-select
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
                <b>
                  {{
                    hasTimeShifts
                      ? t("dashboard.trellisTimeShiftTooltip")
                      : t("dashboard.trellisTooltip")
                  }}</b
                >
              </q-tooltip>
            </div>
          </div>
        </template>
      </q-select>

      <template
        v-if="dashboardPanelData.data.config.trellis?.layout === 'custom'"
      >
        <q-input
          borderless
          v-model.number="dashboardPanelData.data.config.trellis.num_of_columns"
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
                  <b>
                    {{
                      hasTimeShifts
                        ? t("dashboard.trellisTimeShiftTooltip")
                        : t("dashboard.trellisTooltip")
                    }}</b
                  >
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>
      </template>

      <div class="space"></div>

      <div
        v-if="
          dashboardPanelData.data.config.trellis?.layout &&
          !(isBreakdownFieldEmpty || hasTimeShifts)
        "
        class="row items-center"
      >
        <q-toggle
          v-model="dashboardPanelData.data.config.trellis.group_by_y_axis"
          :label="t('dashboard.groupMultiYAxisTrellis')"
          data-test="dashboard-config-trellis-group-by-y-axis"
          class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
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
          <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
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
          </q-tooltip>
        </div>
      </div>
    </div>

    <q-toggle
      v-if="shouldShowLegendsToggle(dashboardPanelData)"
      v-model="dashboardPanelData.data.config.show_legends"
      :label="t('dashboard.showLegendsLabel')"
      data-test="dashboard-config-show-legend"
      class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
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
    />

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

      <div class="space"></div>

      <div class="input-container">
        <!-- Legend Width Configuration (for right position) -->
        <q-input
          v-if="shouldShowLegendWidth(dashboardPanelData)"
          v-model.number="legendWidthValue"
          :label="t('common.legendWidth')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop q-mr-sm"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          placeholder="Auto"
          data-test="dashboard-config-legend-width"
          hide-bottom-space
        ></q-input>

        <!-- Legend Height Configuration (for auto/bottom position) -->
        <q-input
          v-if="shouldShowLegendHeight(dashboardPanelData)"
          v-model.number="legendHeightValue"
          :label="t('dashboard.legendHeight')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop q-mr-sm"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          placeholder="Auto"
          data-test="dashboard-config-legend-height"
          hide-bottom-space
        ></q-input>
        <!-- dashboardPanelData.data.config.legends_type != 'scroll' -->
        <!-- Unit container for Legend Width (right position) -->
        <div
          class="unit-container"
          v-if="shouldShowLegendWidthUnitContainer(dashboardPanelData)"
        >
          <button
            @click="setUnit('px')"
            :class="{
              active:
                dashboardPanelData?.data?.config.legend_width?.unit === null ||
                dashboardPanelData?.data?.config?.legend_width?.unit === 'px',
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
                dashboardPanelData?.data?.config?.legend_width?.unit === '%',
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

        <!-- Unit container for Legend Height (auto/bottom position) -->
        <div
          class="unit-container"
          v-if="shouldShowLegendHeightUnitContainer(dashboardPanelData)"
        >
          <button
            @click="setHeightUnit('px')"
            :class="{
              active:
                dashboardPanelData?.data?.config.legend_height?.unit === null ||
                dashboardPanelData?.data?.config?.legend_height?.unit === 'px',
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
                dashboardPanelData?.data?.config?.legend_height?.unit === '%',
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

      <div class="space"></div>

      <q-select
        v-if="shouldApplyChartAlign(dashboardPanelData)"
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

      <div class="space"></div>

      <q-select
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
      <!-- :rules="[(val: any) => !!val || 'Field is required!']" -->
      <q-input
        v-if="dashboardPanelData.data.config.unit == 'custom'"
        v-model="dashboardPanelData.data.config.unit_custom"
        :label="t('dashboard.customunitLabel')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        dense
        label-slot
        data-test="dashboard-config-custom-unit"
        borderless
        hide-bottom-space
      />
      <div class="space"></div>
      <q-input
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
        class="q-py-md showLabelOnTop"
        stack-label
        hide-bottom-space
        dense
        label-slot
        data-test="dashboard-config-decimals"
      />

      <div class="space"></div>

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

      <div class="space"></div>

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

      <div class="space"></div>

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
          @blur="handleBlur(dashboardPanelData.data.config.map_view, 1, 'zoom')"
          :label="t('dashboard.zoomLabel')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          borderless
          dense
          label-slot
          :type="'number'"
          data-test="dashboard-config-zoom"
          hide-bottom-space
        >
        </q-input>

        <!-- symbol size -->
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

        <div class="space"></div>

        <div class="row">
          <q-input
            v-if="
              dashboardPanelData.data.config.map_symbol_style.size ===
              'by Value'
            "
            v-model.number="
              dashboardPanelData.data.config.map_symbol_style.size_by_value.min
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
              dashboardPanelData.data.config.map_symbol_style.size_by_value.max
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
      </div>

      <div class="space"></div>

      <!-- <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label dense label-slot borderless hide-bottom-space> -->
      <div
        v-if="
          promqlMode && dashboardPanelData.data.type != 'geomap' && dashboardPanelData.data.type != 'maps'
        "
        class="q-py-md showLabelOnTop"
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
      <!-- </q-input> -->
      <div class="space"></div>

      <!-- for auto sql query limit -->
      <!-- it should not be promql and custom query -->
      <q-input
        v-if="
          !promqlMode &&
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery
        "
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
        class="q-py-sm showLabelOnTop"
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

      <div class="space"></div>
      <q-input
        v-if="
          [
            'area',
            'bar',
            'line',
            'h-bar',
            'h-stacked',
            'scatter',
            'area-stacked',
            'stacked',
          ].includes(dashboardPanelData.data.type) && !promqlMode
        "
        v-model.number="dashboardPanelData.data.config.top_results"
        :min="0"
        @update:model-value="
          (value: any) =>
            (dashboardPanelData.data.config.top_results = value ? value : null)
        "
        :label="t('dashboard.topResults')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop"
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
        ><template v-slot:label>
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
        </template></q-input
      >

      <div
        class="row items-center"
        v-if="
          [
            'area',
            'bar',
            'line',
            'h-bar',
            'h-stacked',
            'scatter',
            'area-stacked',
            'stacked',
          ].includes(dashboardPanelData.data.type) && !promqlMode
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
          class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
          size="lg"
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-lg-dark'
              : 'o2-toggle-button-lg-light'
          "
        />

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
      </div>

      <div class="space"></div>

      <CommonAutoComplete
        v-if="promqlMode && dashboardPanelData.data.type != 'geomap' && dashboardPanelData.data.type != 'maps'"
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

      <div class="space"></div>

      <q-toggle
        v-if="
          ['area', 'line', 'area-stacked'].includes(
            dashboardPanelData.data.type,
          )
        "
        v-model="dashboardPanelData.data.config.connect_nulls"
        :label="t('dashboard.connectNullValues')"
        data-test="dashboard-config-connect-null-values"
        class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
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
          ['area', 'line', 'area-stacked', 'bar', 'stacked'].includes(
            dashboardPanelData.data.type,
          ) && !promqlMode
        "
        v-model="dashboardPanelData.data.config.no_value_replacement"
        :label="t('dashboard.noValueReplacement')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        dense
        label-slot
        placeholder="-"
        data-test="dashboard-config-no-value-replacement"
        borderless
        hide-bottom-space
        ><template v-slot:label>
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
        </template></q-input
      >

      <div class="space"></div>
      <q-select
        v-if="dashboardPanelData.data.type == 'geomap'"
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

      <div class="space"></div>

      <q-input
        v-if="dashboardPanelData.data.type == 'geomap' && !isWeightFieldPresent"
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
        class="q-py-md showLabelOnTop"
        stack-label
        borderless
        dense
        label-slot
        :type="'number'"
        data-test="dashboard-config-weight"
        hide-bottom-space
      >
      </q-input>

      <q-input
        v-if="dashboardPanelData.data.type === 'gauge'"
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
        class="q-py-md showLabelOnTop"
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
        v-if="dashboardPanelData.data.type === 'gauge'"
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
        class="q-py-md showLabelOnTop"
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

      <q-input
        v-if="
          dashboardPanelData.data.type != 'gauge' &&
          dashboardPanelData.data.type != 'metric' &&
          dashboardPanelData.data.type != 'geomap' &&
          dashboardPanelData.data.type != 'table' &&
          dashboardPanelData.data.type != 'pie' &&
          dashboardPanelData.data.type != 'donut' &&
          dashboardPanelData.data.type != 'sankey' &&
          dashboardPanelData.data.type != 'maps'
        "
        v-model.number="dashboardPanelData.data.config.axis_width"
        :label="t('common.axisWidth')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
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

      <div class="space"></div>

      <q-toggle
        v-if="
          dashboardPanelData.data.type != 'gauge' &&
          dashboardPanelData.data.type != 'metric' &&
          dashboardPanelData.data.type != 'geomap' &&
          dashboardPanelData.data.type != 'table' &&
          dashboardPanelData.data.type != 'pie' &&
          dashboardPanelData.data.type != 'donut' &&
          dashboardPanelData.data.type != 'sankey' &&
          dashboardPanelData.data.type != 'maps'
        "
        v-model="dashboardPanelData.data.config.axis_border_show"
        :label="t('dashboard.showBorder')"
        data-test="dashboard-config-axis-border"
        class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
        size="lg"
        :class="
          store.state.theme === 'dark'
            ? 'o2-toggle-button-lg-dark'
            : 'o2-toggle-button-lg-light'
        "
      />

      <div class="space"></div>

      <div
        style="width: 100%; display: flex; gap: 16px"
        v-if="
          [
            'area',
            'area-stacked',
            'bar',
            'h-bar',
            'line',
            'scatter',
            'stacked',
            'h-stacked',
          ].includes(dashboardPanelData.data.type)
        "
      >
        <q-input
          v-model.number="dashboardPanelData.data.config.y_axis_min"
          color="input-border"
          bg-color="input-bg"
          style="width: 50%"
          class="q-py-md showLabelOnTop"
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
          ><template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("common.yAxisMin") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-y_axis_min-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  <b>{{ t("dashboard.yAxisMinTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.yAxisMinTooltipDescription") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>
        <q-input
          v-model.number="dashboardPanelData.data.config.y_axis_max"
          color="input-border"
          bg-color="input-bg"
          style="width: 50%"
          class="q-py-md showLabelOnTop"
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
          ><template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("common.yAxisMax") }}
              <div>
                <q-icon
                  class="q-ml-xs"
                  size="20px"
                  name="info"
                  data-test="dashboard-config-y_axis_max-info"
                />
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                >
                  <b>{{ t("dashboard.yAxisMaxTooltipTitle") }}</b>
                  <br />
                  {{ t("dashboard.yAxisMaxTooltipDescription") }}
                </q-tooltip>
              </div>
            </div>
          </template>
        </q-input>
      </div>
      <div class="space"></div>

      <q-select
        v-if="
          [
            'area',
            'area-stacked',
            'bar',
            'h-bar',
            'line',
            'scatter',
            'stacked',
            'h-stacked',
          ].includes(dashboardPanelData.data.type)
        "
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

      <div class="space"></div>

      <div class="space"></div>

      <q-toggle
        v-if="shouldShowGridlines(dashboardPanelData)"
        v-model="dashboardPanelData.data.config.show_gridlines"
        :label="t('dashboard.showGridlines')"
        data-test="dashboard-config-show-gridlines"
        class="tw:h-[36px] -tw:ml-3 o2-toggle-button-lg"
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
          [
            'area',
            'area-stacked',
            'bar',
            'h-bar',
            'line',
            'scatter',
            'stacked',
            'h-stacked',
          ].includes(dashboardPanelData.data.type)
        "
        v-model.number="dashboardPanelData.data.config.label_option.rotate"
        :label="t('dashboard.labelRotate')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
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

      <div class="space"></div>

      <div
        style="width: 100%; display: flex; gap: 16px"
        v-if="
          [
            'area',
            'area-stacked',
            'bar',
            'line',
            'scatter',
            'stacked',
          ].includes(dashboardPanelData.data.type)
        "
      >
        <q-input
          v-model.number="dashboardPanelData.data.config.axis_label_rotate"
          color="input-border"
          bg-color="input-bg"
          style="width: 50%"
          class="q-py-md showLabelOnTop"
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
            <div style="display: flex; align-items: center; gap: 4px;">
              <span>Label Rotate</span>
              <q-icon
                name="info"
                size="20px"
                style="cursor: pointer;"
                data-test="dashboard-config-axis-label-rotate-info"
              >
                <q-tooltip
                  anchor="top middle"
                  self="bottom middle"
                  :offset="[0, 8]"
                  class="bg-grey-8"
                >
                  <div>
                    Rotate the x-axis label text by a chosen angle (in degrees) to improve readability when labels are long or crowded.
                    <br /><br />
                    <strong>Note:</strong> This option is not supported for time-series x-axis fields.
                  </div>
                </q-tooltip>
              </q-icon>
            </div>
          </template>
        </q-input>
        <q-input
          v-model.number="dashboardPanelData.data.config.axis_label_truncate_width"
          color="input-border"
          bg-color="input-bg"
          style="width: 50%"
          class="q-py-md showLabelOnTop"
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
            <div style="display: flex; align-items: center; gap: 4px;">
              <span>Label Truncate</span>
              <q-icon
                name="info"
                size="20px"
                style="cursor: pointer;"
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
                    <strong>Note:</strong> This option is not supported for time-series x-axis fields.
                  </div>
                </q-tooltip>
              </q-icon>
            </div>
          </template>
        </q-input>
      </div>

      <div class="space"></div>

      <q-select
        v-if="
          ['area', 'area-stacked', 'line'].includes(
            dashboardPanelData.data.type,
          )
        "
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

      <div class="space"></div>

      <q-select
        v-if="
          ['area', 'area-stacked', 'line'].includes(
            dashboardPanelData.data.type,
          )
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
                  it.value == dashboardPanelData.data.config.line_interpolation,
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
      <div class="space"></div>

      <q-input
        v-if="
          !promqlMode &&
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery &&
          ['area', 'area-stacked', 'line'].includes(
            dashboardPanelData.data.type,
          )
        "
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
        class="q-py-sm showLabelOnTop"
        stack-label
        borderless
        dense
        label-slot
        :placeholder="t('dashboard.lineThicknessDefault')"
        :type="'number'"
        data-test="dashboard-config-line_thickness"
      >
      </q-input>

      <div class="space"></div>

      <Drilldown
        v-if="
          !['html', 'markdown', 'geomap', 'maps'].includes(
            dashboardPanelData.data.type,
          ) && dashboardPanelDataPageKey !== 'logs'
        "
        :variablesData="variablesData"
      />

      <div class="space"></div>
      <ValueMapping v-if="dashboardPanelData.data.type == 'table'" />

      <div class="space"></div>
      <MarkLineConfig
        v-if="
          [
            'area',
            'area-stacked',
            'bar',
            'h-bar',
            'line',
            'scatter',
            'stacked',
            'h-stacked',
          ].includes(dashboardPanelData.data.type)
        "
      />
    </div>

    <div
      v-if="
        [
          'area',
          'bar',
          'line',
          'h-bar',
          'h-stacked',
          'scatter',
          'area-stacked',
          'stacked',
        ].includes(dashboardPanelData.data.type) &&
        !promqlMode &&
        dashboardPanelDataPageKey !== 'logs'
      "
    >
      <div class="flex items-center q-mr-sm">
        <div
          data-test="scheduled-dashboard-period-title"
          class="text-bold q-py-md flex items-center"
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
        class="q-mb-md"
      />
      <div
        v-for="(picker, index) in dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift"
        :key="index"
        class="q-mb-md"
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

    <div class="space"></div>
    <ColorPaletteDropDown v-if="showColorPalette" />
    <div class="space"></div>
    <ColorBySeries :colorBySeriesData="panelData" v-if="showColorPalette" />
    <div class="space"></div>
    <OverrideConfig
      v-if="dashboardPanelData.data.type == 'table'"
      :dashboardPanelData="dashboardPanelData"
      :panelData="panelData"
    />
    <div class="space"></div>

    <BackGroundColorConfig v-if="dashboardPanelData.data.type == 'metric'" />
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { computed, defineComponent, inject, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import Drilldown from "./Drilldown.vue";
import ValueMapping from "./ValueMapping.vue";
import ColorBySeries from "./ColorBySeries.vue";
import MarkLineConfig from "./MarkLineConfig.vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
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

import { markRaw, watchEffect } from "vue";
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
} from "@/utils/dashboard/configUtils";

export default defineComponent({
  components: {
    Drilldown,
    ValueMapping,
    ColorBySeries,
    CommonAutoComplete,
    MarkLineConfig,
    CustomDateTimePicker,
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
    const { dashboardPanelData, promqlMode } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

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
  align-items: center;
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
  font-size: 16px;
  padding: 3px 10px;
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
  display: flex;
  height: 36px;
  margin-top: 9px;
  width: 100px;
}
</style>
