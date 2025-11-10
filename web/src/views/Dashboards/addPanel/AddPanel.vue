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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="overflow-y: auto" class="scroll">
    <div class="tw-px-[0.625rem] tw-mb-[0.625rem] q-pt-xs">
      <div
      class="flex items-center q-pa-sm card-container"
      :class="!store.state.isAiChatEnabled ? 'justify-between' : ''"
    >
      <div
        class="flex items-center q-table__title"
        :class="!store.state.isAiChatEnabled ? 'q-mr-md' : 'q-mr-sm'"
      >
        <span>
          {{ editMode ? t("panel.editPanel") : t("panel.addPanel") }}
        </span>
        <div>
          <q-input
            data-test="dashboard-panel-name"
            v-model="dashboardPanelData.data.title"
            :label="t('panel.name') + '*'"
            class="q-ml-xl dynamic-input"
            dense
            borderless
            :style="inputStyle"
          />
        </div>
      </div>
      <div class="flex q-gutter-sm">
        <q-btn
          outline
          padding="xs sm"
          class="q-mr-sm tw-h-[36px] el-border"
          no-caps
          label="Dashboard Tutorial"
          @click="showTutorial"
          data-test="dashboard-panel-tutorial-btn"
        ></q-btn>
        <q-btn
          v-if="
            !['html', 'markdown', 'custom_chart'].includes(
              dashboardPanelData.data.type,
            )
          "
          outline
          padding="sm"
          class="q-mr-sm tw-h-[36px] el-border"
          no-caps
          icon="info_outline"
          @click="showViewPanel = true"
          data-test="dashboard-panel-data-view-query-inspector-btn"
        >
          <q-tooltip anchor="center left" self="center right"
            >Query Inspector
          </q-tooltip>
        </q-btn>
        <DateTimePickerDashboard
          v-if="selectedDate"
          v-model="selectedDate"
          ref="dateTimePickerRef"
          :disable="disable"
          class="tw-h-[36px]"
          @hide="setTimeForVariables"
        />
        <q-btn
          outline
          color="red"
          no-caps
          flat
          class="o2-secondary-button tw-h-[36px] q-ml-md"
          style="color: red !important"
          :class="
            store.state.theme === 'dark'
              ? 'o2-secondary-button-dark'
              : 'o2-secondary-button-light'
          "
          :label="t('panel.discard')"
          @click="goBackToDashboardList"
          data-test="dashboard-panel-discard"
        />
        <q-btn
          class="o2-secondary-button tw-h-[36px] q-ml-md"
          :class="
            store.state.theme === 'dark'
              ? 'o2-secondary-button-dark'
              : 'o2-secondary-button-light'
          "
          no-caps
          flat
          :label="t('panel.save')"
          data-test="dashboard-panel-save"
          @click.stop="savePanelData.execute()"
          :loading="savePanelData.isLoading.value"
        />
        <template
          v-if="!['html', 'markdown'].includes(dashboardPanelData.data.type)"
        >
          <q-btn
            v-if="config.isEnterprise === 'false'"
            data-test="dashboard-apply"
            class="tw-h-[36px] q-ml-md o2-primary-button"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            no-caps
            flat
            dense
            :disable="searchRequestTraceIds.length > 0"
            :label="t('panel.apply')"
            @click="() => runQuery(false)"
          />
          <q-btn-group
            v-if="config.isEnterprise === 'true'"
            class="tw-h-[36px] q-ml-md o2-primary-button"
            style="padding-left: 0px !important ; padding-right: 0px !important"
            :class="
              store.state.theme === 'dark'
                ? searchRequestTraceIds.length > 0
                  ? 'o2-negative-button-dark'
                  : 'o2-secondary-button-dark'
                : searchRequestTraceIds.length > 0
                  ? 'o2-negative-button-light'
                  : 'o2-secondary-button-light'
            "
          >
            <q-btn
              :data-test="
                searchRequestTraceIds.length > 0
                  ? 'dashboard-cancel'
                  : 'dashboard-apply'
              "
              no-caps
              :label="
                searchRequestTraceIds.length > 0
                  ? t('panel.cancel')
                  : t('panel.apply')
              "
              @click="onApplyBtnClick"
            />

            <q-btn-dropdown
              class="text-bold no-border tw-px-0"
              no-caps
              auto-close
              dropdown-icon="keyboard_arrow_down"
              :disable="searchRequestTraceIds.length > 0"
            >
              <q-list>
                <q-item
                  clickable
                  @click="runQuery(true)"
                  :disable="searchRequestTraceIds.length > 0"
                >
                  <q-item-section avatar>
                    <q-icon
                      size="xs"
                      name="refresh"
                      style="align-items: baseline; padding: 0px"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label
                      style="
                        font-size: 12px;
                        align-items: baseline;
                        padding: 0px;
                      "
                      >Refresh Cache & Apply</q-item-label
                    >
                  </q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </q-btn-group>
        </template>
      </div>
    </div>
    </div>
    <div>
      <div class="row" style="overflow-y: auto">
        <div class="tw-pl-[0.625rem]">
          <div
            class="col scroll card-container tw-mr-[0.625rem]"
            style="
              overflow-y: auto;
              height: 100%;
              min-width: 100px;
              max-width: 100px;
            "
          >
            <ChartSelection
              v-model:selectedChartType="dashboardPanelData.data.type"
              @update:selected-chart-type="resetAggregationFunction"
            />
          </div>
        </div>
        <q-separator vertical />
        <!-- for query related chart only -->
        <div
          v-if="
            !['html', 'markdown', 'custom_chart'].includes(
              dashboardPanelData.data.type,
            )
          "
          class="col tw-mr-[0.625rem]"
          style="display: flex; flex-direction: row; overflow-x: hidden"
        >
          <!-- collapse field list bar -->
          <div
            v-if="!dashboardPanelData.layout.showFieldList"
            class="field-list-sidebar-header-collapsed card-container"
            @click="collapseFieldList"
            style="width: 50px; height: 100%; flex-shrink: 0"
          >
            <q-icon
              name="expand_all"
              class="field-list-collapsed-icon rotate-90"
              data-test="dashboard-field-list-collapsed-icon"
            />
            <div class="field-list-collapsed-title">
              {{ t("panel.fields") }}
            </div>
          </div>
          <q-splitter
            v-model="dashboardPanelData.layout.splitter"
            :limits="[0, 20]"
            :style="{
              width: dashboardPanelData.layout.showFieldList
                ? '100%'
                : 'calc(100% - 50px)',
              height: '100%',
            }"
          >
            <template #before>
              <div class="tw-w-full tw-h-full tw-pb-[0.625rem]">
                <div
                  v-if="dashboardPanelData.layout.showFieldList"
                  class="col scroll card-container"
                  style="height: calc(100vh - 110px); overflow-y: auto"
                >
                  <div class="column" style="height: 100%">
                    <div class="col-auto q-pa-sm">
                      <span class="text-weight-bold">{{
                        t("panel.fields")
                      }}</span>
                    </div>
                    <div class="col" style="width: 100%">
                      <!-- <GetFields :editMode="editMode" /> -->
                      <FieldList :editMode="editMode" />
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template #separator>
              <div class="splitter-vertical splitter-enabled"></div>
              <q-btn
                color="primary"
                size="sm"
                :icon="
                  dashboardPanelData.layout.showFieldList
                    ? 'chevron_left'
                    : 'chevron_right'
                "
                dense
                round
                :class="
                  dashboardPanelData.layout.showFieldList
                    ? 'splitter-icon-expand'
                    : 'splitter-icon-collapse'
                "
                style="top: 14px; z-index: 100"
                @click.stop="collapseFieldList"
              />
            </template>
            <template #after>
              <div class="row card-container">
                <div
                  class="col scroll"
                  style="height: calc(100vh - 110px); overflow-y: auto"
                >
                  <div class="layout-panel-container col">
                    <DashboardQueryBuilder
                      :dashboardData="currentDashboardData.data"
                    />
                    <q-separator />
                    <VariablesValueSelector
                      v-if="
                        dateTimeForVariables ||
                        (dashboardPanelData.meta.dateTime &&
                          dashboardPanelData.meta.dateTime.start_time &&
                          dashboardPanelData.meta.dateTime.end_time)
                      "
                      :variablesConfig="filteredVariablesConfig"
                      :showDynamicFilters="
                        currentDashboardData.data?.variables?.showDynamicFilters
                      "
                      :selectedTimeDate="
                        dateTimeForVariables || dashboardPanelData.meta.dateTime
                      "
                      @variablesData="variablesDataUpdated"
                      :initialVariableValues="initialVariableValues"
                    />

                    <div v-if="isOutDated" class="tw-p-2">
                      <div
                        :style="{
                          borderColor: '#c3920d',
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          backgroundColor:
                            store.state.theme == 'dark' ? '#2a1f03' : '#faf2da',
                          padding: '1%',
                          borderRadius: '5px',
                        }"
                      >
                        <div style="font-weight: 700">
                          Your chart is not up to date
                        </div>
                        <div>
                          Chart Configuration / Variables has been updated, but
                          the chart was not updated automatically. Click on the
                          "Apply" button to run the query again
                        </div>
                      </div>
                    </div>
                    <div class="tw-flex tw-justify-end tw-mr-2 tw-items-center">
                      <!-- Error/Warning tooltips moved here -->
                      <q-btn
                        v-if="errorMessage"
                        :icon="outlinedWarning"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-error-data-inline"
                        class="warning q-mr-xs"
                      >
                        <q-tooltip
                          anchor="bottom right"
                          self="top right"
                          max-width="220px"
                        >
                          <div style="white-space: pre-wrap">
                            {{ errorMessage }}
                          </div>
                        </q-tooltip>
                      </q-btn>
                      <q-btn
                        v-if="maxQueryRangeWarning"
                        :icon="outlinedWarning"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-max-duration-warning-inline"
                        class="warning q-mr-xs"
                      >
                        <q-tooltip
                          anchor="bottom right"
                          self="top right"
                          max-width="220px"
                        >
                          <div style="white-space: pre-wrap">
                            {{ maxQueryRangeWarning }}
                          </div>
                        </q-tooltip>
                      </q-btn>
                      <q-btn
                        v-if="limitNumberOfSeriesWarningMessage"
                        :icon="symOutlinedDataInfoAlert"
                        flat
                        size="xs"
                        padding="2px"
                        data-test="dashboard-panel-series-limit-warning-inline"
                        class="warning q-mr-xs"
                      >
                        <q-tooltip
                          anchor="bottom right"
                          self="top right"
                          max-width="220px"
                        >
                          <div style="white-space: pre-wrap">
                            {{ limitNumberOfSeriesWarningMessage }}
                          </div>
                        </q-tooltip>
                      </q-btn>
                      <span v-if="lastTriggeredAt" class="lastRefreshedAt">
                        <span class="lastRefreshedAtIcon">🕑</span
                        ><RelativeTime
                          :timestamp="lastTriggeredAt"
                          fullTimePrefix="Last Refreshed At: "
                        />
                      </span>
                    </div>
                    <div class="tw-h-[calc(100vh-500px)] tw-min-h-[140px]">
                      <PanelSchemaRenderer
                        v-if="chartData"
                        @metadata-update="metaDataValue"
                        @result-metadata-update="handleResultMetadataUpdate"
                        @limit-number-of-series-warning-message-update="
                          handleLimitNumberOfSeriesWarningMessage
                        "
                        :key="dashboardPanelData.data.type"
                        :panelSchema="chartData"
                        :dashboard-id="queryParams?.dashboard"
                        :folder-id="queryParams?.folder"
                        :selectedTimeObj="dashboardPanelData.meta.dateTime"
                        :variablesData="updatedVariablesData"
                        :allowAnnotationsAdd="editMode"
                        :width="6"
                      :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                        @error="handleChartApiError"
                        @updated:data-zoom="onDataZoom"
                        @updated:vrlFunctionFieldList="
                          updateVrlFunctionFieldList
                        "
                        @last-triggered-at-update="handleLastTriggeredAtUpdate"
                        searchType="dashboards"
                        @series-data-update="seriesDataUpdate"
                      />
                      <q-dialog v-model="showViewPanel">
                        <QueryInspector
                          :metaData="metaData"
                          :data="panelTitle"
                        ></QueryInspector>
                      </q-dialog>
                    </div>
                    <DashboardErrorsComponent
                      :errors="errorData"
                      class="col-auto"
                      style="flex-shrink: 0"
                    />
                  </div>
                  <div class="row column tw-h-[calc(100vh-180px)]">
                    <DashboardQueryEditor />
                  </div>
                </div>
                <q-separator vertical />
                <div class="col-auto">
                  <PanelSidebar
                    :title="t('dashboard.configLabel')"
                    v-model="dashboardPanelData.layout.isConfigPanelOpen"
                  >
                    <ConfigPanel
                      :dashboardPanelData="dashboardPanelData"
                      :variablesData="updatedVariablesData"
                      :panelData="seriesData"
                    />
                  </PanelSidebar>
                </div>
              </div>
            </template>
          </q-splitter>
        </div>
        <div
          v-if="dashboardPanelData.data.type == 'html'"
          class="col column"
          style="width: 100%; height: calc(100vh - 99px); flex: 1"
        >
          <div class="card-container tw-h-full tw-flex tw-flex-col">
            <VariablesValueSelector
              :variablesConfig="currentDashboardData.data?.variables"
              :showDynamicFilters="
                currentDashboardData.data?.variables?.showDynamicFilters
              "
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="variablesDataUpdated"
              :initialVariableValues="initialVariableValues"
              class="tw-flex-shrink-0 q-mb-sm"
            />
            <CustomHTMLEditor
              v-model="dashboardPanelData.data.htmlContent"
              style="flex: 1; min-height: 0"
              :initialVariableValues="updatedVariablesData"
            />
            <DashboardErrorsComponent :errors="errorData" class="tw-flex-shrink-0" />
          </div>
        </div>
        <div
          v-if="dashboardPanelData.data.type == 'markdown'"
          class="col column"
          style="width: 100%; height: calc(100vh - 99px); flex: 1"
        >
          <div class="card-container tw-h-full tw-flex tw-flex-col">
            <VariablesValueSelector
              :variablesConfig="currentDashboardData.data?.variables"
              :showDynamicFilters="
                currentDashboardData.data?.variables?.showDynamicFilters
              "
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="variablesDataUpdated"
              :initialVariableValues="initialVariableValues"
              class="tw-flex-shrink-0 q-mb-sm"
            />
            <CustomMarkdownEditor
              v-model="dashboardPanelData.data.markdownContent"
              style="flex: 1; min-height: 0"
              :initialVariableValues="updatedVariablesData"
            />
            <DashboardErrorsComponent :errors="errorData" class="tw-flex-shrink-0" />
          </div>
        </div>
        <div
          v-if="dashboardPanelData.data.type == 'custom_chart'"
          class="col"
          style="
            overflow-y: auto;
            display: flex;
            flex-direction: row;
            overflow-x: hidden;
          "
        >
          <!-- collapse field list bar -->
          <div
            v-if="!dashboardPanelData.layout.showFieldList"
            class="field-list-sidebar-header-collapsed card-container"
            @click="collapseFieldList"
            style="width: 50px; height: 100%; flex-shrink: 0"
          >
            <q-icon
              name="expand_all"
              class="field-list-collapsed-icon rotate-90"
              data-test="dashboard-field-list-collapsed-icon"
            />
            <div class="field-list-collapsed-title">
              {{ t("panel.fields") }}
            </div>
          </div>
          <q-splitter
            v-model="dashboardPanelData.layout.splitter"
            :limits="[0, 20]"
            :style="{
              width: dashboardPanelData.layout.showFieldList
                ? '100%'
                : 'calc(100% - 50px)',
              height: '100%',
            }"
          >
            <template #before>
              <div
                class="tw-w-full tw-h-full tw-pr-[0.625rem] tw-pb-[0.625rem]"
              >
                <div
                  class="col scroll card-container"
                  style="height: calc(100vh - 99px); overflow-y: auto"
                >
                  <div
                    v-if="dashboardPanelData.layout.showFieldList"
                    class="column"
                    style="height: 100%"
                  >
                    <div class="col-auto q-pa-sm">
                      <span class="text-weight-bold">{{
                        t("panel.fields")
                      }}</span>
                    </div>
                    <div class="col" style="width: 100%">
                      <!-- <GetFields :editMode="editMode" /> -->
                      <FieldList :editMode="editMode" />
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template #separator>
              <div class="splitter-vertical splitter-enabled"></div>
              <q-btn
                color="primary"
                size="sm"
                :icon="
                  dashboardPanelData.layout.showFieldList
                    ? 'chevron_left'
                    : 'chevron_right'
                "
                dense
                round
                style="top: 14px; z-index: 100"
                @click="collapseFieldList"
              />
            </template>
            <template #after>
              <div
                class="row card-container"
                style="height: calc(100vh - 99px); overflow-y: auto"
              >
                <div class="col scroll" style="height: 100%">
                  <div
                    class="layout-panel-container tw-h-[calc(100vh-200px)] col"
                  >
                    <q-splitter
                      class="query-editor-splitter"
                      v-model="splitterModel"
                      style="height: 100%"
                      @update:model-value="layoutSplitterUpdated"
                    >
                      <template #before>
                        <CustomChartEditor
                          v-model="dashboardPanelData.data.customChartContent"
                          style="width: 100%; height: 100%"
                        />
                      </template>
                      <template #separator>
                        <div class="splitter-vertical splitter-enabled"></div>
                        <q-avatar
                          color="primary"
                          text-color="white"
                          size="20px"
                          icon="drag_indicator"
                          style="top: 10px; left: 3.5px"
                          data-test="dashboard-markdown-editor-drag-indicator"
                        />
                      </template>
                      <template #after>
                        <PanelSchemaRenderer
                          v-if="chartData"
                          @metadata-update="metaDataValue"
                          @result-metadata-update="handleResultMetadataUpdate"
                          @limit-number-of-series-warning-message-update="
                            handleLimitNumberOfSeriesWarningMessage
                          "
                          :key="dashboardPanelData.data.type"
                          :panelSchema="chartData"
                          :dashboard-id="queryParams?.dashboard"
                          :folder-id="queryParams?.folder"
                          :selectedTimeObj="dashboardPanelData.meta.dateTime"
                          :variablesData="updatedVariablesData"
                          :width="6"
                        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                          @error="handleChartApiError"
                          @updated:data-zoom="onDataZoom"
                          @updated:vrlFunctionFieldList="
                            updateVrlFunctionFieldList
                          "
                          @last-triggered-at-update="
                            handleLastTriggeredAtUpdate
                          "
                          searchType="dashboards"
                          @series-data-update="seriesDataUpdate"
                        />
                      </template>
                    </q-splitter>
                  </div>
                  <div class="col-auto" style="flex-shrink: 0">
                    <DashboardErrorsComponent
                      :errors="errorData"
                      class="col-auto"
                      style="flex-shrink: 0"
                    />
                  </div>
                  <div class="row column tw-h-[calc(100vh-180px)]">
                    <DashboardQueryEditor />
                  </div>
                </div>
                <q-separator vertical />
                <div class="col-auto">
                  <PanelSidebar
                    :title="t('dashboard.configLabel')"
                    v-model="dashboardPanelData.layout.isConfigPanelOpen"
                  >
                    <ConfigPanel
                      :dashboardPanelData="dashboardPanelData"
                      :variablesData="updatedVariablesData"
                      :panelData="seriesData"
                    />
                  </PanelSidebar>
                </div>
              </div>
            </template>
          </q-splitter>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  toRaw,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
  defineAsyncComponent,
} from "vue";
import PanelSidebar from "../../../components/dashboards/addPanel/PanelSidebar.vue";
import ChartSelection from "../../../components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "../../../components/dashboards/addPanel/FieldList.vue";

import { useI18n } from "vue-i18n";
import {
  addPanel,
  checkIfVariablesAreLoaded,
  getDashboard,
  getPanel,
  updatePanel,
} from "../../../utils/commons";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import DashboardQueryBuilder from "../../../components/dashboards/addPanel/DashboardQueryBuilder.vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue";
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import { useLoading } from "@/composables/useLoading";
import { debounce, isEqual } from "lodash-es";
import { provide } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import useAiChat from "@/composables/useAiChat";
import useStreams from "@/composables/useStreams";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import {
  createDashboardsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { getScopeType } from "@/utils/dashboard/variables/variablesScopeUtils";

const ConfigPanel = defineAsyncComponent(() => {
  return import("../../../components/dashboards/addPanel/ConfigPanel.vue");
});

const QueryInspector = defineAsyncComponent(() => {
  return import("@/components/dashboards/QueryInspector.vue");
});

const CustomHTMLEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/CustomHTMLEditor.vue");
});

const CustomMarkdownEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/CustomMarkdownEditor.vue");
});
const CustomChartEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/CustomChartEditor.vue");
});

export default defineComponent({
  name: "AddPanel",
  props: ["metaData"],

  components: {
    ChartSelection,
    FieldList,
    DashboardQueryBuilder,
    DateTimePickerDashboard,
    DashboardErrorsComponent,
    PanelSidebar,
    ConfigPanel,
    VariablesValueSelector,
    PanelSchemaRenderer,
    RelativeTime,
    DashboardQueryEditor: defineAsyncComponent(
      () => import("@/components/dashboards/addPanel/DashboardQueryEditor.vue"),
    ),
    QueryInspector,
    CustomHTMLEditor,
    CustomMarkdownEditor,
    CustomChartEditor,
  },
  setup(props) {
    provide("dashboardPanelDataPageKey", "dashboard");

    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const {
      showErrorNotification,
      showPositiveNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetDashboardPanelDataAndAddTimeField,
      resetAggregationFunction,
      validatePanel,
    } = useDashboardPanelData("dashboard");
    const editMode = ref(false);
    const selectedDate: any = ref(null);
    const dateTimePickerRef: any = ref(null);
    const splitterModel = ref(50);
    const errorData: any = reactive({
      errors: [],
    });
    let variablesData: any = reactive({});
    const { registerAiChatHandler, removeAiChatHandler } = useAiChat();
    const { getStream } = useStreams();
    const seriesData = ref([]);
    const shouldRefreshWithoutCache = ref(false);

    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };

    // Warning messages
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");
    const errorMessage = ref("");

    // to store and show when the panel was last loaded
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    // used to provide values to chart only when apply is clicked (same as chart data)
    let updatedVariablesData: any = reactive({});

    // this is used to again assign query params on discard or save
    let routeQueryParamsOnMount: any = {};

    // ======= [START] default variable values

    const initialVariableValues: any = { value: {} };
    Object.keys(route.query).forEach((key) => {
      if (key.startsWith("var-")) {
        const newKey = key.slice(4);
        initialVariableValues.value[newKey] = route.query[key];
      }
    });
    // ======= [END] default variable values

    const metaData = ref(null);
    const showViewPanel = ref(false);
    const metaDataValue = (metadata: any) => {
      // console.time("metaDataValue");
      metaData.value = metadata;
      // console.timeEnd("metaDataValue");
    };

    //dashboard tutorial link on click
    const showTutorial = () => {
      window.open("https://short.openobserve.ai/dashboard-tutorial");
    };
    let needsVariablesAutoUpdate = true;

    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);

      // change route query params based on current variables values
      const variableObj: any = {};
      data.values.forEach((variable: any) => {
        if (variable.type === "dynamic_filters") {
          const filters = (variable.value || []).filter(
            (item: any) => item.name && item.operator && item.value,
          );
          const encodedFilters = filters.map((item: any) => ({
            name: item.name,
            operator: item.operator,
            value: item.value,
          }));
          variableObj[`var-${variable.name}`] = encodeURIComponent(
            JSON.stringify(encodedFilters),
          );
        } else {
          variableObj[`var-${variable.name}`] = variable.value;
        }
      });

      router.replace({
        query: {
          ...route.query,
          ...variableObj,
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });

      if (["html", "markdown"].includes(dashboardPanelData.data.type)) {
        Object.assign(updatedVariablesData, variablesData);
      } else if (needsVariablesAutoUpdate) {
        // check if the length is > 0
        if (checkIfVariablesAreLoaded(variablesData)) {
          needsVariablesAutoUpdate = false;
        }
        Object.assign(updatedVariablesData, variablesData);
      }
    };

    const currentDashboardData: any = reactive({
      data: {},
    });

    // Helper to determine scope type (matching VariableSettings.vue logic)
    // Computed property to filter variables for the current panel
    // Shows only: global variables + tab variables (for current tab) + panel variables (for current panel)
    const filteredVariablesConfig = computed(() => {
      if (!currentDashboardData.data?.variables) {
        return currentDashboardData.data?.variables;
      }

      const currentPanelId = route.query.panelId as string;
      const currentTabId = route.query.tab as string;

      const filteredList = currentDashboardData.data.variables.list.filter(
        (variable: any) => {
          const scopeType = getScopeType(variable);

          // Always include global variables
          if (scopeType === "global") {
            return true;
          }

          // Include tab variables if they belong to current tab
          if (scopeType === "tabs" && currentTabId) {
            return variable.tabs.includes(currentTabId);
          }

          // Include panel variables if they belong to current panel
          if (scopeType === "panels" && currentPanelId) {
            return variable.panels.includes(currentPanelId);
          }

          return false;
        },
      );

      return {
        ...currentDashboardData.data.variables,
        list: filteredList,
      };
    });

    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false;
    const isPanelConfigChanged = ref(false);

    const savePanelData = useLoading(async () => {
      // console.time("savePanelData");
      const dashboardId = route.query.dashboard + "";
      await savePanelChangesToDashboard(dashboardId);
      // console.timeEnd("savePanelData");
    });

    onUnmounted(async () => {
      // console.time("onUnmounted");
      // clear a few things
      resetDashboardPanelData();

      // remove beforeUnloadHandler event listener
      window.removeEventListener("beforeunload", beforeUnloadHandler);

      removeAiContextHandler();

      // Clean up dashboard context provider
      contextRegistry.unregister("dashboards");
      contextRegistry.setActive("");

      // console.timeEnd("onUnmounted");

      // Clear all refs to prevent memory leaks
      dateTimePickerRef.value = null;
    });

    onMounted(async () => {
      // assign the route query params
      routeQueryParamsOnMount = JSON.parse(JSON.stringify(route?.query ?? {}));

      errorData.errors = [];

      // console.time("onMounted");
      // todo check for the edit more
      if (route.query.panelId) {
        editMode.value = true;
        const panelData = await getPanel(
          store,
          route.query.dashboard,
          route.query.panelId,
          route.query.folder,
          route.query.tab,
        );

        try {
          Object.assign(
            dashboardPanelData.data,
            JSON.parse(JSON.stringify(panelData ?? {})),
          );
        } catch (e) {
          console.error("Error while parsing panel data", e);
        }

        // check if vrl function exists
        if (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].vrlFunctionQuery
        ) {
          // enable vrl function editor
          dashboardPanelData.layout.vrlFunctionToggle = true;
        }

        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        updateDateTime(selectedDate.value);
      } else {
        editMode.value = false;
        resetDashboardPanelDataAndAddTimeField();
        chartData.value = {};
        // set the value of the date time after the reset
        updateDateTime(selectedDate.value);
      }
      // console.timeEnd("onMounted");
      // let it call the wathcers and then mark the panel config watcher as activated
      await nextTick();
      isPanelConfigWatcherActivated = true;

      //event listener before unload and data is updated
      window.addEventListener("beforeunload", beforeUnloadHandler);
      // console.time("add panel loadDashboard");
      loadDashboard();

      registerAiContextHandler();

      // Set up dashboard context provider
      const dashboardProvider = createDashboardsContextProvider(
        route,
        store,
        dashboardPanelData,
        editMode.value,
      );
      contextRegistry.register("dashboards", dashboardProvider);
      contextRegistry.setActive("dashboards");

      // console.timeEnd("add panel loadDashboard");
    });

    let list = computed(function () {
      return [toRaw(store.state.currentSelectedDashboard)];
    });

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    /**
     * Retrieves the selected date from the query parameters.
     */
    const getSelectedDateFromQueryParams = (params: any) => ({
      valueType: params.period
        ? "relative"
        : params.from && params.to
          ? "absolute"
          : "relative",
      startTime: params.from ? params.from : null,
      endTime: params.to ? params.to : null,
      relativeTimePeriod: params.period ? params.period : "15m",
    });

    // const getDashboard = () => {
    //   return currentDashboard.dashboardId;
    // };
    const loadDashboard = async () => {
      // console.time("AddPanel:loadDashboard");
      let data = JSON.parse(
        JSON.stringify(
          (await getDashboard(
            store,
            route.query.dashboard,
            route.query.folder ?? "default",
          )) ?? {},
        ),
      );
      // console.timeEnd("AddPanel:loadDashboard");

      // console.time("AddPanel:loadDashboard:after");
      currentDashboardData.data = data;

      if (
        !currentDashboardData?.data ||
        typeof currentDashboardData.data !== "object" ||
        !Object.keys(currentDashboardData.data).length
      ) {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
        forceSkipBeforeUnloadListener = true;
        goBack();
        return;
      }

      // if variables data is null, set it to empty list
      if (
        !(
          currentDashboardData.data?.variables &&
          currentDashboardData.data?.variables?.list.length
        )
      ) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }

      // check if route has time related query params
      // if not, take dashboard default time settings
      if (!((route.query.from && route.query.to) || route.query.period)) {
        // if dashboard has relative time settings
        if (
          (currentDashboardData.data?.defaultDatetimeDuration?.type ??
            "relative") === "relative"
        ) {
          selectedDate.value = {
            valueType: "relative",
            relativeTimePeriod:
              currentDashboardData.data?.defaultDatetimeDuration
                ?.relativeTimePeriod ?? "15m",
          };
        } else {
          // else, dashboard will have absolute time settings
          selectedDate.value = {
            valueType: "absolute",
            startTime:
              currentDashboardData.data?.defaultDatetimeDuration?.startTime,
            endTime:
              currentDashboardData.data?.defaultDatetimeDuration?.endTime,
          };
        }
      } else {
        // take route time related query params
        selectedDate.value = getSelectedDateFromQueryParams(route.query);
      }
    };

    const isInitialDashboardPanelData = () => {
      return (
        dashboardPanelData.data.description == "" &&
        !dashboardPanelData.data.config.unit &&
        !dashboardPanelData.data.config.unit_custom &&
        dashboardPanelData.data.queries[0].fields.x.length == 0 &&
        dashboardPanelData.data.queries[0].fields?.breakdown?.length == 0 &&
        dashboardPanelData.data.queries[0].fields.y.length == 0 &&
        dashboardPanelData.data.queries[0].fields.z.length == 0 &&
        dashboardPanelData.data.queries[0].fields.filter.conditions.length ==
          0 &&
        dashboardPanelData.data.queries.length == 1
      );
    };

    const isOutDated = computed(() => {
      //check that is it addpanel initial call
      if (isInitialDashboardPanelData() && !editMode.value) return false;
      //compare chartdata and dashboardpaneldata and variables data as well

      const normalizeVariables = (obj: any) => {
        const normalized = JSON.parse(JSON.stringify(obj));
        // Sort arrays to ensure consistent ordering
        if (normalized.values) {
          normalized.values = normalized.values
            .map((variable: any) => {
              if (Array.isArray(variable.value)) {
                variable.value.sort((a: any, b: any) =>
                  JSON.stringify(a).localeCompare(JSON.stringify(b)),
                );
              }
              return variable;
            })
            .sort((a: any, b: any) => a.name.localeCompare(b.name));
        }
        return normalized;
      };

      const normalizedCurrent = normalizeVariables(variablesData);
      const normalizedRefreshed = normalizeVariables(updatedVariablesData);
      const variablesChanged = !isEqual(normalizedCurrent, normalizedRefreshed);

      const configChanged = !isEqual(chartData.value, dashboardPanelData.data);
      let configNeedsApiCall = false;

      if (configChanged) {
        configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          dashboardPanelData.data,
        );
      }

      return configNeedsApiCall || variablesChanged;
    });

    watch(isOutDated, () => {
      window.dispatchEvent(new Event("resize"));
    });

    watch(
      () => dashboardPanelData.data.type,
      async () => {
        // console.time("watch:dashboardPanelData.data.type");
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        // console.timeEnd("watch:dashboardPanelData.data.type");
      },
    );
    const dateTimeForVariables = ref(null);

    const setTimeForVariables = () => {
      const date = dateTimePickerRef.value?.getConsumableDateTime();
      const startTime = new Date(date.startTime);
      const endTime = new Date(date.endTime);

      // Update only the variables time object
      dateTimeForVariables.value = {
        start_time: startTime,
        end_time: endTime,
      };
    };
    watch(selectedDate, () => {
      // console.time("watch:selectedDate");
      updateDateTime(selectedDate.value);
      // console.timeEnd("watch:selectedDate");
    });

    // resize the chart when config panel is opened and closed
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        // console.time("watch:dashboardPanelData.layout.isConfigPanelOpen");
        window.dispatchEvent(new Event("resize"));
        // console.timeEnd("watch:dashboardPanelData.layout.isConfigPanelOpen");
      },
    );

    // resize the chart when query editor is opened and closed
    watch(
      () => dashboardPanelData.layout.showQueryBar,
      (newValue) => {
        // console.time("watch:dashboardPanelData.layout.showQueryBar");
        if (!newValue) {
          dashboardPanelData.layout.querySplitter = 41;
        } else {
          if (expandedSplitterHeight.value !== null) {
            dashboardPanelData.layout.querySplitter =
              expandedSplitterHeight.value;
          }
        }
        // console.timeEnd("watch:dashboardPanelData.layout.showQueryBar");
      },
    );

    const runQuery = (withoutCache = false) => {
      try {
        // console.time("runQuery");
        if (!isValid(true, true)) {
          // do not return if query is not valid
          // allow to fire query
          // return;
        }
        // if (dashboardPanelData.data.type === "custom_chart") {
        //   runJavaScriptCode();
        // }

        // should use cache flag
        shouldRefreshWithoutCache.value = withoutCache;

        // Also update variables data
        Object.assign(
          updatedVariablesData,
          JSON.parse(JSON.stringify(variablesData)),
        );

        // copy the data object excluding the reactivity
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        // refresh the date time based on current time if relative date is selected
        dateTimePickerRef.value && dateTimePickerRef.value.refresh();
        updateDateTime(selectedDate.value);
        // console.timeEnd("runQuery");
      } catch (err) {
        console.log(err);
      }
    };

    const getQueryParamsForDuration = (data: any) => {
      try {
        if (data.valueType === "relative") {
          return {
            period: data.relativeTimePeriod ?? "15m",
          };
        } else if (data.valueType === "absolute") {
          return {
            from: data.startTime,
            to: data.endTime,
            period: null,
          };
        }
        return {};
      } catch (error) {
        return {};
      }
    };

    const updateDateTime = (value: object) => {
      if (selectedDate.value && dateTimePickerRef?.value) {
        const date = dateTimePickerRef.value?.getConsumableDateTime();

        dashboardPanelData.meta.dateTime = {
          start_time: new Date(date.startTime),
          end_time: new Date(date.endTime),
        };

        dateTimeForVariables.value = {
          start_time: new Date(selectedDate.value.startTime),
          end_time: new Date(selectedDate.value.endTime),
        };
        router.replace({
          query: {
            ...route.query,
            ...getQueryParamsForDuration(selectedDate.value),
          },
        });
      }
    };

    const goBack = () => {
      return router.push({
        path: "/dashboards/view",
        query: {
          ...routeQueryParamsOnMount,
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          tab: route.query.tab ?? currentDashboardData?.data?.tabs?.[0]?.tabId,
        },
      });
    };

    //watch dashboardpaneldata when changes, isUpdated will be true
    watch(
      () => dashboardPanelData.data,
      () => {
        // console.time("watch:dashboardPanelData.data");
        if (isPanelConfigWatcherActivated) {
          isPanelConfigChanged.value = true;
        }
        // console.timeEnd("watch:dashboardPanelData.data");
      },
      { deep: true },
    );

    const beforeUnloadHandler = (e: any) => {
      //check is data updated or not
      if (isPanelConfigChanged.value) {
        // Display a confirmation message
        const confirmMessage = t("dashboard.unsavedMessage"); // Some browsers require a return statement to display the message
        e.returnValue = confirmMessage;
        return confirmMessage;
      }
      return;
    };

    // this is used to set to true, when we know we have to force the navigation
    // in cases where org is changed, we need to force a nvaigation, without warning
    let forceSkipBeforeUnloadListener = false;

    onBeforeRouteLeave((to, from, next) => {
      // check if it is a force navigation, then allow
      if (forceSkipBeforeUnloadListener) {
        next();
        return;
      }

      // else continue to warn user
      if (from.path === "/dashboards/add_panel" && isPanelConfigChanged.value) {
        const confirmMessage = t("dashboard.unsavedMessage");
        if (window.confirm(confirmMessage)) {
          // User confirmed, allow navigation
          next();
        } else {
          // User canceled, prevent navigation
          next(false);
        }
      } else {
        // No unsaved changes or not leaving the edit route, allow navigation
        next();
      }
    });
    const panelTitle = computed(() => {
      return { title: dashboardPanelData.data.title };
    });

    //validate the data
    const isValid = (onlyChart = false, isFieldsValidationRequired = true) => {
      const errors = errorData.errors;
      errors.splice(0);
      const dashboardData = dashboardPanelData;

      // check if name of panel is there
      if (!onlyChart) {
        if (
          dashboardData.data.title == null ||
          dashboardData.data.title.trim() == ""
        ) {
          errors.push("Name of Panel is required");
        }
      }

      // will push errors in errors array
      validatePanel(errors, isFieldsValidationRequired);

      // show all the errors
      // for (let index = 0; index < errors.length; index++) {
      //   $q.notify({
      //     type: "negative",
      //     message: errors[index],
      //     timeout: 5000,
      //   });
      // }

      if (errors.length) {
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
      }

      if (errors.length) {
        return false;
      } else {
        return true;
      }
    };

    const savePanelChangesToDashboard = async (dashId: string) => {
      if (
        dashboardPanelData.data.type === "custom_chart" &&
        errorData.errors.length > 0
      ) {
        showErrorNotification(
          "There are some errors, please fix them and try again",
        );
        return;
      }
      if (!isValid(false, true)) {
        return;
      }

      try {
        // console.time("savePanelChangesToDashboard");
        if (editMode.value) {
          const errorMessageOnSave = await updatePanel(
            store,
            dashId,
            dashboardPanelData.data,
            route.query.folder ?? "default",
            route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          );
          if (errorMessageOnSave instanceof Error) {
            errorData.errors.push(
              "Error saving panel configuration : " +
                errorMessageOnSave.message,
            );
            return;
          }
        } else {
          const panelId =
            "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

          dashboardPanelData.data.id = panelId;
          chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

          const errorMessageOnSave = await addPanel(
            store,
            dashId,
            dashboardPanelData.data,
            route.query.folder ?? "default",
            route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          );
          if (errorMessageOnSave instanceof Error) {
            errorData.errors.push(
              "Error saving panel configuration  : " +
                errorMessageOnSave.message,
            );
            return;
          }
        }
        // console.timeEnd("savePanelChangesToDashboard");

        isPanelConfigWatcherActivated = false;
        isPanelConfigChanged.value = false;

        await nextTick();
        return router.push({
          path: "/dashboards/view",
          query: {
            ...routeQueryParamsOnMount,
            org_identifier: store.state.selectedOrganization.identifier,
            dashboard: dashId,
            folder: route.query.folder ?? "default",
            tab: route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          },
        });
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              (editMode.value
                ? "Error while updating panel"
                : "Error while creating panel"),
          );
        } else {
          showErrorNotification(
            error?.message ??
              (editMode.value
                ? "Error while updating panel"
                : "Error while creating panel"),
            {
              timeout: 2000,
            },
          );
        }
      }
    };

    const layoutSplitterUpdated = () => {
      window.dispatchEvent(new Event("resize"));
    };

    watch(
      () => dashboardPanelData.layout.splitter,
      (newVal) => {
        // Only update showFieldList if splitter crosses the threshold
        // This prevents infinite loops and ensures proper sync
        if (newVal > 0 && !dashboardPanelData.layout.showFieldList) {
          dashboardPanelData.layout.showFieldList = true;
        } else if (newVal === 0 && dashboardPanelData.layout.showFieldList) {
          dashboardPanelData.layout.showFieldList = false;
        }
      },
    );

    const expandedSplitterHeight = ref(null);

    const querySplitterUpdated = (newHeight: any) => {
      window.dispatchEvent(new Event("resize"));
      if (dashboardPanelData.layout.showQueryBar) {
        expandedSplitterHeight.value = newHeight;
      }
    };

    const handleChartApiError = (errorMsg: any) => {
      if (typeof errorMsg === "string") {
        errorMessage.value = errorMsg;
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg);
      } else if (errorMsg?.message) {
        errorMessage.value = errorMsg.message ?? "";
        const errorList = errorData.errors ?? [];
        errorList.splice(0);
        errorList.push(errorMsg.message);
      } else {
        errorMessage.value = "";
      }
    };

    // Handle limit number of series warning from PanelSchemaRenderer
    const handleLimitNumberOfSeriesWarningMessage = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };

    const handleResultMetadataUpdate = (metadata: any) => {
      maxQueryRangeWarning.value = processQueryMetadataErrors(
        metadata,
        store.state.timezone,
      );
    };
    const onDataZoom = (event: any) => {
      // console.time("onDataZoom");
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setSeconds(0, 0);
      selectedDateObj.end.setSeconds(0, 0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // set it as a absolute time
      dateTimePickerRef?.value?.setCustomDate("absolute", selectedDateObj);
      // console.timeEnd("onDataZoom");
    };

    const updateVrlFunctionFieldList = (fieldList: any) => {
      // extract all panelSchema alias
      const aliasList: any = [];

      // if auto sql
      if (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery === false
      ) {
        // remove panelschema fields from field list

        // add x axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.x?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add breakdown alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.breakdown?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add y axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.y?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add z axis alias
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.z?.forEach((it: any) => {
          if (!it.isDerived) {
            aliasList.push(it.alias);
          }
        });

        // add latitude alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.latitude?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.latitude?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.latitude.alias,
          );
        }

        // add longitude alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.longitude?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.longitude?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.longitude.alias,
          );
        }

        // add weight alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.weight?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.weight?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.weight.alias,
          );
        }

        // add source alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.source?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.source?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.source.alias,
          );
        }

        // add target alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.target?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.target?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.target.alias,
          );
        }

        // add source alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.value.alias,
          );
        }

        // add name alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.name?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.name?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.name.alias,
          );
        }

        // add value_for_maps alias
        if (
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value_for_maps?.alias &&
          !dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.value_for_maps?.isDerived
        ) {
          aliasList.push(
            dashboardPanelData?.data?.queries[
              dashboardPanelData.layout.currentQueryIndex
            ]?.fields?.value_for_maps.alias,
          );
        }
      }

      // remove custom query fields from field list
      dashboardPanelData.meta.stream.customQueryFields.forEach((it: any) => {
        aliasList.push(it.name);
      });

      // rest will be vrl function fields
      fieldList = fieldList
        .filter(
          (field: any) =>
            !aliasList.some(
              (alias: string) => alias.toLowerCase() === field.toLowerCase(),
            ),
        )
        .map((field: any) => ({ name: field, type: "Utf8" }));

      dashboardPanelData.meta.stream.vrlFunctionFieldList = fieldList;
    };

    const hoveredSeriesState = ref({
      hoveredSeriesName: "",
      panelId: -1,
      dataIndex: -1,
      seriesIndex: -1,
      hoveredTime: null,
      setHoveredSeriesName: function (name: string) {
        hoveredSeriesState.value.hoveredSeriesName = name ?? "";
      },
      setIndex: function (
        dataIndex: number,
        seriesIndex: number,
        panelId: any,
        hoveredTime?: any,
      ) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
        hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
      },
    });

    // used provide and inject to share data between components
    // it is currently used in panelschemarendered, chartrenderer, convertpromqldata(via panelschemarenderer), and convertsqldata
    provide("hoveredSeriesState", hoveredSeriesState);

    // [START] cancel running queries

    //reactive object for loading state of variablesData and panels
    const variablesAndPanelsDataLoadingState = reactive({
      variablesData: {},
      panels: {},
      searchRequestTraceIds: {},
    });

    // provide variablesAndPanelsDataLoadingState to share data between components
    provide(
      "variablesAndPanelsDataLoadingState",
      variablesAndPanelsDataLoadingState,
    );

    const searchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState.searchRequestTraceIds,
      ).filter((item: any) => item.length > 0);

      return searchIds.flat() as string[];
    });
    const { traceIdRef, cancelQuery } = useCancelQuery();

    const cancelAddPanelQuery = () => {
      traceIdRef.value = searchRequestTraceIds.value;
      cancelQuery();
    };

    const disable = ref(false);

    watch(variablesAndPanelsDataLoadingState, () => {
      const panelsValues = Object.values(
        variablesAndPanelsDataLoadingState.panels,
      );
      disable.value = panelsValues.some((item: any) => item === true);
    });

    const collapseFieldList = () => {
      if (dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.splitter = 0;
        dashboardPanelData.layout.showFieldList = false;
      } else {
        dashboardPanelData.layout.splitter = 20;
        dashboardPanelData.layout.showFieldList = true;
      }
    };

    const onApplyBtnClick = () => {
      if (searchRequestTraceIds.value.length > 0) {
        cancelAddPanelQuery();
      } else {
        runQuery();
      }
    };

    // [END] cancel running queries

    const inputStyle = computed(() => {
      if (!dashboardPanelData.data.title) {
        return { width: "200px" };
      }

      const contentWidth = Math.min(
        dashboardPanelData.data.title.length * 8 + 60,
        400,
      );
      return { width: `${contentWidth}px` };
    });

    const debouncedUpdateChartConfig = debounce((newVal, oldVal) => {
      if (!isEqual(chartData.value, newVal)) {
        const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          newVal,
        );

        if (!configNeedsApiCall) {
          chartData.value = JSON.parse(JSON.stringify(newVal));

          window.dispatchEvent(new Event("resize"));
        }
      }
    }, 1000);

    watch(() => dashboardPanelData.data, debouncedUpdateChartConfig, {
      deep: true,
    });
    // [START] ai chat

    // [START] O2 AI Context Handler

    const registerAiContextHandler = () => {
      registerAiChatHandler(getContext);
    };

    const getContext = async () => {
      return new Promise(async (resolve, reject) => {
        try {
          const isAddPanelPage = router.currentRoute.value.name === "addPanel";

          const isStreamSelectedInDashboardPage =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          if (!isAddPanelPage || !isStreamSelectedInDashboardPage) {
            resolve("");
            return;
          }

          const payload = {};

          const stream =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream;

          const streamType =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream_type;

          if (!streamType || !stream?.length) {
            resolve("");
            return;
          }

          const schema = await getStream(stream, streamType, true);

          payload["stream_name"] = stream;
          payload["schema"] = schema.uds_schema || schema.schema || [];

          resolve(payload);
        } catch (error) {
          console.error("Error in getContext for add panel page", error);
          resolve("");
        }
      });
    };

    const removeAiContextHandler = () => {
      removeAiChatHandler();
    };

    // [END] O2 AI Context Handler

    return {
      t,
      updateDateTime,
      goBack,
      savePanelChangesToDashboard,
      runQuery,
      layoutSplitterUpdated,
      expandedSplitterHeight,
      querySplitterUpdated,
      currentDashboard,
      list,
      dashboardPanelData,
      chartData,
      editMode,
      selectedDate,
      errorData,
      handleChartApiError,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      updatedVariablesData,
      filteredVariablesConfig,
      savePanelData,
      resetAggregationFunction,
      isOutDated,
      store,
      dateTimePickerRef,
      showViewPanel,
      metaDataValue,
      metaData,
      panelTitle,
      onDataZoom,
      showTutorial,
      updateVrlFunctionFieldList,
      queryParams: route.query as any,
      initialVariableValues,
      lastTriggeredAt,
      handleLastTriggeredAtUpdate,
      searchRequestTraceIds,
      cancelAddPanelQuery,
      disable,
      config,
      collapseFieldList,
      splitterModel,
      inputStyle,
      setTimeForVariables,
      dateTimeForVariables,
      seriesDataUpdate,
      seriesData,
      onApplyBtnClick,
      shouldRefreshWithoutCache,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      errorMessage,
      handleLimitNumberOfSeriesWarningMessage,
      handleResultMetadataUpdate,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      outlinedRunningWithErrors,
    };
  },
  methods: {
    goBackToDashboardList(evt: any, row: any) {
      this.goBack();
    },
  },
});
</script>

<style lang="scss" scoped>
.layout-panel-container {
  display: flex;
  flex-direction: column;
}

.splitter {
  height: 4px;
  width: 100%;
}
.splitter-vertical {
  width: 4px;
  height: 100%;
}
.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}

.splitter-enabled:hover {
  background-color: orange;
}

:deep(.query-editor-splitter .q-splitter__separator) {
  background-color: transparent !important;
}

.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}

.dynamic-input {
  min-width: 200px;
  max-width: 500px;
  transition: width 0.2s ease;
}

.warning {
  color: var(--q-warning);
}
</style>
