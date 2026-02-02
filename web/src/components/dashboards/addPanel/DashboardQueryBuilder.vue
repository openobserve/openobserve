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
      style="display: flex; flex-direction: row; width: 100%"
      class="q-pl-md"
      v-if="dashboardPanelData.data.type != 'metric'"
    >
      <div style="flex: 1">
        <div style="display: flex; flex-direction: row">
          <div class="layout-name">
            {{
              dashboardPanelData.data.type == "table"
                ? t("panel.firstColumn")
                : dashboardPanelData.data.type == "h-bar" ||
                    dashboardPanelData.data.type == "h-stacked"
                  ? t("panel.yAxis")
                  : t("panel.xAxis")
            }}
            <q-icon name="info_outline" class="q-ml-xs">
              <q-tooltip>
                {{ xAxisHint }}
              </q-tooltip>
            </q-icon>
          </div>
          <span class="layout-separator">:</span>
          <div
            class="axis-container droppable scroll row"
            :class="{
              'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
              'drop-entered':
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
              class="row q-mr-sm q-my-xs"
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
                class="dragItem"
              >
                &nbsp;
              </div>
              <q-btn-group
                class="axis-field"
                :draggable="true"
                @dragstart="onFieldDragStart($event, itemX, 'x', index)"
                @drop="onDrop($event, 'x', index)"
                @dragenter="onDragEnter($event, 'x', index)"
              >
                <div>
                  <q-icon
                    name="drag_indicator"
                    color="grey-13"
                    size="13px"
                    class="cursor-grab q-my-xs"
                  />
                  <q-btn
                    square
                    icon-right="arrow_drop_down"
                    no-caps
                    color="primary"
                    dense
                    :no-wrap="true"
                    size="sm"
                    :label="xLabel[index]"
                    class="q-pl-sm"
                    :data-test="`dashboard-x-item-${itemX?.alias}`"
                  >
                    <q-menu
                      :data-test="`dashboard-x-item-${itemX?.alias}-menu`"
                      class="field-function-menu-popup"
                    >
                      <div
                        style="padding: 3px 16px 16px 16px"
                        :style="{
                          width:
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].customQuery ||
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].fields.x[index].isDerived
                              ? 'auto'
                              : '771px',
                        }"
                      >
                        <div>
                          <div class="q-mr-xs q-mb-sm">
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
                        </div>
                      </div>
                    </q-menu>
                  </q-btn>
                  <q-btn
                    style="height: 100%"
                    size="xs"
                    dense
                    :data-test="`dashboard-x-item-${itemX?.alias}-remove`"
                    @click="removeXAxisItemByIndex(index)"
                    icon="close"
                  />
                </div>
              </q-btn-group>
            </div>
            <div
              class="text-caption text-weight-bold text-center q-py-xs"
              v-if="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.x?.length < 1
              "
              style="
                width: 100%;
                display: flex;
                justify-content: center;
                align-items: center;
              "
            >
              <div class="q-mt-xs">{{ xAxisHint }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- b axis container -->
      <div
        style="flex: 1"
        v-if="
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
        <div style="display: flex; flex-direction: row" class="q-pl-md">
          <!-- Separator between X and Breakdown -->
          <q-separator vertical class="q-mr-md" />
          <div class="layout-name" style="min-width: 0 !important">
            {{ t("panel.breakdown") }}
            <q-icon name="info_outline" class="q-ml-xs">
              <q-tooltip>
                <span
                  v-if="
                    dashboardPanelData.data.type == 'h-bar' ||
                    dashboardPanelData.data.type == 'h-stacked'
                  "
                >
                  Use these fields to split the data into different sections on
                  the Y axis for a clearer view.
                </span>

                <span v-else>
                  Use these fields to split the data into different sections on
                  the X axis for a clearer view.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <span class="layout-separator">:</span>
          <div
            class="axis-container droppable scroll row"
            :class="{
              'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
              'drop-entered':
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
              class="row q-mr-sm q-my-xs"
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
                class="dragItem"
              >
                &nbsp;
              </div>
              <q-btn-group
                class="axis-field"
                :draggable="true"
                @dragstart="onFieldDragStart($event, itemB, 'breakdown', index)"
                @drop="onDrop($event, 'breakdown', index)"
                @dragenter="onDragEnter($event, 'breakdown', index)"
              >
                <div>
                  <q-icon
                    name="drag_indicator"
                    color="grey-13"
                    size="13px"
                    class="cursor-grab q-my-xs"
                  />
                  <q-btn
                    square
                    icon-right="arrow_drop_down"
                    no-caps
                    color="primary"
                    dense
                    :no-wrap="true"
                    size="sm"
                    :label="bLabel[index]"
                    class="q-pl-sm"
                    :data-test="`dashboard-b-item-${itemB?.alias}`"
                  >
                    <q-menu
                      :data-test="`dashboard-b-item-${itemB?.alias}-menu`"
                      class="field-function-menu-popup"
                    >
                      <div
                        style="padding: 3px 16px 16px 16px"
                        :style="{
                          width:
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].customQuery ||
                            dashboardPanelData.data.queries[
                              dashboardPanelData.layout.currentQueryIndex
                            ].fields.breakdown[index].isDerived
                              ? 'auto'
                              : '771px',
                        }"
                      >
                        <div>
                          <div class="q-mr-xs q-mb-sm">
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
                        </div>
                      </div>
                    </q-menu>
                  </q-btn>
                  <q-btn
                    style="height: 100%"
                    size="xs"
                    dense
                    :data-test="`dashboard-b-item-${itemB?.alias}-remove`"
                    @click="removeBreakdownItemByIndex(index)"
                    icon="close"
                  />
                </div>
              </q-btn-group>
            </div>
            <div
              class="text-caption text-weight-bold text-center q-py-xs"
              v-if="
                !dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields?.breakdown?.length
              "
              style="
                width: 100%;
                display: flex;
                justify-content: center;
                align-items: center;
              "
            >
              <div class="q-mt-xs">{{ bAxisHint }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <q-separator />
    <!-- y axis container -->
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">
        {{
          dashboardPanelData.data.type == "table"
            ? t("panel.otherColumn")
            : dashboardPanelData.data.type == "h-bar" ||
                dashboardPanelData.data.type == "h-stacked"
              ? t("panel.xAxis")
              : t("panel.yAxis")
        }}
        <q-icon name="info_outline" class="q-ml-xs">
          <q-tooltip>
            {{ yAxisHint }}
          </q-tooltip>
        </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div
        class="axis-container droppable scroll row"
        :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered':
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
          class="row q-mr-sm q-my-xs"
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
            class="dragItem"
          >
            &nbsp;
          </div>
          <q-btn-group
            class="axis-field"
            :draggable="true"
            @dragstart="onFieldDragStart($event, itemY, 'y', index)"
            @drop="onDrop($event, 'y', index)"
            @dragenter="onDragEnter($event, 'y', index)"
          >
            <div>
              <q-icon
                name="drag_indicator"
                color="grey-13"
                size="13px"
                class="cursor-grab q-my-xs"
              />
              <q-btn
                icon-right="arrow_drop_down"
                no-caps
                dense
                color="primary"
                square
                :no-wrap="true"
                size="sm"
                :label="yLabel[index]"
                :data-test="`dashboard-y-item-${itemY?.alias}`"
                class="q-pl-sm"
              >
                <q-menu
                  :data-test="`dashboard-y-item-${itemY?.alias}-menu`"
                  class="field-function-menu-popup"
                >
                  <div
                    style="padding: 3px 16px 16px 16px"
                    :style="{
                      width:
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].customQuery ||
                        dashboardPanelData.data.queries[
                          dashboardPanelData.layout.currentQueryIndex
                        ].fields.y[index].isDerived
                          ? 'auto'
                          : '771px',
                    }"
                  >
                    <div>
                      <div class="q-mr-xs q-mb-sm">
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
                    </div>
                  </div>
                </q-menu>
              </q-btn>
              <q-btn
                style="height: 100%"
                size="xs"
                dense
                :data-test="`dashboard-y-item-${itemY?.alias}-remove`"
                @click="removeYAxisItemByIndex(index)"
                icon="close"
              />
            </div>
          </q-btn-group>
        </div>
        <div
          class="text-caption text-weight-bold text-center q-py-xs"
          v-if="
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.y?.length < 1
          "
          style="
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
          "
        >
          <div class="q-mt-xs">{{ yAxisHint }}</div>
        </div>
      </div>
    </div>
    <q-separator />

    <!-- z axis container -->
    <span v-if="dashboardPanelData.data.type === 'heatmap'">
      <div style="display: flex; flex-direction: row" class="q-pl-md">
        <div class="layout-name">
          {{
            dashboardPanelData.data.type == "heatmap" ? t("panel.zAxis") : ""
          }}
          <q-icon name="info_outline" class="q-ml-xs">
            <q-tooltip>
              {{ zAxisHint }}
            </q-tooltip>
          </q-icon>
        </div>
        <span class="layout-separator">:</span>
        <div
          class="axis-container droppable scroll row"
          :class="{
            'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
            'drop-entered':
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
            class="row q-mr-sm q-my-xs"
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
              class="dragItem"
            >
              &nbsp;
            </div>
            <q-btn-group
              class="axis-field"
              :draggable="true"
              @dragstart="onFieldDragStart($event, itemZ, 'z', index)"
              @drop="onDrop($event, 'z', index)"
              @dragenter="onDragEnter($event, 'z', index)"
            >
              <div>
                <q-icon
                  name="drag_indicator"
                  color="grey-13"
                  size="13px"
                  class="cursor-grab q-my-xs"
                />
                <q-btn
                  square
                  icon-right="arrow_drop_down"
                  no-caps
                  dense
                  :no-wrap="true"
                  color="primary"
                  size="sm"
                  :label="zLabel[index]"
                  :data-test="`dashboard-z-item-${itemZ?.alias}`"
                  class="q-pl-sm"
                >
                  <q-menu
                    :data-test="`dashboard-z-item-${itemZ?.alias}-menu`"
                    class="field-function-menu-popup"
                  >
                    <div
                      style="padding: 3px 16px 16px 16px"
                      :style="{
                        width:
                          dashboardPanelData.data.queries[
                            dashboardPanelData.layout.currentQueryIndex
                          ].customQuery ||
                          dashboardPanelData.data.queries[
                            dashboardPanelData.layout.currentQueryIndex
                          ].fields.z[index].isDerived
                            ? 'auto'
                            : '771px',
                      }"
                    >
                      <div>
                        <div class="q-mr-xs q-mb-sm">
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
                      </div>
                    </div>
                  </q-menu>
                </q-btn>
                <q-btn
                  style="height: 100%"
                  size="xs"
                  dense
                  :data-test="`dashboard-z-item-${itemZ?.alias}-remove`"
                  @click="removeZAxisItemByIndex(index)"
                  icon="close"
                />
              </div>
            </q-btn-group>
          </div>
          <div
            class="text-caption text-weight-bold text-center q-py-xs"
            v-if="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields?.z?.length < 1
            "
            style="
              width: 100%;
              display: flex;
              justify-content: center;
              align-items: center;
            "
          >
            <div class="q-mt-xs">{{ zAxisHint }}</div>
          </div>
        </div>
      </div>
    </span>
    <q-separator />
    <DashboardJoinsOption :dashboardData="dashboardData"></DashboardJoinsOption>
    <q-separator />
    <!-- filters container -->
    <DashboardFiltersOption
      :dashboardData="dashboardData"
    ></DashboardFiltersOption>
  </div>

  <!-- PromQL Builder Mode -->
  <div v-if="promqlBuilderMode">
    <LabelFilterEditor
      v-model:labels="promqlBuilderQuery.labels"
      :metric="promqlBuilderQuery.metric"
      :dashboardData="dashboardData"
      :dashboardPanelData="dashboardPanelData"
    />
    <q-separator />
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
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
import DashboardGeoMapsQueryBuilder from "./DashboardGeoMapsQueryBuilder.vue";
import DashboardMapsQueryBuilder from "./DashboardMapsQueryBuilder.vue";
import DashboardSankeyChartBuilder from "./DashboardSankeyChartBuilder.vue";
import HistogramIntervalDropDown from "@/components/dashboards/addPanel/HistogramIntervalDropDown.vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import useNotifications from "@/composables/useNotifications";
import DashboardFiltersOption from "@/views/Dashboards/addPanel/DashboardFiltersOption.vue";
import DashboardJoinsOption from "@/views/Dashboards/addPanel/DashboardJoinsOption.vue";
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { buildSQLQueryFromInput } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import { useStore } from "vuex";
import { MAX_FIELD_LABEL_CHARS } from "@/utils/dashboard/constants";
import LabelFilterEditor from "@/components/promql/components/LabelFilterEditor.vue";
import OperationsList from "@/components/promql/components/OperationsList.vue";
import PromQLBuilderOptions from "@/components/promql/components/PromQLBuilderOptions.vue";
import { promQueryModeller } from "@/components/promql/operations/queryModeller";
import type { PromVisualQuery } from "@/components/promql/types";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";

export default defineComponent({
  name: "DashboardQueryBuilder",
  components: {
    DashboardGeoMapsQueryBuilder,
    DashboardMapsQueryBuilder,
    DashboardSankeyChartBuilder,
    CommonAutoComplete,
    SanitizedHtmlRenderer,
    DashboardFiltersOption,
    DashboardJoinsOption,
    DynamicFunctionPopUp,
    LabelFilterEditor,
    OperationsList,
    PromQLBuilderOptions,
  },
  props: ["dashboardData"],
  setup(props) {
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
    const dashboardPanelDataPageKey = inject(
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
      selectedStreamFieldsBasedOnUserDefinedSchema,
      fetchPromQLLabels
    } = useDashboardPanelData(dashboardPanelDataPageKey);

    const { parsePromQlQuery } = usePromqlSuggestions();

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
          field.treatAsNonTimestamp =
            field.column === store.state.zoConfig.timestamp_column
              ? false
              : true;
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
          field.showFieldAsJson = false;
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
            showErrorNotification("Without field, not able to drag");
            cleanupDraggingFields();
            return;
          }

          const fieldObj = {
            name: firstFieldTypeArg.field,
            streamAlias: firstFieldTypeArg.streamAlias,
          };

          const axisArray = getAxisArray(targetAxis);

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

              const errorMessage = `Max ${maxAllowedAxisFields} field(s) in ${targetAxis.toUpperCase()}-Axis is allowed.`;

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

    const onDragStart = (e: any, item: any) => {
      e.preventDefault();
    };

    const onDragOver = (e: any, area: string) => {
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

    const xAxisHint = computed((e: any) => {
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
          return "Add 0 or 1 label field here";
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    });

    const bAxisHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case "stacked":
        case "area-stacked":
        case "h-stacked":
          return t("dashboard.twoFieldsMessage");
        default:
          return t("dashboard.zeroOrOneFieldMessage");
      }
    });

    const yAxisHint = computed((e: any) => {
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

    const zAxisHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case "heatmap":
          return "Add 1 field here";
        default:
          return "Add one or more fields here";
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
      return label?.length > MAX_FIELD_LABEL_CHARS ? label.substring(0, MAX_FIELD_LABEL_CHARS) + "..." : label;
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

    const operators = ["=", "<>", ">=", "<=", ">", "<"];

    // PromQL Builder Mode (queryType = "promql" with customQuery = false)
    const promqlBuilderMode = computed(
      () => dashboardPanelData.data.queryType == "promql" &&
           !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.customQuery
    );

    const promqlBuilderQuery = reactive<PromVisualQuery>({
      metric: "",
      labels: [],
      operations: [],
    });

    // Watch for metric changes from FieldList (stream selection)
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream,
      (newStream) => {
        if (promqlBuilderMode.value && newStream) {
          promqlBuilderQuery.metric = newStream;
        }
      },
      { immediate: true }
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
          // Load saved builder state from schema
          promqlBuilderQuery.labels = currentQuery?.fields?.promql_labels || [];
          promqlBuilderQuery.operations = currentQuery?.fields?.promql_operations || [];
        }
      },
      { immediate: true }
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
          // Load saved builder state
          promqlBuilderQuery.labels = currentQuery?.fields?.promql_labels || [];
          promqlBuilderQuery.operations = currentQuery?.fields?.promql_operations || [];
        }
      }
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
          const query = promQueryModeller.renderQuery(promqlBuilderQuery);
          currentQuery.query = query;
        } catch (error) {
        }
      },
      { deep: true }
    );

    // Watch for query changes in PromQL custom mode and extract metric name to set as stream
    watch(
      () => dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.query,
      (newQuery) => {
        // Only process if in PromQL custom mode (not builder mode)
        if (promqlMode.value && !promqlBuilderMode.value && newQuery) {
          const parsedQuery = parsePromQlQuery(newQuery);
          const metricName = parsedQuery?.metricName;

          if (metricName) {
            const currentQuery = dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ];
            // Set the extracted metric name as the stream
            currentQuery.fields.stream = metricName;
          }
        }
      }
    );

    return {
      showXAxis,
      t,
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
    };
  },
});
</script>

<style lang="scss" scoped>
.dragItem {
  background-color: $primary;
  width: 20px;
  height: 100%;
  border-radius: 5px;
  opacity: 0.7;
}

.cursor-grab {
  cursor: -webkit-grab;
  cursor: grab;
}

.axis-field {
  overflow: hidden;
}

:deep(.axis-field div) {
  display: flex;
}

:deep(.axis-field .q-btn--rectangle) {
  border-radius: 0%;
}

:deep(.axis-field .q-btn:before) {
  border: 0px solid transparent;
}

.axis-container {
  flex: 1;
  width: 100%;
  text-align: center;
  // white-space: nowrap;
  overflow-x: auto;
}
.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}
.layout-name {
  white-space: nowrap;
  min-width: 130px;
  display: flex;
  align-items: center;
}

.droppable {
  border-color: transparent;
  border-style: dashed;
  border-width: 2px;
}

.drop-target {
  background-color: rgba(0, 0, 0, 0.042);
  border-color: white;
  border-style: dotted;
}

.drop-entered {
  transition: all;
  transition-duration: 200ms;
  background-color: #cbcbcb;
}

.color-input-wrapper {
  height: 1.5em;
  width: 1.5em;
  overflow: hidden;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  position: relative;
}
.color-input-wrapper input[type="color"] {
  position: absolute;
  height: 4em;
  width: 4em;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
}
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}
.index-menu {
  width: 100%;

  .q-field {
    &__control {
      height: 35px;
      padding: 0px 5px;
      min-height: auto !important;

      &-container {
        padding-top: 0px !important;
      }
    }
    &__native :first-of-type {
      padding-top: 0.25rem;
    }
  }

  .q-select {
    text-transform: capitalize;
  }

  .index-table {
    width: 100%;
    // border: 1px solid rgba(0, 0, 0, 0.02);
    .q-table {
      display: block;
    }
    tr {
      margin-bottom: 1px;
    }
    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: 25px;
    }

    .q-table__top {
      padding: 0px;
    }
    .q-table__control,
    label.q-field {
      width: 100%;
    }
    .q-table thead tr,
    .q-table tbody td {
      height: auto;
    }

    .q-table__top {
      border-bottom: unset;
    }
  }
  .field-table {
    width: 100%;
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    .field_overlay {
      justify-content: space-between;
      background-color: transparent;
      transition: all 0.3s ease;
      padding: 0px 10px;
      align-items: center;
      position: absolute;
      // line-height: 2rem;
      overflow: hidden;
      inset: 0;
      display: flex;
      z-index: 1;
      width: 100%;
      border-radius: 0px;
      height: 25px;

      .field_icons {
        padding: 0 0.625rem 0 0.25rem;
        transition: all 0.3s ease;
        background-color: white;
        position: absolute;
        z-index: 3;
        opacity: 0;
        right: 0;

        .q-icon {
          cursor: pointer;
        }
      }

      .field_label {
        pointer-events: none;
        font-size: 0.825rem;
        position: relative;
        display: inline;
        z-index: 2;
        left: 0;
        // text-transform: capitalize;
      }
    }

    &.selected {
      .field_overlay {
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
      }
      &:hover {
        .field_overlay {
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);
          background-color: white;

          .field_icons {
            background-color: white;
          }
        }
      }
    }
    &:hover {
      .field_overlay {
        box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

        .field_icons {
          background-color: white;
          opacity: 1;
        }
      }
    }
  }
}
.q-item {
  // color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}
.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}
.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}

.field-function-menu-popup {
  padding: 3px 16px 16px 16px;
  width: 771px;
}
</style>
