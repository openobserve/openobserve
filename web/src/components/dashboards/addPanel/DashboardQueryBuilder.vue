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
    v-if="
      !promqlMode &&
      !promqlBuilderMode &&
      dashboardPanelData.data.type != 'geomap' &&
      dashboardPanelData.data.type != 'maps' &&
      dashboardPanelData.data.type != 'sankey'
    "
  >
    <!-- x axis container -->
    <div
      class="pl-3 flex flex-row w-full"
      v-if="dashboardPanelData.data.type != 'metric'"
    >
      <div class="flex-1">
        <div class="flex flex-row">
          <div class="layout-name whitespace-nowrap flex items-center" :class="labelWidthClass">
            <span
              class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-indigo-ol-text"
              aria-hidden="true"
            ></span>
            {{ currentXLabel }}
            <OIcon name="info-outline" size="sm" class="ml-1" />
              <OTooltip :content="xAxisHint" />
          </div>
          <span class="layout-separator flex items-center mx-0.5">:</span>
          <div
            class="axis-container droppable scroll flex flex-1 w-full text-center flex-wrap items-center min-h-10 border-2 border-dashed border-transparent"
            :class="{
              'bg-[rgba(0,0,0,0.042)] [border-style:dotted] border-white': dashboardPanelData.meta.dragAndDrop.dragging,
              'transition-all duration-200 bg-field-list-row-hover-bg':
                dashboardPanelData.meta.dragAndDrop.dragging &&
                dashboardPanelData.meta.dragAndDrop.currentDragArea == 'x',
            }"
            @dragover="onDragOver($event, 'x')"
            @drop="
              onDrop(
                $event,
                'x',
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.x?.length || 0,
              )
            "
            @dragenter="onDragEnter($event, 'x', null)"
            @dragend="onDragEnd()"
            data-test="dashboard-x-layout"
          >
            <div
              class="flex mr-2 my-0.5"
              v-for="(itemX, index) in dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.x"
              :key="index"
            >
              <div
                v-if="
                  dashboardPanelData.meta.dragAndDrop.targetDragIndex ==
                    index &&
                  dashboardPanelData.meta.dragAndDrop.currentDragArea == 'x'
                "
                class="dragItem bg-theme-accent w-5 h-full rounded-default opacity-70"
                data-test="dashboard-query-builder-drag-item"
              >
                &nbsp;
              </div>
              <OButtonGroup
                class="axis-field overflow-hidden border border-border-default border-s-2 border-s-badge-indigo-ol-border bg-surface-panel"
                radius="sm"
                :divided="false"
                :draggable="true"
                @dragstart="onFieldDragStart($event, itemX, 'x', Number(index))"
                @drop="onDrop($event, 'x', Number(index))"
                @dragenter="onDragEnter($event, 'x', index)"
              >
                <OButton
                  variant="ghost"
                  size="icon-chip"
                  class="cursor-grab !w-4"
                  :data-test="`dashboard-x-item-${itemX?.alias}-drag`"
                >
                  <template #icon-left>
                    <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
                  </template>
                </OButton>
                <ODropdown>
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="chip-12"
                      class="!ps-1"
                      :data-test="`dashboard-x-item-${itemX?.alias}`"
                    >
                      <AxisFieldChipLabel :label="xLabel[index]" />
                      <template #icon-right
><OIcon name="arrow-drop-down" size="sm"
                      /></template>
                    </OButton>
                  </template>
                  <div
                    :data-test="`dashboard-x-item-${itemX?.alias}-menu`"
                    class="field-function-menu-popup dashboard-query-builder-dropdown p-2"
                    :style="{
                      width:
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery ||
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.x[index].isDerived
                          ? 'auto'
                          : FIELD_FUNCTION_MENU_WIDTH,
                    }"
                  >
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.x[index]
                      "
                      :allowAggregation="false"
                      :customQuery="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </ODropdown>
                <OButton
                  variant="ghost"
                  size="icon-chip"
                  class="!w-4"
                  :data-test="`dashboard-x-item-${itemX?.alias}-remove`"
                  @click="removeXAxisItemByIndex(Number(index))"
                >
                  <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
                </OButton>
              </OButtonGroup>
            </div>
            <div
              class="text-xs font-bold text-center py-1 w-full flex justify-center items-center"
              v-if="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.x?.length < 1
              "
            >
              <div class="mt-1">{{ xAxisHint }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- b axis container -->
      <div class="flex-1"
        v-if="
          dashboardPanelData.data.type == 'table' ||
          dashboardPanelData.data.type == 'area' ||
          dashboardPanelData.data.type == 'bar' ||
          dashboardPanelData.data.type == 'line' ||
          dashboardPanelData.data.type == 'h-bar' ||
          dashboardPanelData.data.type == 'h-stacked' ||
          dashboardPanelData.data.type == 'scatter' ||
          dashboardPanelData.data.type == 'area-stacked' ||
          dashboardPanelData.data.type == 'stacked'
        "
      >
        <div class="pl-3 h-full flex flex-row">
          <!-- Separator between X and Breakdown/Pivot -->
          <OSeparator vertical class="mr-4" />
          <div class="layout-name whitespace-nowrap min-w-0 flex items-center">
            <span
              class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-orange-ol-text"
              aria-hidden="true"
            ></span>
            {{
              dashboardPanelData.data.type == "table"
                ? t("panel.pivotField")
                : t("panel.breakdown")
            }}
            <OIcon name="info-outline" size="sm" class="ml-1" />
              <OTooltip side="top" align="center">
                <template #content>
                  <span v-if="dashboardPanelData.data.type == 'table'">{{
                    t("panel.pivotFieldTooltip")
                  }}</span>
                  <span
                    v-else-if="
                      dashboardPanelData.data.type == 'h-bar' ||
                      dashboardPanelData.data.type == 'h-stacked'
                    "
                  >{{ t("panel.breakdownTooltipHBar") }}</span
                  >
                  <span v-else>{{ t("panel.breakdownTooltipDefault") }}</span>
                </template>
              </OTooltip>
          </div>
          <span class="layout-separator flex items-center mx-0.5">:</span>
          <div
            class="axis-container droppable scroll flex flex-1 w-full text-center flex-wrap items-center min-h-10 border-2 border-dashed border-transparent"
            :class="{
              'bg-[rgba(0,0,0,0.042)] [border-style:dotted] border-white': dashboardPanelData.meta.dragAndDrop.dragging,
              'transition-all duration-200 bg-field-list-row-hover-bg':
                dashboardPanelData.meta.dragAndDrop.dragging &&
                dashboardPanelData.meta.dragAndDrop.currentDragArea ==
                  'breakdown',
            }"
            @dragover="onDragOver($event, 'breakdown')"
            @drop="
              onDrop(
                $event,
                'breakdown',
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.breakdown?.length || 0,
              )
            "
            @dragenter="onDragEnter($event, 'breakdown', null)"
            @dragend="onDragEnd()"
            data-test="dashboard-b-layout"
          >
            <div
              class="flex mr-2 my-0.5"
              v-for="(itemB, index) in dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.breakdown"
              :key="index"
            >
              <div
                v-if="
                  dashboardPanelData.meta.dragAndDrop.targetDragIndex ==
                    index &&
                  dashboardPanelData.meta.dragAndDrop.currentDragArea ==
                    'breakdown'
                "
                class="dragItem bg-theme-accent w-5 h-full rounded-default opacity-70"
                data-test="dashboard-query-builder-drag-item"
              >
                &nbsp;
              </div>
              <OButtonGroup
                class="axis-field overflow-hidden border border-border-default border-s-2 border-s-badge-orange-ol-border bg-surface-panel"
                radius="sm"
                :divided="false"
                :draggable="true"
                @dragstart="
                  onFieldDragStart($event, itemB, 'breakdown', Number(index))
                "
                @drop="onDrop($event, 'breakdown', Number(index))"
                @dragenter="onDragEnter($event, 'breakdown', index)"
              >
                <OButton
                  variant="ghost"
                  size="icon-chip"
                  class="cursor-grab !w-4"
                  :data-test="`dashboard-b-item-${itemB?.alias}-drag`"
                >
                  <template #icon-left>
                    <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
                  </template>
                </OButton>
                <ODropdown>
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="chip-12"
                      class="!ps-1"
                      :data-test="`dashboard-b-item-${itemB?.alias}`"
                    >
                      <AxisFieldChipLabel :label="bLabel[index]" />
                      <template #icon-right
><OIcon name="arrow-drop-down" size="sm"
                      /></template>
                    </OButton>
                  </template>
                  <div
                    :data-test="`dashboard-b-item-${itemB?.alias}-menu`"
                    class="field-function-menu-popup dashboard-query-builder-dropdown p-2"
                    :style="{
                      width:
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery ||
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.breakdown[index].isDerived
                          ? 'auto'
                          : FIELD_FUNCTION_MENU_WIDTH,
                    }"
                  >
                    <DynamicFunctionPopUp
                      v-model="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.breakdown[index]
                      "
                      :allowAggregation="false"
                      :customQuery="
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery
                      "
                      :chartType="dashboardPanelData.data.type"
                    />
                  </div>
                </ODropdown>
                <OButton
                  variant="ghost"
                  size="icon-chip"
                  class="!w-4"
                  :data-test="`dashboard-b-item-${itemB?.alias}-remove`"
                  @click="removeBreakdownItemByIndex(Number(index))"
                >
                  <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
                </OButton>
              </OButtonGroup>
            </div>
            <div
              class="text-xs font-bold text-center py-1 w-full flex justify-center items-center"
              v-if="
                !dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.breakdown?.length
              "
            >
              <div class="mt-1">{{ bAxisHint }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <OSeparator v-if="dashboardPanelData.data.type != 'metric'" />
    <!-- y axis container -->
    <div class="pl-3 flex flex-row">
      <div class="layout-name whitespace-nowrap flex items-center" :class="labelWidthClass">
        <span
          class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-success-ol-text"
          aria-hidden="true"
        ></span>
        {{ currentYLabel }}
        <OIcon name="info-outline" size="sm" class="ml-1" />
          <OTooltip :content="yAxisHint" />
      </div>
      <span class="layout-separator flex items-center mx-0.5">:</span>
      <div
        class="axis-container droppable scroll flex flex-1 w-full text-center flex-wrap items-center min-h-10 border-2 border-dashed border-transparent"
        :class="{
          'bg-[rgba(0,0,0,0.042)] [border-style:dotted] border-white': dashboardPanelData.meta.dragAndDrop.dragging,
          'transition-all duration-200 bg-field-list-row-hover-bg':
            dashboardPanelData.meta.dragAndDrop.dragging &&
            dashboardPanelData.meta.dragAndDrop.currentDragArea == 'y',
        }"
        @dragover="onDragOver($event, 'y')"
        @drop="
          onDrop(
            $event,
            'y',
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.y?.length || 0,
          )
        "
        @dragenter="onDragEnter($event, 'y', null)"
        @dragend="onDragEnd()"
        data-test="dashboard-y-layout"
      >
        <div
          class="flex mr-2 my-0.5"
          v-for="(itemY, index) in dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.y"
          :key="index"
        >
          <div
            v-if="
              dashboardPanelData.meta.dragAndDrop.targetDragIndex == index &&
              dashboardPanelData.meta.dragAndDrop.currentDragArea == 'y'
            "
            class="dragItem bg-theme-accent w-5 h-full rounded-default opacity-70"
            data-test="dashboard-query-builder-drag-item"
          >
            &nbsp;
          </div>
          <OButtonGroup
            class="axis-field overflow-hidden border border-border-default border-s-2 border-s-badge-success-ol-border bg-surface-panel"
            radius="sm"
                :divided="false"
            :draggable="true"
            @dragstart="onFieldDragStart($event, itemY, 'y', Number(index))"
            @drop="onDrop($event, 'y', Number(index))"
            @dragenter="onDragEnter($event, 'y', index)"
          >
            <OButton
              variant="ghost"
              size="icon-chip"
              class="cursor-grab !w-4"
              :data-test="`dashboard-y-item-${itemY?.alias}-drag`"
            >
              <template #icon-left>
                <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
              </template>
            </OButton>
            <ODropdown>
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="chip-12"
                  class="!ps-1"
                  :data-test="`dashboard-y-item-${itemY?.alias}`"
                >
                  <AxisFieldChipLabel :label="yLabel[index]" />
                  <template #icon-right
><OIcon name="arrow-drop-down" size="sm"
                  /></template>
                </OButton>
              </template>
              <div
                :data-test="`dashboard-y-item-${itemY?.alias}-menu`"
                class="field-function-menu-popup dashboard-query-builder-dropdown p-2"
                :style="{
                  width:
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery ||
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.y[index].isDerived
                      ? 'auto'
                      : FIELD_FUNCTION_MENU_WIDTH,
                }"
              >
                <DynamicFunctionPopUp
                  v-model="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.y[index]
                  "
                  :allowAggregation="
                    dashboardPanelData.data.type == 'heatmap'
                      ? false
                      : true
                  "
                  :customQuery="
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].customQuery
                  "
                  :chartType="dashboardPanelData.data.type"
                />
              </div>
            </ODropdown>
            <OButton
              variant="ghost"
              size="icon-chip"
              class="!w-4"
              :data-test="`dashboard-y-item-${itemY?.alias}-remove`"
              @click="removeYAxisItemByIndex(Number(index))"
            >
              <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
            </OButton>
          </OButtonGroup>
        </div>
        <div
          class="text-xs font-bold text-center py-1 w-full flex justify-center items-center"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.y?.length < 1
          "
        >
          <div class="mt-1">{{ yAxisHint }}</div>
        </div>
      </div>
    </div>
    <!-- z axis container -->
    <span v-if="dashboardPanelData.data.type === 'heatmap'">
      <OSeparator />
      <div class="pl-3 flex flex-row">
        <div class="layout-name whitespace-nowrap flex items-center" :class="labelWidthClass">
          <span
            class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-success-ol-text"
            aria-hidden="true"
          ></span>
          {{
            dashboardPanelData.data.type == "heatmap" ? t("panel.zAxis") : ""
          }}
          <OIcon name="info-outline" size="sm" class="ml-1" />
            <OTooltip :content="zAxisHint" />
        </div>
        <span class="layout-separator flex items-center mx-0.5">:</span>
        <div
          class="axis-container droppable scroll flex flex-1 w-full text-center flex-wrap items-center min-h-10 border-2 border-dashed border-transparent"
          :class="{
            'bg-[rgba(0,0,0,0.042)] [border-style:dotted] border-white': dashboardPanelData.meta.dragAndDrop.dragging,
            'transition-all duration-200 bg-field-list-row-hover-bg':
              dashboardPanelData.meta.dragAndDrop.dragging &&
              dashboardPanelData.meta.dragAndDrop.currentDragArea == 'z',
          }"
          @dragover="onDragOver($event, 'z')"
          @drop="
            onDrop(
              $event,
              'z',
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.z?.length || 0,
            )
          "
          @dragenter="onDragEnter($event, 'z', null)"
          @dragend="onDragEnd()"
          data-test="dashboard-z-layout"
        >
          <div
            class="flex mr-2 my-0.5"
            v-for="(itemZ, index) in dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.z"
            :key="index"
          >
            <div
              v-if="
                dashboardPanelData.meta.dragAndDrop.targetDragIndex == index &&
                dashboardPanelData.meta.dragAndDrop.currentDragArea == 'z'
              "
              class="dragItem bg-theme-accent w-5 h-full rounded-default opacity-70"
              data-test="dashboard-query-builder-drag-item"
            >
              &nbsp;
            </div>
            <OButtonGroup
              class="axis-field overflow-hidden border border-border-default border-s-2 border-s-badge-success-ol-border bg-surface-panel"
              radius="sm"
                :divided="false"
              :draggable="true"
              @dragstart="onFieldDragStart($event, itemZ, 'z', Number(index))"
              @drop="onDrop($event, 'z', Number(index))"
              @dragenter="onDragEnter($event, 'z', index)"
            >
              <OButton
                variant="ghost"
                size="icon-chip"
                class="cursor-grab !w-4"
                :data-test="`dashboard-z-item-${itemZ?.alias}-drag`"
              >
                <template #icon-left>
                  <OIcon name="drag-indicator" size="xs" class="text-text-secondary" />
                </template>
              </OButton>
              <ODropdown>
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="chip-12"
                    class="!ps-1"
                    :data-test="`dashboard-z-item-${itemZ?.alias}`"
                  >
                    <AxisFieldChipLabel :label="zLabel[index]" />
                    <template #icon-right
><OIcon name="arrow-drop-down" size="sm"
                    /></template>
                  </OButton>
                </template>
                <div
                  :data-test="`dashboard-z-item-${itemZ?.alias}-menu`"
                  class="field-function-menu-popup dashboard-query-builder-dropdown p-2"
                  :style="{
                    width:
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery ||
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields.z[index].isDerived
                        ? 'auto'
                        : FIELD_FUNCTION_MENU_WIDTH,
                  }"
                >
                  <DynamicFunctionPopUp
                    v-model="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].fields.z[index]
                    "
                    :allowAggregation="true"
                    :customQuery="
                      dashboardPanelData.data.queries[
                        dashboardPanelData.layout.currentQueryIndex
                      ].customQuery
                    "
                    :chartType="dashboardPanelData.data.type"
                  />
                </div>
              </ODropdown>
              <OButton
                variant="ghost"
                size="icon-chip"
                class="!w-4"
                :data-test="`dashboard-z-item-${itemZ?.alias}-remove`"
                @click="removeZAxisItemByIndex(Number(index))"
              >
                <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
              </OButton>
            </OButtonGroup>
          </div>
          <div
            class="text-xs font-bold text-center py-1 w-full flex justify-center items-center"
            v-if="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.z?.length < 1
            "
          >
            <div class="mt-1">{{ zAxisHint }}</div>
          </div>
        </div>
      </div>
    </span>
    <template v-if="showJoinsAndFilters">
      <OSeparator />
      <DashboardJoinsOption
        :dashboardData="dashboardData"
        :label-width-class="labelWidthClass"
      ></DashboardJoinsOption>
      <OSeparator />
      <!-- filters container -->
      <DashboardFiltersOption
        :dashboardData="dashboardData"
        :label-width-class="labelWidthClass"
      ></DashboardFiltersOption>
    </template>
  </div>

  <!-- PromQL Builder Mode -->
  <div v-if="promqlBuilderMode">
    <LabelFilterEditor
      v-model:labels="promqlBuilderQuery.labels"
      :metric="promqlBuilderQuery.metric"
      :dashboardData="dashboardData"
      :dashboardPanelData="dashboardPanelData"
    />
    <OSeparator />
    <OperationsList
      v-model:operations="promqlBuilderQuery.operations"
      :dashboardData="dashboardPanelData"
    />
    <PromQLBuilderOptions :dashboardPanelData="dashboardPanelData" />
  </div>

  <DashboardGeoMapsQueryBuilder :dashboardData="dashboardData" />
  <DashboardMapsQueryBuilder :dashboardData="dashboardData" />
  <DashboardSankeyChartBuilder :dashboardData="dashboardData" />
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  reactive,
  watch,
  computed,
  inject,
  nextTick,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
import DashboardGeoMapsQueryBuilder from "./DashboardGeoMapsQueryBuilder.vue";
import DashboardMapsQueryBuilder from "./DashboardMapsQueryBuilder.vue";
import DashboardSankeyChartBuilder from "./DashboardSankeyChartBuilder.vue";
import useNotifications from "@/composables/useNotifications";
import DashboardFiltersOption from "@/views/Dashboards/addPanel/DashboardFiltersOption.vue";
import DashboardJoinsOption from "@/views/Dashboards/addPanel/DashboardJoinsOption.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import AxisFieldChipLabel from "@/components/dashboards/addPanel/AxisFieldChipLabel.vue";
import { buildSQLQueryFromInput } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import { useStore } from "vuex";
import {
  MAX_FIELD_LABEL_CHARS,
  FIELD_FUNCTION_MENU_WIDTH,
} from "@/utils/dashboard/constants";
import LabelFilterEditor from "@/components/promql/components/LabelFilterEditor.vue";
import OperationsList from "@/components/promql/components/OperationsList.vue";
import PromQLBuilderOptions from "@/components/promql/components/PromQLBuilderOptions.vue";
import { promqlRenderer } from "@/components/promql/operations/queryModeller";
import {
  applyPromqlSeed,
  applySeedPanelShape,
  metricsStreamsOf,
  promqlSeedFor,
} from "@/utils/dashboard/promqlSeed";
import { isAutoSeededQuery } from "@/utils/metrics/metricPanelSeed";
import type { PromqlBuilderQuery, PromqlStep } from "@/components/promql/types";
import { normalizeSteps } from "@/components/promql/types";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

// Minimal shape of a dashboard panel query slot as read by the PromQL builder.
interface DashboardQuerySlot {
  fields?: {
    promql_operations?: PromqlStep[];
    promql_labels?: string[];
  };
}

export default defineComponent({
  name: "DashboardQueryBuilder",
  components: {
    OButtonGroup,
    OButton,
    ODropdown,
    DashboardGeoMapsQueryBuilder,
    DashboardMapsQueryBuilder,
    DashboardSankeyChartBuilder,
    DashboardFiltersOption,
    DashboardJoinsOption,
    DynamicFunctionPopUp,
    AxisFieldChipLabel,
    LabelFilterEditor,
    OperationsList,
    PromQLBuilderOptions,
    OIcon,
    OTooltip,
    OSeparator,
  },
  props: ["dashboardData"],
  emits: ["customChartTemplateSelected"],
  setup() {
    const showXAxis = ref(true);
    const panelName = ref("");
    const panelDesc = ref("");
    const { t } = useI18n();
    const { showErrorNotification } = useNotifications();
    const expansionItems = reactive({
      x: true,
      y: true,
      z: true,
      breakdown: true,
      config: true,
      filter: false,
    });
    const dashboardPanelDataPageKey = inject<string>(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const store = useStore();
    const {
      dashboardPanelData,
      addXAxisItem,
      addYAxisItem,
      addZAxisItem,
      addBreakDownAxisItem,
      removeXAxisItemByIndex,
      removeYAxisItemByIndex,
      removeZAxisItemByIndex,
      removeBreakdownItemByIndex,
      addFilteredItem,
      promqlMode,
      updateArrayAlias,
      isAddXAxisNotAllowed,
      isAddYAxisNotAllowed,
      isAddZAxisNotAllowed,
      isAddBreakdownNotAllowed,
      cleanupDraggingFields,
      isPivotMode,
    } = useDashboardPanelData(dashboardPanelDataPageKey);

    const { parsePromQlQuery } = usePromqlSuggestions();

    // Translated axis labels. The composable's currentXLabel/currentYLabel return
    // hardcoded English; recompute them here through t() so they respect the
    // active locale (mirrors the composable's type/pivot branching).
    const currentXLabel = computed(() => {
      if (dashboardPanelData.data.type == "table") {
        return isPivotMode.value ? t("panel.rowFields") : t("panel.firstColumn");
      }
      return dashboardPanelData.data.type == "h-bar"
        ? t("panel.yAxisShort")
        : t("panel.xAxisShort");
    });

    const currentYLabel = computed(() => {
      if (dashboardPanelData.data.type == "table") {
        return isPivotMode.value
          ? t("panel.valueFields")
          : t("panel.otherColumn");
      }
      return dashboardPanelData.data.type == "h-bar"
        ? t("panel.xAxisShort")
        : t("panel.yAxisShort");
    });

    // Axis-label column width: wide enough for the current chart's longest
    // label so every ":" separator (axis rows + Joins + Filters) lines up.
    // Table uses long labels ("First Column" / "Other Columns" / "Row Fields"
    // / "Value Fields"); every other type uses the short "X-Axis"/"Y-Axis".
    const labelWidthClass = computed(() =>
      dashboardPanelData.data.type == "table" ? "min-w-32.5" : "min-w-20",
    );

    // Joins and Filters hide themselves in custom-SQL mode; the separators
    // around them must follow the same condition or they stack into a
    // double border after the Y-axis row.
    const showJoinsAndFilters = computed(() => {
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];
      return !(
        currentQuery?.customQuery && dashboardPanelData.data.queryType === "sql"
      );
    });

    // Initialize treatAsNonTimestamp for existing fields (only for table charts)
    const initializeTreatAsNonTimestamp = () => {
      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];

      // Check if this is a new panel (no ID means it's new)
      const isNewPanel = !dashboardPanelData.data.id;

      // Helper: set treatAsNonTimestamp for X/Y fields only
      const setTreatAsNonTimestampForField = (field: any) => {
        // Always ensure treatAsNonTimestamp is set for existing panels
        if (isNewPanel) {
          // For new panels: set based on field name
          // For timestamp fields: treatAsNonTimestamp = false (unchecked)
          // For non-timestamp fields: treatAsNonTimestamp = true (checked)
          // Fall back to args[0].value.field since field.column is not always set
          const fieldName = field.column ?? field.args?.[0]?.value?.field ?? "";
          field.treatAsNonTimestamp =
            fieldName === store.state.zoConfig.timestamp_column ? false : true;
        } else {
          // For existing panels: only set if treatAsNonTimestamp is not already defined
          // This preserves the saved values from the database
          if (
            field.treatAsNonTimestamp === undefined ||
            field.treatAsNonTimestamp === null
          ) {
            field.treatAsNonTimestamp = false;
          }
        }
      };

      const setShowFieldAsJsonForField = (field: any) => {
        if (
          field.showFieldAsJson === undefined ||
          field.showFieldAsJson === null
        ) {
          field.showFieldAsJson =
            dashboardPanelDataPageKey === "logs"
              ? (store?.state?.zoConfig?.dashboard_show_field_as_json_enabled ??
                false)
              : false;
        }
      };

      // Only X and Y axes for table charts
      if (currentQuery?.fields?.x) {
        currentQuery.fields.x.forEach((field: any) => {
          setTreatAsNonTimestampForField(field);
          setShowFieldAsJsonForField(field);
        });
      }
      if (currentQuery?.fields?.y) {
        currentQuery.fields.y.forEach((field: any) => {
          setTreatAsNonTimestampForField(field);
          setShowFieldAsJsonForField(field);
        });
      }
    };

    onMounted(() => {
      nextTick(() => {
        initializeTreatAsNonTimestamp();
      });
    });

    watch(
      () => dashboardPanelData.data.type,
      (newType: string, oldType: string) => {
        if (newType !== oldType) {
          // Reset treatAsNonTimestamp when chart type changes
          initializeTreatAsNonTimestamp();
        }
      },
    );

    const triggerOperators = [
      { label: t("dashboard.count"), value: "count" },
      { label: t("dashboard.countDistinct"), value: "count-distinct" },
      { label: t("dashboard.sum"), value: "sum" },
      { label: t("dashboard.avg"), value: "avg" },
      { label: t("dashboard.min"), value: "min" },
      { label: t("dashboard.max"), value: "max" },
      {
        label: t("dashboard.p50"),
        value: "p50",
      },
      {
        label: t("dashboard.p90"),
        value: "p90",
      },
      {
        label: t("dashboard.p95"),
        value: "p95",
      },
      {
        label: t("dashboard.p99"),
        value: "p99",
      },
    ];
    const triggerOperatorsWithHistogram: any = [
      { label: t("dashboard.histogram"), value: "histogram" },
    ];

    watch(
      () => dashboardPanelData.meta.dragAndDrop.dragging,
      (newVal: boolean, oldVal: boolean) => {
        if (oldVal == false && newVal == true) {
          expansionItems.x = true;
          expansionItems.y = true;
          expansionItems.z = true;
          expansionItems.breakdown = true;
          expansionItems.config = false;
          expansionItems.filter = true;
        }
      },
    );

    const onDrop = (e: any, targetAxis: string, droppedAtIndex: number) => {
      e.stopPropagation();
      const dragSourceIndex =
        dashboardPanelData.meta.dragAndDrop.dragSourceIndex;
      // reorder items if source and target are same
      if (dashboardPanelData.meta.dragAndDrop.dragSource === targetAxis) {
        // we need to reorder the item
        // Swap the elements in the array
        const fieldList =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields[targetAxis];
        const draggedItem = dashboardPanelData.meta.dragAndDrop.dragElement;
        fieldList?.splice(
          dashboardPanelData.meta.dragAndDrop.dragSourceIndex,
          1,
        );
        fieldList?.splice(droppedAtIndex, 0, draggedItem);
      } else {
        // move the items  between axis or from the field list
        // check if the source is from axis or field list
        if (dashboardPanelData.meta.dragAndDrop.dragSource === "fieldList") {
          // add the item to the target list
          const dragElement = dashboardPanelData.meta.dragAndDrop.dragElement;
          if (!dragElement) {
            return;
          }

          switch (targetAxis) {
            case "x":
              addXAxisItem(dragElement);
              break;
            case "y":
              addYAxisItem(dragElement);
              break;
            case "z":
              addZAxisItem(dragElement);
              break;
            case "breakdown":
              addBreakDownAxisItem(dragElement);
              break;
            case "f":
              addFilteredItem(dragElement);
              break;
          }
          reorderItems(
            targetAxis,
            dashboardPanelData.meta.dragAndDrop.dragSourceIndex,
            droppedAtIndex,
          );
        } else {
          // move the item from field list to axis
          const dragElement = dashboardPanelData.meta.dragAndDrop.dragElement;

          // find first arg which is of type field
          const firstFieldTypeArg = dragElement?.args?.find(
            (arg: any) => arg?.type === "field",
          )?.value;

          if (!firstFieldTypeArg) {
            showErrorNotification(
              t("dashboard.dashboardQueryBuilder.withoutFieldDragError"),
            );
            cleanupDraggingFields();
            return;
          }

          // In custom query mode, use the field's alias/column (which matches the SQL column name)
          // instead of the raw field name from args, since custom mode fields represent SQL result columns
          const isCustomQuery =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].customQuery;

          const fieldObj = {
            name: isCustomQuery
              ? dragElement?.alias || firstFieldTypeArg.field
              : firstFieldTypeArg.field,
            streamAlias: firstFieldTypeArg.streamAlias,
          };

          getAxisArray(targetAxis);

          if (targetAxis !== "f") {
            if (
              (targetAxis === "x" && isAddXAxisNotAllowed.value) ||
              (targetAxis === "y" && isAddYAxisNotAllowed.value) ||
              (targetAxis === "z" && isAddZAxisNotAllowed.value) ||
              (targetAxis === "breakdown" && isAddBreakdownNotAllowed.value)
            ) {
              let maxAllowedAxisFields;

              switch (dashboardPanelData.data.type) {
                case "pie":
                case "donut":
                case "heatmap":
                  maxAllowedAxisFields = targetAxis === "x" ? 1 : 1;
                  break;
                case "metric":
                  maxAllowedAxisFields = targetAxis === "x" ? 0 : 1;
                  break;
                case "table":
                  maxAllowedAxisFields = 0;
                  break;
                case "area-stacked":
                case "stacked":
                case "h-stacked":
                  maxAllowedAxisFields = targetAxis === "x" ? 1 : 1;
                  break;
                default:
                  maxAllowedAxisFields = targetAxis === "x" ? 1 : 1;
                  break;
              }

              const errorMessage = t(
                "dashboard.dashboardQueryBuilder.maxFieldsAllowed",
                {
                  count: maxAllowedAxisFields,
                  axis: targetAxis.toUpperCase(),
                },
              );

              showErrorNotification(errorMessage);
              cleanupDraggingFields();
              return;
            }

            // Remove from the original axis
            const dragSource = dashboardPanelData.meta.dragAndDrop.dragSource;
            if (dragSource === "x") {
              removeXAxisItemByIndex(dragSourceIndex);
            } else if (dragSource === "y") {
              removeYAxisItemByIndex(dragSourceIndex);
            } else if (dragSource === "z") {
              removeZAxisItemByIndex(dragSourceIndex);
            } else if (dragSource === "breakdown") {
              removeBreakdownItemByIndex(dragSourceIndex);
            }
          }

          if (targetAxis === "f") {
            return;
          }

          // Add to the new axis
          if (targetAxis === "x") {
            addXAxisItem(fieldObj);
          } else if (targetAxis === "y") {
            addYAxisItem(fieldObj);
          } else if (targetAxis === "z") {
            addZAxisItem(fieldObj);
          } else if (targetAxis === "breakdown") {
            addBreakDownAxisItem(fieldObj);
          }
          reorderItems(
            targetAxis,
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields[targetAxis]?.length - 1 || 0,
            droppedAtIndex,
          );

          updateArrayAlias();
        }
      }
      cleanupDraggingFields();
    };

    const reorderItems = (
      targetAxis: string,
      sourceIndex: number,
      targetIndex: number,
    ) => {
      const fieldList =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields[targetAxis];

      if (!fieldList) {
        return;
      }
      const draggedItem = fieldList[sourceIndex];
      if (!draggedItem) {
        return;
      }

      fieldList.splice(sourceIndex, 1);
      fieldList.splice(targetIndex, 0, draggedItem);
    };

    const getAxisArray = (area: string) => {
      switch (area) {
        case "x":
          return dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.x;
        case "y":
          return dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.y;
        case "z":
          return dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.z;
        case "breakdown":
          return dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields?.breakdown;
        default:
          return [];
      }
    };
    const onDragEnter = (e: any, area: string, index: any) => {
      if (
        dashboardPanelData.meta.dragAndDrop.dragSource != "fieldList" &&
        area === "f"
      ) {
        e.preventDefault();
        return;
      }
      dashboardPanelData.meta.dragAndDrop.targetDragIndex =
        index != null && index >= 0
          ? index
          : dashboardPanelData.meta.dragAndDrop.targetDragIndex;
      dashboardPanelData.meta.dragAndDrop.currentDragArea = area;
      e.preventDefault();
    };

    const onDragStart = (e: any) => {
      e.preventDefault();
    };

    const onDragOver = (e: any, _columnData?: string) => {
      e.preventDefault();
    };

    const onFieldDragStart = (
      e: any,
      item: any,
      axis: string,
      index: number,
    ) => {
      dashboardPanelData.meta.dragAndDrop.dragging = true;
      dashboardPanelData.meta.dragAndDrop.dragElement = item;
      dashboardPanelData.meta.dragAndDrop.dragSource = axis;
      dashboardPanelData.meta.dragAndDrop.dragSourceIndex = index;
    };

    const onDragEnd = () => {
      cleanupDraggingFields();
    };

    const xAxisHint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "pie":
        case "donut":
          return t("dashboard.oneLabelFieldMessage");
        case "metric":
          return t("dashboard.xaxisFieldNAMessage");
        case "table":
          return t("dashboard.oneOrMoreFieldsMessage");
        case "stacked":
        case "area-stacked":
        case "h-stacked":
        case "area":
        case "bar":
        case "h-bar":
        case "line":
        case "scatter":
          return t("dashboard.twoFieldsMessage");
        case "heatmap":
          return t("dashboard.oneFieldMessage");
        case "gauge":
          return t("dashboard.dashboardQueryBuilder.addZeroOrOneLabelField");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const bAxisHint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "stacked":
        case "area-stacked":
        case "h-stacked":
          return t("dashboard.twoFieldsMessage");
        default:
          return t("dashboard.zeroOrOneFieldMessage");
      }
    });

    const yAxisHint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "pie":
        case "donut":
        case "gauge":
          return t("dashboard.oneValueFieldMessage");
        case "metric":
          return t("dashboard.oneValueFieldMessage");
        case "heatmap":
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.oneOrMoreFieldsMessage");
      }
    });

    const zAxisHint = computed(() => {
      switch (dashboardPanelData.data.type) {
        case "heatmap":
          return t("dashboard.dashboardQueryBuilder.addOneField");
        default:
          return t("dashboard.dashboardQueryBuilder.addOneOrMoreFields");
      }
    });
    const commonBtnLabel = (field: any) => {
      if (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
      ) {
        return field?.alias;
      }
      const label = buildSQLQueryFromInput(
        field,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.joins?.length
          ? dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.stream
          : "",
      );
      return label?.length > MAX_FIELD_LABEL_CHARS
        ? label.substring(0, MAX_FIELD_LABEL_CHARS) + "..."
        : label;
    };

    const xLabel = computed(() => {
      const xFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.x;
      return xFields.map(commonBtnLabel);
    });

    const bLabel = computed(() => {
      const bFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.breakdown;
      return bFields.map(commonBtnLabel);
    });

    const yLabel = computed(() => {
      const yFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.y;
      return yFields.map(commonBtnLabel);
    });

    const zLabel = computed(() => {
      const zFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.z;
      return zFields.map(commonBtnLabel);
    });

    // PromQL Builder Mode (queryType = "promql" with customQuery = false)
    const promqlBuilderMode = computed(
      () =>
        dashboardPanelData.data.queryType == "promql" &&
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.customQuery,
    );

    const promqlBuilderQuery = reactive<PromqlBuilderQuery>({
      metric: "",
      labels: [],
      operations: [],
    });

    /**
     * Reads a panel's saved operations, upgrading any step ids it was stored
     * under, and writes the upgrade back into the panel.
     *
     * The write-back has to happen HERE rather than being left to the deep
     * watcher that copies builder state into the schema: that watcher is
     * registered after this one runs `immediate`, so on the load that matters it
     * has not been set up yet and never fires.
     *
     * `normalizeSteps` hands back the array it was given when nothing needed
     * upgrading, so a changed reference is the signal that this panel was saved
     * under old ids. A modern panel is not touched.
     */
    const loadSavedSteps = (
      currentQuery: DashboardQuerySlot | undefined,
    ): PromqlStep[] => {
      const stored: PromqlStep[] = currentQuery?.fields?.promql_operations || [];
      const upgraded = normalizeSteps(stored);

      if (upgraded !== stored && currentQuery?.fields) {
        currentQuery.fields.promql_operations = upgraded;
      }

      return upgraded;
    };

    /**
     * Migrates EVERY query slot, not just the one on screen.
     *
     * A panel can hold several queries behind tabs, and the builder only ever
     * loads the tab you are looking at. Migrating just that one would leave a
     * two-tab panel half-upgraded — saved with tab 2 still on the old ids.
     */
    const migrateAllSavedSteps = () => {
      for (const slot of dashboardPanelData.data.queries ?? []) {
        const stored = slot?.fields?.promql_operations;
        if (!Array.isArray(stored) || !slot?.fields) continue;

        const upgraded = normalizeSteps(stored);
        if (upgraded !== stored) slot.fields.promql_operations = upgraded;
      }
    };

    // Watch for metric changes from FieldList (stream selection)
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream,
      (newStream, oldStream) => {
        if (!promqlBuilderMode.value || !newStream) return;

        promqlBuilderQuery.metric = newStream;

        // The rule set needs the stream list to know what this metric IS. If it
        // has not arrived yet (a panel restored from a URL sets `fields.stream`
        // before `getStreams` resolves), seeding now would write the bare
        // `metric{}` fallback and then never revisit it — a counter left raw and
        // cumulative. Wait; `seedEmptySlot` below picks it up when the list lands.
        if (!metricsStreamsOf(dashboardPanelData).length) return;

        // Seed the metrics rule set's default function for the newly selected
        // metric — `sum(rate(...))` for a counter, a heatmap for a histogram —
        // instead of leaving the builder empty, which renders as a bare
        // `metric{}` (a raw cumulative counter: almost never what anyone wants).
        //
        // The seed has to go through THIS local state, not straight into the
        // schema. The deep watcher below copies `promqlBuilderQuery` into
        // `fields.promql_operations` on every change and re-renders `query` from
        // it, so anything written to the schema from outside is overwritten on
        // the next tick.
        //
        // Only when the user has not written a query of their own: `oldStream`
        // is what the current query was seeded FOR, so if the query is no longer
        // what we would have produced for it, they have edited it — leave it be.
        if (
          !isAutoSeededQuery(
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.query,
            oldStream,
            metricsStreamsOf(dashboardPanelData),
            { chartType: dashboardPanelData.data.type, requireBuilder: true },
          )
        ) {
          return;
        }

        // `oldStream` is what the CURRENT query was seeded for — `fields.stream`
        // already holds the new one by the time this watcher runs.
        const seed = promqlSeedFor(dashboardPanelData, newStream, {
          previousStream: oldStream,
        });
        promqlBuilderQuery.labels = seed.promqlLabels as any;
        promqlBuilderQuery.operations = seed.promqlOperations as any;

        // Chart type + unit + the chart-type contracts, through the one helper
        // that also RETRACTS the contracts of the type being left and refuses to
        // let a secondary query slot redefine the panel.
        applySeedPanelShape(
          dashboardPanelData,
          seed,
          dashboardPanelData.layout.currentQueryIndex,
        );
      },
      { immediate: true },
    );

    // Initialize from existing query if available
    watch(
      () => promqlBuilderMode.value,
      (isBuilderMode) => {
        if (isBuilderMode) {
          const currentQuery =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ];
          // Initialize metric from stream
          if (currentQuery?.fields?.stream) {
            promqlBuilderQuery.metric = currentQuery.fields.stream;
          }
          // Upgrade every tab's step ids, not only the one being loaded, so a
          // multi-query panel migrates as a whole the first time it is opened.
          migrateAllSavedSteps();

          // Load saved builder state from schema, migrating any step ids the
          // panel was saved under.
          promqlBuilderQuery.labels = currentQuery?.fields?.promql_labels || [];
          promqlBuilderQuery.operations = loadSavedSteps(currentQuery);
        }
      },
      { immediate: true },
    );

    /**
     * Keep the builder's local state in step with the schema when the schema is
     * written from OUTSIDE — which is what `applyDefaultPanelFields` does when it
     * seeds the metrics rule set's default on a query-type toggle.
     *
     * The builder-mode watcher above reads the schema when the mode flips, but
     * the seed lands a microtask later, so without this the builder would show no
     * operations while the query already held the seeded value — and since the
     * builder is the sole writer of the query string, the user's first click
     * would rewrite it to a bare `x{}`.
     *
     * The equality guards matter: the deep watcher below writes these same
     * references straight back, so without them the two watchers would ping-pong.
     */
    watch(
      () => {
        const q =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ];
        return [q?.fields?.promql_labels, q?.fields?.promql_operations];
      },
      ([labels, operations]: any) => {
        if (!promqlBuilderMode.value) return;

        const same = (a: any, b: any) =>
          JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

        // Compare against the UPGRADED form, not the raw one. A panel saved
        // under the old step ids would otherwise never look equal to the
        // builder's canonical state, and this watcher would spend every flush
        // undoing the upgrade the builder had just written.
        const incoming = normalizeSteps(operations ?? []);

        if (!same(incoming, promqlBuilderQuery.operations)) {
          promqlBuilderQuery.operations = JSON.parse(JSON.stringify(incoming));
        }
        if (!same(labels, promqlBuilderQuery.labels)) {
          promqlBuilderQuery.labels = JSON.parse(JSON.stringify(labels ?? []));
        }
      },
      { deep: true },
    );

    // Watch for query index changes to load the correct builder state
    watch(
      () => dashboardPanelData.layout.currentQueryIndex,
      () => {
        if (promqlBuilderMode.value) {
          const currentQuery =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ];
          // Load metric
          if (currentQuery?.fields?.stream) {
            promqlBuilderQuery.metric = currentQuery.fields.stream;
          }
          // Load saved builder state, migrating any legacy step ids (see above).
          promqlBuilderQuery.labels = currentQuery?.fields?.promql_labels || [];
          promqlBuilderQuery.operations = loadSavedSteps(currentQuery);
        }
      },
    );

    // Deep watcher to rebuild PromQL query when any field changes
    // Triggers on: metric, labels, operations changes (including drag reorder)
    watch(
      promqlBuilderQuery,
      () => {
        // Only rebuild if in promql-builder mode (queryType = "promql" && customQuery = false)
        if (!promqlBuilderMode.value) return;

        const currentQuery =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ];

        // Save labels and operations to schema
        currentQuery.fields.promql_labels = promqlBuilderQuery.labels;
        currentQuery.fields.promql_operations = promqlBuilderQuery.operations;

        // Rebuild the PromQL query
        try {
          const query = promqlRenderer.renderQuery(promqlBuilderQuery);
          currentQuery.query = query;
        } catch {
          /* ignore: keep last valid query on render failure */
        }
      },
      { deep: true },
    );

    /**
     * Seed a slot the stream watcher structurally cannot see.
     *
     * Two of them:
     *  - A NEW query tab clones `fields.stream` from the current one, so the stream
     *    never changes and the stream watcher never fires. The tab was left with an
     *    empty query, which renders as a bare `metric{}` — a raw cumulative counter,
     *    which is exactly what the seeding exists to prevent.
     *  - A panel restored before `getStreams` resolved skipped seeding (the rule set
     *    had no stream list to work from); this catches it when the list lands.
     *
     * Writes the SLOT directly, then syncs the builder's local state to match —
     * rather than seeding the local state and trusting the deep watcher above to
     * render it into the schema. That indirection does not survive here: this fires
     * `immediate`, i.e. during setup, and a mutation made then never reaches the deep
     * watcher. Writing both ends is idempotent anyway, since the deep watcher
     * renders the same query back out of the same state.
     *
     * Deliberately only seeds an EMPTY slot: switching between existing tabs must
     * never rewrite a query that is already there.
     */
    watch(
      () => [
        dashboardPanelData.layout.currentQueryIndex,
        dashboardPanelData.meta.stream.streamResults?.length,
      ],
      () => {
        if (!promqlBuilderMode.value) return;

        const index = dashboardPanelData.layout.currentQueryIndex;
        const slot = dashboardPanelData.data.queries[index];
        const stream = slot?.fields?.stream;

        if (!stream || slot?.query?.trim()) return;
        if (!metricsStreamsOf(dashboardPanelData).length) return;

        const seed = applyPromqlSeed(dashboardPanelData, stream);
        if (!seed) return;

        promqlBuilderQuery.metric = seed.stream;
        promqlBuilderQuery.labels = seed.promqlLabels as any;
        promqlBuilderQuery.operations = seed.promqlOperations as any;
      },
      { immediate: true },
    );

    // Watch for query changes in PromQL custom mode and extract metric name to set as stream
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.query,
      (newQuery) => {
        // Only process if in PromQL custom mode (not builder mode)
        if (promqlMode.value && !promqlBuilderMode.value && newQuery) {
          const parsedQuery = parsePromQlQuery(newQuery);
          const metricName = parsedQuery?.metricName;

          if (metricName) {
            const currentQuery =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ];
            // Set the extracted metric name as the stream
            currentQuery.fields.stream = metricName;
          }
        }
      },
    );

    return {
      showXAxis,
      t,
      FIELD_FUNCTION_MENU_WIDTH,
      panelName,
      panelDesc,
      dashboardPanelData,
      removeXAxisItemByIndex,
      removeYAxisItemByIndex,
      removeZAxisItemByIndex,
      removeBreakdownItemByIndex,
      triggerOperators,
      pagination: ref({
        rowsPerPage: 0,
      }),
      model: ref([]),
      tab: ref("General"),
      getImageURL,
      onDrop,
      onDragStart,
      onDragOver,
      onDragEnter,
      expansionItems,
      triggerOperatorsWithHistogram,
      xAxisHint,
      bAxisHint,
      yAxisHint,
      zAxisHint,
      promqlMode,
      promqlBuilderMode,
      promqlBuilderQuery,
      xLabel,
      yLabel,
      zLabel,
      bLabel,
      onFieldDragStart,
      onDragEnd,
      currentXLabel,
      currentYLabel,
      labelWidthClass,
      isPivotMode,
      reorderItems,
      showJoinsAndFilters,
    };
  },
});
</script>
