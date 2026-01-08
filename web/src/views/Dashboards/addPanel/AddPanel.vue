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
    <div class="tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs">
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
            class="q-mr-sm tw:h-[36px] el-border"
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
            class="q-mr-sm tw:h-[36px] el-border"
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
            class="tw:h-[36px]"
            @hide="setTimeForVariables"
          />
          <q-btn
            outline
            color="red"
            no-caps
            flat
            class="o2-secondary-button tw:h-[36px] q-ml-md"
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
            class="o2-secondary-button tw:h-[36px] q-ml-md"
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
              class="tw:h-[36px] q-ml-md o2-primary-button"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-primary-button-dark'
                  : 'o2-primary-button-light'
              "
              no-caps
              flat
              dense
              :loading="searchRequestTraceIds.length > 0"
              :disable="searchRequestTraceIds.length > 0"
              :label="t('panel.apply')"
              @click="() => runQuery(false)"
            />
            <q-btn-group
              v-if="config.isEnterprise === 'true'"
              class="tw:h-[36px] q-ml-md o2-primary-button"
              style="
                padding-left: 0px !important ;
                padding-right: 0px !important;
                display: inline-flex;
              "
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
                class="text-bold no-border tw:px-0"
                no-caps
                flat
                dense
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
        <div class="tw:pl-[0.625rem]">
          <div
            class="col scroll card-container tw:mr-[0.625rem]"
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
          class="col tw:mr-[0.625rem]"
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
              <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
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
                      @custom-chart-template-selected="
                        handleCustomChartTemplateSelected
                      "
                    />
                    <q-separator />
                    <VariablesValueSelector
                      v-if="
                        dateTimeForVariables ||
                        (dashboardPanelData.meta.dateTime &&
                          dashboardPanelData.meta.dateTime.start_time &&
                          dashboardPanelData.meta.dateTime.end_time)
                      "
                      :variablesConfig="currentDashboardData.data?.variables"
                      :showDynamicFilters="
                        currentDashboardData.data?.variables?.showDynamicFilters
                      "
                      :selectedTimeDate="
                        dateTimeForVariables || dashboardPanelData.meta.dateTime
                      "
                      @variablesData="variablesDataUpdated"
                      @openAddVariable="handleOpenAddVariable"
                      :initialVariableValues="initialVariableValues"
                      :showAddVariableButton="true"
                      :showAllVisible="true"
                      :tabId="currentTabId"
                      :panelId="currentPanelId"
                    />

                    <div v-if="isOutDated" class="tw:p-2">
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
                    <div class="tw:flex tw:justify-end tw:mr-2 tw:items-center">
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
                    <div class="tw:h-[calc(100vh-500px)] tw:min-h-[140px]">
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
                        :showLegendsButton="true"
                        @error="handleChartApiError"
                        @updated:data-zoom="onDataZoom"
                        @updated:vrlFunctionFieldList="
                          updateVrlFunctionFieldList
                        "
                        @last-triggered-at-update="handleLastTriggeredAtUpdate"
                        searchType="dashboards"
                        @series-data-update="seriesDataUpdate"
                        @show-legends="showLegendsDialog = true"
                        ref="panelSchemaRendererRef"
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
                  <div class="row column tw:h-[calc(100vh-180px)]">
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
          <div class="card-container tw:h-full tw:flex tw:flex-col">
            <VariablesValueSelector
              :variablesConfig="currentDashboardData.data?.variables"
              :showDynamicFilters="
                currentDashboardData.data?.variables?.showDynamicFilters
              "
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="variablesDataUpdated"
              :initialVariableValues="initialVariableValues"
              class="tw:flex-shrink-0 q-mb-sm"
              :showAddVariableButton="true"
              :showAllVisible="true"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <CustomHTMLEditor
              v-model="dashboardPanelData.data.htmlContent"
              style="flex: 1; min-height: 0"
              :initialVariableValues="liveVariablesData"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <DashboardErrorsComponent
              :errors="errorData"
              class="tw:flex-shrink-0"
            />
          </div>
        </div>
        <div
          v-if="dashboardPanelData.data.type == 'markdown'"
          class="col column"
          style="width: 100%; height: calc(100vh - 99px); flex: 1"
        >
          <div class="card-container tw:h-full tw:flex tw:flex-col">
            <VariablesValueSelector
              :variablesConfig="currentDashboardData.data?.variables"
              :showDynamicFilters="
                currentDashboardData.data?.variables?.showDynamicFilters
              "
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="variablesDataUpdated"
              :initialVariableValues="initialVariableValues"
              class="tw:flex-shrink-0 q-mb-sm"
              :showAddVariableButton="true"
              :showAllVisible="true"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <CustomMarkdownEditor
              v-model="dashboardPanelData.data.markdownContent"
              style="flex: 1; min-height: 0"
              :initialVariableValues="liveVariablesData"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <DashboardErrorsComponent
              :errors="errorData"
              class="tw:flex-shrink-0"
            />
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
                class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]"
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
                <div
                  class="col scroll"
                  style="height: 100%; display: flex; flex-direction: column"
                >
                  <div style="height: 500px; flex-shrink: 0; overflow: hidden">
                    <q-splitter
                      class="query-editor-splitter"
                      v-model="splitterModel"
                      style="height: 100%"
                      @update:model-value="layoutSplitterUpdated"
                    >
                      <template #before>
                        <div
                          style="position: relative; width: 100%; height: 100%"
                        >
                          <CustomChartEditor
                            v-model="dashboardPanelData.data.customChartContent"
                            style="width: 100%; height: 100%"
                          />
                          <!-- Custom Chart Type Selector Button overlaid on Editor -->
                          <div
                            style="
                              position: absolute;
                              bottom: 10px;
                              right: 10px;
                              z-index: 10;
                            "
                          >
                            <q-btn
                              unelevated
                              color="primary"
                              icon="bar_chart"
                              label="Example Charts"
                              @click="openCustomChartTypeSelector"
                              data-test="custom-chart-type-selector-btn"
                              no-caps
                              size="md"
                            />
                            <!-- Custom Chart Type Selector Dialog -->
                            <q-dialog v-model="showCustomChartTypeSelector">
                              <CustomChartTypeSelector
                                @select="handleChartTypeSelection"
                                @close="showCustomChartTypeSelector = false"
                              />
                            </q-dialog>
                          </div>
                        </div>
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
                          :showLegendsButton="true"
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
                  <div class="row column tw:h-[calc(100vh-180px)]">
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
    <q-dialog v-model="showLegendsDialog">
      <ShowLegendsPopup
        :panelData="currentPanelData"
        @close="showLegendsDialog = false"
      />
    </q-dialog>

    <!-- Add Variable -->
    <div
      v-if="isAddVariableOpen"
      class="add-variable-drawer-overlay"
      @click.self="handleCloseAddVariable"
    >
      <div class="add-variable-drawer-panel tw:px-4 tw:pt-4">
        <AddSettingVariable
          @save="handleSaveVariable"
          @close="handleCloseAddVariable"
          :dashboardVariablesList="
            currentDashboardData.data?.variables?.list || []
          "
          :variableName="selectedVariableToEdit"
          :isFromAddPanel="true"
        />
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
import CustomChartTypeSelector from "../../../components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue";

import { useI18n } from "vue-i18n";
import {
  addPanel,
  checkIfVariablesAreLoaded,
  getDashboard,
  getPanel,
  updatePanel,
  updateDashboard,
  deleteVariable,
} from "../../../utils/commons";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import DashboardQueryBuilder from "../../../components/dashboards/addPanel/DashboardQueryBuilder.vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue";
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import AddSettingVariable from "../../../components/dashboards/settings/AddSettingVariable.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import { useLoading } from "@/composables/useLoading";
import { debounce, isEqual } from "lodash-es";
import { provide, inject } from "vue";
import useNotifications from "@/composables/useNotifications";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import useAiChat from "@/composables/useAiChat";
import useStreams from "@/composables/useStreams";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { loadCustomChartTemplate } from "@/components/dashboards/addPanel/customChartExamples/customChartTemplates";
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
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";

const ConfigPanel = defineAsyncComponent(() => {
  return import("../../../components/dashboards/addPanel/ConfigPanel.vue");
});

const ShowLegendsPopup = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
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
    ShowLegendsPopup,
    VariablesValueSelector,
    AddSettingVariable,
    PanelSchemaRenderer,
    RelativeTime,
    CustomChartTypeSelector,
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
    const showLegendsDialog = ref(false);
    const panelSchemaRendererRef: any = ref(null);
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();

    // Initialize or inject variables manager
    const injectedManager = inject("variablesManager", null);
    const variablesManager = injectedManager || useVariablesManager();

    // Provide to child components
    if (!injectedManager) {
      provide("variablesManager", variablesManager);
    }
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
      makeAutoSQLQuery,
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

    // Custom Chart Type Selector
    const selectedCustomChartType = ref(null);
    const showCustomChartTypeSelector = ref(false);

    const openCustomChartTypeSelector = () => {
      showCustomChartTypeSelector.value = true;
    };

    const handleChartTypeSelection = async (selection: any) => {
      // Extract chart and replaceQuery option from the selection
      const chart = selection.chart || selection; // Support both old and new format
      const replaceQuery = selection.replaceQuery ?? false; // Default to false (unchecked)

      selectedCustomChartType.value = chart;

      try {
        // Lazy load the template
        const template = await loadCustomChartTemplate(chart.value);

        if (template) {
          // Keep the default commented instructions and only replace the option code
          const defaultComments = `// To know more about ECharts , 
// visit: https://echarts.apache.org/examples/en/index.html 
// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple 
// Define your ECharts 'option' here. 
// 'data' variable is available for use and contains the response data from the search result and it is an array.
`;
          dashboardPanelData.data.customChartContent =
            defaultComments + template.code;

          // Handle query replacement based on user selection
          const currentQueryIndex =
            dashboardPanelData.layout.currentQueryIndex || 0;
          if (dashboardPanelData.data.queries[currentQueryIndex]) {
            if (replaceQuery && template.query && template.query.trim()) {
              // Replace with example query if option is selected
              dashboardPanelData.data.queries[currentQueryIndex].query =
                template.query.trim();
              // Enable custom query mode for custom charts
              dashboardPanelData.data.queries[currentQueryIndex].customQuery =
                true;
            }
            // If replaceQuery is false, preserve the existing query (do nothing)
          }
        }
      } catch (error) {
        showErrorNotification(
          "There was an error applying the chart example code. Please try again",
        );
      }
    };

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

    // Get merged variables for the current panel from variablesManager
    // This holds the COMMITTED state - what the chart is currently using
    // Only updates when user applies changes (similar to ViewDashboard's committed state)
    const updatedVariablesData: any = reactive({
      isVariablesLoading: false,
      values: [],
    });

    // Computed property for LIVE merged variables (for HTML/Markdown editors)
    // This includes global + tab + panel scoped variables with proper precedence
    const liveVariablesData = computed(() => {
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );
        return {
          isVariablesLoading: variablesManager.isLoading.value,
          values: mergedVars,
        };
      } else {
        // Fallback to variablesData
        return variablesData;
      }
    });

    // Helper function to update updatedVariablesData from variablesManager
    const updateCommittedVariables = () => {
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );

        updatedVariablesData.isVariablesLoading = variablesManager.isLoading.value;
        // IMPORTANT: Deep copy to prevent reactive updates from live state
        updatedVariablesData.values = JSON.parse(JSON.stringify(mergedVars));
      } else {
        // Fallback: deep copy from variablesData
        updatedVariablesData.isVariablesLoading = variablesData.isVariablesLoading;
        updatedVariablesData.values = JSON.parse(JSON.stringify(variablesData.values));
      }
    };

    // State for Add Variable functionality
    const isAddVariableOpen = ref(false);
    const selectedVariableToEdit = ref(null);

    // Track variables created during this edit session (for cleanup on discard)
    const variablesCreatedInSession = ref<string[]>([]);
    const initialVariableNames = ref<string[]>([]);

    // Track variables that use "current_panel" - these need special handling
    const variablesWithCurrentPanel = ref<string[]>([]);

    // Track if initial variables need auto-apply (similar to ViewDashboard behavior)
    let needsVariablesAutoUpdate = true;

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

    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);

      // Check if initial variables are loaded and auto-apply them (ONLY on first load)
      if (needsVariablesAutoUpdate) {
        // Check if the variables have loaded (length > 0)
        if (checkIfVariablesAreLoaded(data)) {
          needsVariablesAutoUpdate = false;
          // Auto-commit initial variable state - this ensures the chart renders with initial values
          updateCommittedVariables();

          // Trigger chart update with loaded variables
          if (editMode.value || !isInitialDashboardPanelData()) {
            // Copy the panel data to trigger chart render with initial variables
            chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
          }
        }
        // After initial load, don't return - we still need to update URL params below
        // But we should NOT update chartData or updatedVariablesData
      }

      // Use variablesManager if available for URL sync
      let variableObj: any = {};

      if (variablesManager && variablesManager.variablesData.isInitialized) {
        // Manager mode: Use getUrlParams with useLive=true to sync live variable state
        variableObj = variablesManager.getUrlParams({ useLive: true });
      } else {
        // Legacy mode: build URL params manually
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
            // Simple: just set var-name=value
            variableObj[`var-${variable.name}`] = variable.value;
          }
        });
      }

      router.replace({
        query: {
          ...route.query,
          ...variableObj,
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });

      // Note: updatedVariablesData is now a computed property that reads from variablesManager
      // No need to manually assign here - it will reactively update
    };

    const currentDashboardData: any = reactive({
      data: {},
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

          // FIX: For custom_chart panels, ensure customQuery flag is always true
          // This prevents the query from being lost due to watchers that fire during mount
          if (dashboardPanelData.data.type === "custom_chart") {
            dashboardPanelData.data.queries.forEach((query: any) => {
              if (query.query) {
                // Only set customQuery=true if there's actually a query
                query.customQuery = true;
              }
            });
          }
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
        // Set chartData immediately after loading panel, regardless of variables
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
      await loadDashboard();

      // Call makeAutoSQLQuery after dashboard data is loaded
      // Only generate SQL if we're in auto query mode
      if (
        !editMode.value &&
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
      ) {
        await makeAutoSQLQuery();
      }

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

      // Initialize variables manager with dashboard variables
      try {
        await variablesManager.initialize(
          currentDashboardData.data?.variables?.list || [],
          currentDashboardData.data,
          { [currentPanelId.value]: currentTabId.value || "" },
        );

        // Mark current tab and panel as visible so their variables can load
        const tabId =
          (route.query.tab as string) ??
          currentDashboardData.data?.tabs?.[0]?.tabId;
        if (tabId) {
          variablesManager.setTabVisibility(tabId, true);
        }

        // In edit mode, mark the panel as visible
        if (route.query.panelId) {
          variablesManager.setPanelVisibility(
            route.query.panelId as string,
            true,
          );
        } else {
          // In add mode (new panel), mark "current_panel" as visible
          // This allows variables scoped to "current_panel" to load
          variablesManager.setPanelVisibility("current_panel", true);
        }

        // Load variable values from URL parameters
        variablesManager.loadFromUrl(route);

        // Commit the URL values immediately so they're used by the chart
        variablesManager.commitAll();

        // Initialize updatedVariablesData with current variable state
        updateCommittedVariables();
      } catch (error) {
        console.error("Error initializing variables manager:", error);
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

      // Capture initial variable names on first load (only once during mount)
      if (initialVariableNames.value.length === 0) {
        initialVariableNames.value = 
          currentDashboardData.data?.variables?.list?.map((v: any) => v.name) || [];
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
        if (normalized.values && Array.isArray(normalized.values)) {
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

      // Get LIVE variables from variablesManager
      let liveVariables: any = { values: [] };
      if (variablesManager && variablesManager.variablesData.isInitialized) {
        const mergedVars = variablesManager.getVariablesForPanel(
          currentPanelId.value,
          currentTabId.value || "",
        );
        liveVariables = {
          isVariablesLoading: variablesManager.isLoading.value,
          values: mergedVars,
        };
      } else {
        liveVariables = variablesData;
      }

      const normalizedCurrent = normalizeVariables(liveVariables);
      const normalizedRefreshed = normalizeVariables(updatedVariablesData);
      const variablesChanged = !isEqual(normalizedCurrent, normalizedRefreshed);

      const configChanged = !isEqual(
        JSON.parse(JSON.stringify(chartData.value ?? {})),
        JSON.parse(JSON.stringify(dashboardPanelData.data ?? {})),
      );
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

    // Generate the query when the fields are updated
    watch(
      () => [
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.latitude,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.longitude,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.weight,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.source,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.target,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.name,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value_for_maps,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].joins,
      ],
      () => {
        // only continue if current mode is auto query generation
        if (
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery
        ) {
          // makeAutoSQLQuery is async function
          makeAutoSQLQuery();
        }
      },
      { deep: true },
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

        // Commit the current variable values to updatedVariablesData
        // This is what the chart will use for the query
        updateCommittedVariables();

        // copy the data object excluding the reactivity
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
        // refresh the date time based on current time if relative date is selected
        dateTimePickerRef.value && dateTimePickerRef.value.refresh();
        updateDateTime(selectedDate.value);
        // console.timeEnd("runQuery");
      } catch (err) {
        // Error during query execution
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

    const goBack = async () => {
      // Clean up variables created during this session (on discard)
      // Remove variables that were created in this session from the dashboard data
      if (variablesCreatedInSession.value.length > 0 && currentDashboardData.data?.variables?.list) {
        currentDashboardData.data.variables.list = currentDashboardData.data.variables.list.filter(
          (v: any) => !variablesCreatedInSession.value.includes(v.name)
        );
      }

      // Clear the tracking arrays
      variablesCreatedInSession.value = [];
      variablesWithCurrentPanel.value = [];

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
          // User confirmed navigation - clean up variables created during this session
          if (variablesCreatedInSession.value.length > 0 && currentDashboardData.data?.variables?.list) {
            currentDashboardData.data.variables.list = currentDashboardData.data.variables.list.filter(
              (v: any) => !variablesCreatedInSession.value.includes(v.name)
            );
          }
          variablesCreatedInSession.value = [];
          variablesWithCurrentPanel.value = [];
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
          // If variables were created during edit session, we need to save them too
          if (variablesCreatedInSession.value.length > 0) {
            // Update variables with "current_panel" to use the actual panel ID
            const currentPanelId = route.query.panelId as string;

            variablesWithCurrentPanel.value.forEach((variableName) => {
              const variable = currentDashboardData.data?.variables?.list?.find(
                (v: any) => v.name === variableName,
              );
              if (variable && variable.panels && currentPanelId) {
                const index = variable.panels.indexOf("current_panel");
                if (index !== -1) {
                  variable.panels[index] = currentPanelId;
                }
              }
            });

            // Update the panel data in currentDashboardData
            const tab = currentDashboardData.data.tabs.find(
              (t: any) =>
                t.tabId ===
                (route.query.tab ?? currentDashboardData.data.tabs[0].tabId),
            );
            if (tab) {
              const panelIndex = tab.panels.findIndex(
                (p: any) => p.id === dashboardPanelData.data.id,
              );
              if (panelIndex !== -1) {
                tab.panels[panelIndex] = dashboardPanelData.data;
              }
            }

            // Save the entire dashboard (including new variables and updated panel)
            const errorMessageOnSave = await updateDashboard(
              store,
              store.state.selectedOrganization.identifier,
              dashId,
              currentDashboardData.data,
              route.query.folder ?? "default",
            );

            if (errorMessageOnSave instanceof Error) {
              errorData.errors.push(
                "Error saving panel configuration : " +
                  errorMessageOnSave.message,
              );
              return;
            }
          } else {
            // No new variables, just update the panel
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
          }
        } else {
          const panelId =
            "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

          dashboardPanelData.data.id = panelId;
          chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

          // Replace "current_panel" with actual panel ID in variables before saving
          if (variablesWithCurrentPanel.value.length > 0) {
            variablesWithCurrentPanel.value.forEach((variableName) => {
              const variable = currentDashboardData.data?.variables?.list?.find(
                (v: any) => v.name === variableName,
              );
              if (variable && variable.panels) {
                variable.panels = variable.panels.map((id: string) =>
                  id === "current_panel" ? panelId : id
                );
              }
            });
          }

          // Prepare variables to update (if any were created during this session)
          const variablesToUpdate = variablesCreatedInSession.value.length > 0
            ? { variableNames: variablesCreatedInSession.value, newPanelId: panelId }
            : undefined;

          // Prepare list of new variable objects to add to dashboard
          const newVariablesList = variablesCreatedInSession.value.length > 0
            ? variablesCreatedInSession.value.map((name: string) =>
                currentDashboardData.data?.variables?.list?.find((v: any) => v.name === name)
              ).filter((v: any) => v !== undefined)
            : undefined;

          const errorMessageOnSave = await addPanel(
            store,
            dashId,
            dashboardPanelData.data,
            route.query.folder ?? "default",
            route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
            variablesToUpdate,
            newVariablesList
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

        // Clear variables created during session since panel is being saved
        variablesCreatedInSession.value = [];
        variablesWithCurrentPanel.value = [];

        // Clear variables created during session since panel is being saved
        variablesCreatedInSession.value = [];
        variablesWithCurrentPanel.value = [];

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

    // Handler for custom chart template selection
    const handleCustomChartTemplateSelected = (templateCode: string) => {
      // Update the custom chart content with the selected template
      dashboardPanelData.data.customChartContent = templateCode;
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

    const currentPanelData = computed(() => {
      // panelData is a ref exposed by PanelSchemaRenderer
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
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

    // Computed properties for current tab and panel IDs
    const currentTabId = computed(() => {
      return (
        (route.query.tab as string) ??
        currentDashboardData.data?.tabs?.[0]?.tabId
      );
    });

    const currentPanelId = computed(() => {
      // In edit mode, use the panelId from query params
      if (editMode.value && route.query.panelId) {
        return route.query.panelId as string;
      }
      // In add mode, use "current_panel" as the panel ID before the panel is saved
      // This allows variables scoped to "current_panel" to be visible
      return dashboardPanelData.data.id || "current_panel";
    });

    /**
     * Opens the Add Variable panel
     */
    const handleOpenAddVariable = () => {
      selectedVariableToEdit.value = null;
      isAddVariableOpen.value = true;
    };

    /**
     * Closes the Add Variable panel without saving changes
     */
    const handleCloseAddVariable = () => {
      isAddVariableOpen.value = false;
      selectedVariableToEdit.value = null;
      // Don't reload dashboard - user is canceling/discarding the variable creation
    };

    /**
     * Handles saving a variable - reloads dashboard to reflect the saved variable
     */
    const handleSaveVariable = async (payload: any) => {
      isAddVariableOpen.value = false;

      const { variableData, isEdit, oldVariableName } = payload || {};

      // If payload is missing, return (should not happen)
      if (!variableData) {
        return;
      }

      if (!currentDashboardData.data.variables) {
        currentDashboardData.data.variables = { list: [] };
      }

      const variablesList = currentDashboardData.data.variables.list;

      if (isEdit) {
        // Find and update
        const index = variablesList.findIndex(
          (v: any) => v.name === oldVariableName,
        );
        if (index !== -1) {
          variablesList[index] = variableData;
          // Also update tracking
          if (
            variablesCreatedInSession.value.includes(oldVariableName) &&
            oldVariableName !== variableData.name
          ) {
            const trackIndex =
              variablesCreatedInSession.value.indexOf(oldVariableName);
            variablesCreatedInSession.value[trackIndex] = variableData.name;
          }
          if (
            variablesWithCurrentPanel.value.includes(oldVariableName) &&
            oldVariableName !== variableData.name
          ) {
            const trackIndex =
              variablesWithCurrentPanel.value.indexOf(oldVariableName);
            variablesWithCurrentPanel.value[trackIndex] = variableData.name;
          }
        }
      } else {
        // Add new
        variablesList.push(variableData);
        // Track
        if (!variablesCreatedInSession.value.includes(variableData.name)) {
          variablesCreatedInSession.value.push(variableData.name);
        }
      }

      // Update variablesWithCurrentPanel tracking
      const usesCurrentPanel =
        variableData.panels && variableData.panels.includes("current_panel");
      if (usesCurrentPanel) {
        if (!variablesWithCurrentPanel.value.includes(variableData.name)) {
          variablesWithCurrentPanel.value.push(variableData.name);
        }
      } else {
        // If it was tracked but no longer uses current_panel, remove it
        const idx = variablesWithCurrentPanel.value.indexOf(variableData.name);
        if (idx !== -1) {
          variablesWithCurrentPanel.value.splice(idx, 1);
        }
      }

      selectedVariableToEdit.value = null;

      // Re-initialize manager with updated list
      await variablesManager.initialize(
        variablesList,
        currentDashboardData.data,
      );

      // Restore visibility
      // 1. Tab visibility
      const tabId = currentTabId.value;
      if (tabId) {
        variablesManager.setTabVisibility(tabId, true);
      }

      // 2. Panel visibility (Edit Mode)
      if (editMode.value && route.query.panelId) {
        variablesManager.setPanelVisibility(
          route.query.panelId as string,
          true,
        );
      } else {
        // 3. Panel visibility (Add Mode - current_panel)
        // In add mode, mark "current_panel" as visible so variables can load
        variablesManager.setPanelVisibility("current_panel", true);
      }

      // 4. Additionally, if any variable uses "current_panel", ensure it's visible
      if (variablesWithCurrentPanel.value.length > 0) {
        variablesManager.setPanelVisibility("current_panel", true);
      }

      // 5. Trigger variable data reload to ensure new variables are displayed
      // Wait for Vue to process the manager updates
      await nextTick();

      // The VariablesValueSelector components should automatically pick up
      // the new variables from the manager through their computed properties
    };

    return {
      t,
      updateDateTime,
      goBack,
      savePanelChangesToDashboard,
      runQuery,
      layoutSplitterUpdated,
      handleCustomChartTemplateSelected,
      selectedCustomChartType,
      showCustomChartTypeSelector,
      openCustomChartTypeSelector,
      handleChartTypeSelection,
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
      liveVariablesData,
      updatedVariablesData,
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
      showLegendsDialog,
      currentPanelData,
      panelSchemaRendererRef,
      isAddVariableOpen,
      selectedVariableToEdit,
      handleOpenAddVariable,
      handleCloseAddVariable,
      handleSaveVariable,
      currentTabId,
      currentPanelId,
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

.add-variable-drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 6000;
  display: flex;
  justify-content: flex-end;
}

.add-variable-drawer-panel {
  width: 900px;
  height: 100vh;
  background-color: white;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  border-radius: 0 !important;

  :deep(.column.full-height) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :deep(.scrollable-content) {
    max-height: calc(100vh - 140px);
    overflow-y: auto;
  }

  :deep(.sticky-footer) {
    padding: 6px 6px;
    margin-top: auto;
  }
}

.theme-dark .add-variable-drawer-panel {
  background-color: #1a1a1a;
}
</style>
