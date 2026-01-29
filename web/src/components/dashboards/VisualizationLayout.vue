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

<!--
  VisualizationLayout.vue (Based on AddPanel.vue architecture)

  Comprehensive visualization layout component with all features controlled by props.
  Designed to handle all 3 use cases:
  1. AddPanel (full dashboard CRUD)
  2. VisualizeLogsQuery (logs visualization with external data)
  3. BuildQueryTab (visual SQL query builder)

  Key Features (all toggleable via props):
  - Header toolbar (title input, buttons, datetime picker)
  - Chart type selection sidebar
  - Collapsible field list
  - Query builder (DashboardQueryBuilder)
  - Variables selector
  - Chart renderer with warnings
  - Config sidebar
  - Multiple panel types (query-based, HTML, Markdown, custom chart)
  - Dialogs (Query Inspector, Add Variable, Legends)
-->

<template>
  <div :style="containerStyle" :class="[containerClass, 'tw:flex tw:flex-col tw:h-full']">
    <!-- HEADER TOOLBAR (optional, controlled by showHeader prop) -->
    <div
      v-if="showHeader"
      class="tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs"
    >
      <div
        class="flex items-center q-pa-sm card-container"
        :class="!store.state.isAiChatEnabled ? 'justify-between' : ''"
      >
        <!-- Left: Title -->
        <div
          class="flex items-center q-table__title"
          :class="!store.state.isAiChatEnabled ? 'q-mr-md' : 'q-mr-sm'"
        >
          <span v-if="showHeaderTitle">
            {{ headerTitle }}
          </span>
          <div v-if="showPanelNameInput">
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

        <!-- Right: Action Buttons -->
        <div class="flex q-gutter-sm">
          <slot name="header-buttons-before"></slot>

          <!-- Tutorial Button -->
          <q-btn
            v-if="showTutorialButton"
            outline
            padding="xs sm"
            class="q-mr-sm tw:h-[36px] el-border"
            no-caps
            label="Dashboard Tutorial"
            @click="$emit('showTutorial')"
            data-test="dashboard-panel-tutorial-btn"
          ></q-btn>

          <!-- Query Inspector Button -->
          <q-btn
            v-if="
              showQueryInspectorButton &&
              !['html', 'markdown', 'custom_chart'].includes(
                dashboardPanelData.data.type
              )
            "
            outline
            padding="sm"
            class="q-mr-sm tw:h-[36px] el-border"
            no-caps
            icon="info_outline"
            @click="$emit('showQueryInspector')"
            data-test="dashboard-panel-data-view-query-inspector-btn"
          >
            <q-tooltip anchor="center left" self="center right"
              >Query Inspector
            </q-tooltip>
          </q-btn>

          <!-- DateTime Picker -->
          <DateTimePickerDashboard
            v-if="showDateTimePickerComputed"
            :modelValue="selectedDate"
            @update:modelValue="$emit('update:selectedDate', $event)"
            ref="dateTimePickerRef"
            :disable="dateTimePickerDisabled"
            class="tw:h-[36px]"
            @hide="$emit('dateTimePickerHide')"
          />

          <!-- Discard Button -->
          <q-btn
            v-if="showDiscardButton"
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
            @click="$emit('discard')"
            data-test="dashboard-panel-discard"
          />

          <!-- Save Button -->
          <q-btn
            v-if="showSaveButton"
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
            @click="$emit('save')"
            :loading="saveLoading"
          />

          <!-- Apply Button (Non-Enterprise) -->
          <template
            v-if="
              showApplyButton &&
              !['html', 'markdown'].includes(dashboardPanelData.data.type)
            "
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
              :loading="applyLoading"
              :disable="applyDisabled"
              :label="t('panel.apply')"
              @click="$emit('apply', false)"
            />

            <!-- Apply Button Group (Enterprise with Cache Refresh) -->
            <q-btn-group
              v-if="config.isEnterprise === 'true'"
              class="tw:h-[36px] q-ml-md o2-primary-button"
              style="
                padding-left: 0px !important;
                padding-right: 0px !important;
                display: inline-flex;
              "
              :class="
                store.state.theme === 'dark'
                  ? applyLoading
                    ? 'o2-negative-button-dark'
                    : 'o2-secondary-button-dark'
                  : applyLoading
                    ? 'o2-negative-button-light'
                    : 'o2-secondary-button-light'
              "
            >
              <q-btn
                :data-test="applyLoading ? 'dashboard-cancel' : 'dashboard-apply'"
                no-caps
                :label="applyLoading ? t('panel.cancel') : t('panel.apply')"
                @click="$emit('applyClick')"
              />

              <q-btn-dropdown
                class="text-bold no-border tw:px-0"
                no-caps
                flat
                dense
                auto-close
                dropdown-icon="keyboard_arrow_down"
                :disable="applyLoading"
              >
                <q-list>
                  <q-item
                    clickable
                    @click="$emit('apply', true)"
                    :disable="applyLoading"
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

          <slot name="header-buttons-after"></slot>
        </div>
      </div>
    </div>

    <!-- MAIN CONTENT AREA -->
    <div class="tw:flex-1 tw:min-h-0">
      <div class="row" style="overflow-y: auto; height: 100%">
        <!-- LEFT: Chart Type Selection (100px fixed) -->
        <div class="tw:pl-[0.625rem] tw:pb-[0.625rem]" style="height: calc(100vh - 110px)">
          <div
            class="col scroll card-container tw:mr-[0.625rem]"
            style="
              overflow-y: auto;
              height: 100%;
              min-width: 100px;
              max-width: 100px;
            "
          >
            <slot name="chart-selection">
              <ChartSelection
                v-model:selectedChartType="dashboardPanelData.data.type"
                @update:selected-chart-type="$emit('chartTypeChange', $event)"
                :allowedchartstype="allowedChartTypes"
              />
            </slot>
          </div>
        </div>
        <q-separator vertical />

        <!-- MIDDLE: Query-based Chart Panel -->
        <div
          v-if="
            !['html', 'markdown', 'custom_chart'].includes(
              dashboardPanelData.data.type
            )
          "
          class="col tw:mr-[0.625rem]"
          style="display: flex; flex-direction: row; overflow-x: hidden"
        >
          <!-- Collapsed Field List Bar -->
          <div
            v-if="!dashboardPanelData.layout.showFieldList"
            class="field-list-sidebar-header-collapsed card-container"
            @click="$emit('collapseFieldList')"
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

          <!-- Main Splitter (Field List <-> Chart Area) -->
          <q-splitter
            v-model="dashboardPanelData.layout.splitter"
            :limits="splitterLimits"
            :style="{
              width: dashboardPanelData.layout.showFieldList
                ? '100%'
                : 'calc(100% - 50px)',
              height: '100%',
            }"
          >
            <!-- BEFORE: Field List -->
            <template #before>
              <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
                <div
                  v-if="dashboardPanelData.layout.showFieldList"
                  class="col scroll card-container"
                  :style="fieldListContainerStyle"
                >
                  <div class="column" style="height: 100%">
                    <div class="col-auto q-pa-sm">
                      <span class="text-weight-bold">{{
                        t("panel.fields")
                      }}</span>
                    </div>
                    <div class="col" style="width: 100%">
                      <slot name="field-list">
                        <FieldList
                          :editMode="editMode"
                          :hideAllFieldsSelection="hideAllFieldsSelection"
                        />
                      </slot>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- SEPARATOR: Collapse/Expand Button -->
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
                @click.stop="$emit('collapseFieldList')"
              />
            </template>

            <!-- AFTER: Chart Area + Config Panel -->
            <template #after>
              <div class="row card-container">
                <!-- Chart Rendering Area -->
                <div
                  class="col scroll"
                  :style="chartColumnStyle"
                >
                  <div class="layout-panel-container col">
                    <!-- Query Builder (optional) -->
                    <div v-if="showQueryBuilder" class="col-auto">
                      <slot name="query-builder">
                        <DashboardQueryBuilder
                          :dashboardData="dashboardData"
                          @custom-chart-template-selected="
                            $emit('customChartTemplateSelected', $event)
                          "
                        />
                      </slot>
                    </div>
                    <q-separator v-if="showQueryBuilder" />

                    <!-- Variables Selector (optional) -->
                    <VariablesValueSelector
                      v-if="
                        showVariablesSelector &&
                        (dateTimeForVariables ||
                          (dashboardPanelData.meta.dateTime &&
                            dashboardPanelData.meta.dateTime.start_time &&
                            dashboardPanelData.meta.dateTime.end_time))
                      "
                      :variablesConfig="variablesConfig"
                      :showDynamicFilters="showDynamicFilters"
                      :selectedTimeDate="
                        dateTimeForVariables || dashboardPanelData.meta.dateTime
                      "
                      @variablesData="$emit('variablesData', $event)"
                      @openAddVariable="$emit('openAddVariable', $event)"
                      :initialVariableValues="initialVariableValues"
                      :showAddVariableButton="showAddVariableButton"
                      :showAllVisible="showVariablesAllVisible"
                      :tabId="currentTabId"
                      :panelId="currentPanelId"
                    />

                    <!-- "Out of Date" Warning -->
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
                          {{ outDatedWarningTitle }}
                        </div>
                        <div>
                          {{ outDatedWarningMessage }}
                        </div>
                      </div>
                    </div>

                    <!-- Warning Icons & Action Buttons (top-right overlay) -->
                    <div class="tw:flex tw:justify-end tw:mr-2 tw:items-center">
                      <slot name="warning-icons">
                        <!-- Error Warning -->
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

                        <!-- Max Query Range Warning -->
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

                        <!-- Series Limit Warning -->
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
                      </slot>

                      <!-- Last Refreshed Timestamp -->
                      <span v-if="showLastRefreshed && lastTriggeredAt" class="lastRefreshedAt">
                        <span class="lastRefreshedAtIcon">🕑</span
                        ><RelativeTime
                          :timestamp="typeof lastTriggeredAt === 'number' ? lastTriggeredAt : Number(lastTriggeredAt)"
                          fullTimePrefix="Last Refreshed At: "
                        />
                      </span>
                    </div>

                    <!-- Chart Renderer -->
                    <div class="tw:h-[calc(100vh-500px)] tw:min-h-[140px]">
                      <slot name="chart-renderer">
                        <PanelSchemaRenderer
                          v-if="chartData"
                          @metadata-update="$emit('metadataUpdate', $event)"
                          @result-metadata-update="
                            $emit('resultMetadataUpdate', $event)
                          "
                          @limit-number-of-series-warning-message-update="
                            $emit('limitWarningUpdate', $event)
                          "
                          :key="dashboardPanelData.data.type"
                          :panelSchema="chartData"
                          :dashboard-id="dashboardId"
                          :folder-id="folderId"
                          :selectedTimeObj="dashboardPanelData.meta.dateTime"
                          :variablesData="updatedVariablesData"
                          :allowAnnotationsAdd="allowAnnotationsAdd"
                          :width="6"
                          :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                          :showLegendsButton="showLegendsButton"
                          @error="$emit('chartError', $event)"
                          @updated:data-zoom="$emit('dataZoom', $event)"
                          @updated:vrlFunctionFieldList="
                            $emit('vrlFunctionFieldListUpdate', $event)
                          "
                          @last-triggered-at-update="
                            $emit('lastTriggeredAtUpdate', $event)
                          "
                          :searchType="searchType"
                          :searchResponse="searchResponse"
                          :is_ui_histogram="is_ui_histogram"
                          :allowAlertCreation="allowAlertCreation"
                          @series-data-update="$emit('seriesDataUpdate', $event)"
                          @show-legends="$emit('showLegends')"
                          ref="panelSchemaRendererRef"
                        />
                      </slot>

                      <!-- Query Inspector Dialog -->
                      <q-dialog
                        v-if="showQueryInspectorDialog"
                        :modelValue="showQueryInspectorDialog"
                        @update:modelValue="$emit('closeQueryInspector')"
                      >
                        <QueryInspector
                          :metaData="metaData"
                          :data="panelTitle"
                        ></QueryInspector>
                      </q-dialog>
                    </div>

                    <!-- Error Component -->
                    <DashboardErrorsComponent
                      :errors="errorData"
                      class="col-auto"
                      style="flex-shrink: 0"
                    />
                  </div>

                  <!-- Query Editor (below chart) -->
                  <div
                    v-if="showQueryEditor"
                    class="row column tw:h-[calc(100vh-180px)]"
                  >
                    <slot name="query-editor">
                      <DashboardQueryEditor />
                    </slot>
                  </div>
                </div>

                <q-separator vertical />

                <!-- Config Sidebar -->
                <div class="col-auto">
                  <PanelSidebar
                    :title="t('dashboard.configLabel')"
                    v-model="dashboardPanelData.layout.isConfigPanelOpen"
                  >
                    <slot name="config-panel">
                      <ConfigPanel
                        :dashboardPanelData="dashboardPanelData"
                        :variablesData="updatedVariablesData"
                        :panelData="seriesData"
                      />
                    </slot>
                  </PanelSidebar>
                </div>
              </div>
            </template>
          </q-splitter>
        </div>

        <!-- HTML Panel -->
        <div
          v-if="dashboardPanelData.data.type == 'html'"
          class="col column"
          style="width: 100%; height: calc(100vh - 99px); flex: 1"
        >
          <div class="card-container tw:h-full tw:flex tw:flex-col">
            <VariablesValueSelector
              v-if="showVariablesSelector"
              :variablesConfig="variablesConfig"
              :showDynamicFilters="showDynamicFilters"
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="$emit('variablesData', $event)"
              :initialVariableValues="initialVariableValues"
              class="tw:flex-shrink-0 q-mb-sm"
              :showAddVariableButton="showAddVariableButton"
              :showAllVisible="showVariablesAllVisible"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <slot name="html-editor">
              <CustomHTMLEditor
                v-model="dashboardPanelData.data.htmlContent"
                style="flex: 1; min-height: 0"
                :initialVariableValues="liveVariablesData"
                :tabId="currentTabId"
                :panelId="currentPanelId"
              />
            </slot>
            <DashboardErrorsComponent
              :errors="errorData"
              class="tw:flex-shrink-0"
            />
          </div>
        </div>

        <!-- Markdown Panel -->
        <div
          v-if="dashboardPanelData.data.type == 'markdown'"
          class="col column"
          style="width: 100%; height: calc(100vh - 99px); flex: 1"
        >
          <div class="card-container tw:h-full tw:flex tw:flex-col">
            <VariablesValueSelector
              v-if="showVariablesSelector"
              :variablesConfig="variablesConfig"
              :showDynamicFilters="showDynamicFilters"
              :selectedTimeDate="dashboardPanelData.meta.dateTime"
              @variablesData="$emit('variablesData', $event)"
              :initialVariableValues="initialVariableValues"
              class="tw:flex-shrink-0 q-mb-sm"
              :showAddVariableButton="showAddVariableButton"
              :showAllVisible="showVariablesAllVisible"
              :tabId="currentTabId"
              :panelId="currentPanelId"
            />
            <slot name="markdown-editor">
              <CustomMarkdownEditor
                v-model="dashboardPanelData.data.markdownContent"
                style="flex: 1; min-height: 0"
                :initialVariableValues="liveVariablesData"
                :tabId="currentTabId"
                :panelId="currentPanelId"
              />
            </slot>
            <DashboardErrorsComponent
              :errors="errorData"
              class="tw:flex-shrink-0"
            />
          </div>
        </div>

        <!-- Custom Chart Panel -->
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
          <!-- Collapsed field list for custom chart -->
          <div
            v-if="!dashboardPanelData.layout.showFieldList"
            class="field-list-sidebar-header-collapsed card-container"
            @click="$emit('collapseFieldList')"
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
            :limits="splitterLimits"
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
                      <slot name="field-list">
                        <FieldList :editMode="editMode" />
                      </slot>
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
                @click="$emit('collapseFieldList')"
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
                      :modelValue="customChartSplitterModel"
                      @update:modelValue="$emit('customChartSplitterUpdate', $event)"
                      style="height: 100%"
                    >
                      <template #before>
                        <div
                          style="position: relative; width: 100%; height: 100%"
                        >
                          <slot name="custom-chart-editor">
                            <CustomChartEditor
                              v-model="dashboardPanelData.data.customChartContent"
                              style="width: 100%; height: 100%"
                            />
                          </slot>

                          <!-- Custom Chart Type Selector Button -->
                          <div
                            v-if="showCustomChartExamplesButton"
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
                              @click="$emit('openCustomChartTypeSelector')"
                              data-test="custom-chart-type-selector-btn"
                              no-caps
                              size="md"
                            />
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
                          @metadata-update="$emit('metadataUpdate', $event)"
                          @result-metadata-update="
                            $emit('resultMetadataUpdate', $event)
                          "
                          @limit-number-of-series-warning-message-update="
                            $emit('limitWarningUpdate', $event)
                          "
                          :key="dashboardPanelData.data.type"
                          :panelSchema="chartData"
                          :dashboard-id="dashboardId"
                          :folder-id="folderId"
                          :selectedTimeObj="dashboardPanelData.meta.dateTime"
                          :variablesData="updatedVariablesData"
                          :width="6"
                          :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                          :showLegendsButton="showLegendsButton"
                          @error="$emit('chartError', $event)"
                          @updated:data-zoom="$emit('dataZoom', $event)"
                          @updated:vrlFunctionFieldList="
                            $emit('vrlFunctionFieldListUpdate', $event)
                          "
                          @last-triggered-at-update="
                            $emit('lastTriggeredAtUpdate', $event)
                          "
                          searchType="dashboards"
                          @series-data-update="$emit('seriesDataUpdate', $event)"
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

                  <div
                    v-if="showQueryEditor"
                    class="row column tw:h-[calc(100vh-180px)]"
                  >
                    <slot name="query-editor">
                      <DashboardQueryEditor />
                    </slot>
                  </div>
                </div>

                <q-separator vertical />

                <div class="col-auto">
                  <PanelSidebar
                    :title="t('dashboard.configLabel')"
                    v-model="dashboardPanelData.layout.isConfigPanelOpen"
                  >
                    <slot name="config-panel">
                      <ConfigPanel
                        :dashboardPanelData="dashboardPanelData"
                        :variablesData="updatedVariablesData"
                        :panelData="seriesData"
                      />
                    </slot>
                  </PanelSidebar>
                </div>
              </div>
            </template>
          </q-splitter>
        </div>
      </div>
    </div>

    <!-- Dialogs (rendered outside main layout) -->
    <slot name="dialogs"></slot>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, defineAsyncComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

// Import shared components
import ChartSelection from "./addPanel/ChartSelection.vue";
import FieldList from "./addPanel/FieldList.vue";
import PanelSchemaRenderer from "./PanelSchemaRenderer.vue";
import ConfigPanel from "./addPanel/ConfigPanel.vue";
import PanelSidebar from "./addPanel/PanelSidebar.vue";
import DashboardErrorsComponent from "./addPanel/DashboardErrors.vue";
import DashboardQueryBuilder from "./addPanel/DashboardQueryBuilder.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import VariablesValueSelector from "./VariablesValueSelector.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import config from "@/aws-exports";

// Import icons
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

// Async components
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

const DashboardQueryEditor = defineAsyncComponent(() => {
  return import("@/components/dashboards/addPanel/DashboardQueryEditor.vue");
});

export default defineComponent({
  name: "VisualizationLayout",
  components: {
    ChartSelection,
    FieldList,
    PanelSchemaRenderer,
    ConfigPanel,
    PanelSidebar,
    DashboardErrorsComponent,
    DashboardQueryBuilder,
    DateTimePickerDashboard,
    VariablesValueSelector,
    QueryInspector,
    CustomHTMLEditor,
    CustomMarkdownEditor,
    CustomChartEditor,
    DashboardQueryEditor,
    RelativeTime,
  },
  props: {
    // ===== Container Styling =====
    containerStyle: {
      type: Object,
      default: () => ({ overflowY: "auto" }),
    },
    containerClass: {
      type: String,
      default: "scroll",
    },

    // ===== Core Data =====
    dashboardPanelData: {
      type: Object,
      required: true,
    },
    chartData: {
      type: Object,
      default: null,
    },
    seriesData: {
      type: [Array, Object],
      default: null,
    },
    errorData: {
      type: Object as PropType<{ errors: any[] }>,
      default: () => ({ errors: [] }),
    },
    metaData: {
      type: Object,
      default: null,
    },

    // ===== Header Toolbar Controls =====
    showHeader: {
      type: Boolean,
      default: true,
    },
    showHeaderTitle: {
      type: Boolean,
      default: true,
    },
    headerTitle: {
      type: String,
      default: "",
    },
    showPanelNameInput: {
      type: Boolean,
      default: true,
    },
    inputStyle: {
      type: Object,
      default: () => ({}),
    },
    showTutorialButton: {
      type: Boolean,
      default: true,
    },
    showQueryInspectorButton: {
      type: Boolean,
      default: true,
    },
    showQueryInspectorDialog: {
      type: Boolean,
      default: false,
    },
    showDateTimePicker: {
      type: Boolean,
      default: true,
    },
    selectedDate: {
      type: Object,
      default: null,
    },
    dateTimePickerDisabled: {
      type: Boolean,
      default: false,
    },
    showDiscardButton: {
      type: Boolean,
      default: true,
    },
    showSaveButton: {
      type: Boolean,
      default: true,
    },
    saveLoading: {
      type: Boolean,
      default: false,
    },
    showApplyButton: {
      type: Boolean,
      default: true,
    },
    applyLoading: {
      type: Boolean,
      default: false,
    },
    applyDisabled: {
      type: Boolean,
      default: false,
    },

    // ===== Chart Configuration =====
    allowedChartTypes: {
      type: Array as PropType<string[]>,
      default: () => [],
    },

    // ===== Field List & Splitter =====
    splitterLimits: {
      type: Array as PropType<number[]>,
      default: () => [0, 20],
    },
    fieldListContainerStyle: {
      type: Object,
      default: () => ({ height: "calc(100vh - 110px)", overflowY: "auto" }),
    },
    editMode: {
      type: Boolean,
      default: false,
    },
    hideAllFieldsSelection: {
      type: Boolean,
      default: false,
    },

    // ===== Query Builder & Editor =====
    showQueryBuilder: {
      type: Boolean,
      default: true,
    },
    dashboardData: {
      type: Object,
      default: () => ({}),
    },
    showQueryEditor: {
      type: Boolean,
      default: true,
    },

    // ===== Variables =====
    showVariablesSelector: {
      type: Boolean,
      default: true,
    },
    variablesConfig: {
      type: Object,
      default: null,
    },
    showDynamicFilters: {
      type: Boolean,
      default: false,
    },
    dateTimeForVariables: {
      type: Object,
      default: null,
    },
    initialVariableValues: {
      type: Object,
      default: () => ({}),
    },
    showAddVariableButton: {
      type: Boolean,
      default: true,
    },
    showVariablesAllVisible: {
      type: Boolean,
      default: true,
    },
    currentTabId: {
      type: String,
      default: "",
    },
    currentPanelId: {
      type: String,
      default: "",
    },
    updatedVariablesData: {
      type: Object,
      default: () => ({}),
    },
    liveVariablesData: {
      type: Object,
      default: () => ({}),
    },

    // ===== Warnings & Errors =====
    isOutDated: {
      type: Boolean,
      default: false,
    },
    outDatedWarningTitle: {
      type: String,
      default: "Your chart is not up to date",
    },
    outDatedWarningMessage: {
      type: String,
      default:
        'Chart Configuration / Variables has been updated, but the chart was not updated automatically. Click on the "Apply" button to run the query again',
    },
    errorMessage: {
      type: String,
      default: "",
    },
    maxQueryRangeWarning: {
      type: String,
      default: "",
    },
    limitNumberOfSeriesWarningMessage: {
      type: String,
      default: "",
    },
    showLastRefreshed: {
      type: Boolean,
      default: true,
    },
    lastTriggeredAt: {
      type: [Number, String],
      default: null,
    },

    // ===== Chart Renderer Props =====
    dashboardId: {
      type: String,
      default: "",
    },
    folderId: {
      type: String,
      default: "",
    },
    allowAnnotationsAdd: {
      type: Boolean,
      default: false,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      default: false,
    },
    showLegendsButton: {
      type: Boolean,
      default: true,
    },
    searchType: {
      type: String,
      default: "dashboards",
    },
    searchResponse: {
      type: Object,
      default: null,
    },
    is_ui_histogram: {
      type: Boolean,
      default: false,
    },
    allowAlertCreation: {
      type: Boolean,
      default: false,
    },

    // ===== Chart Column Styling =====
    chartColumnStyle: {
      type: Object,
      default: () => ({ height: "calc(100vh - 110px)", overflowY: "auto" }),
    },

    // ===== Panel Title =====
    panelTitle: {
      type: Object,
      default: () => ({}),
    },

    // ===== Custom Chart =====
    customChartSplitterModel: {
      type: Number,
      default: 50,
    },
    showCustomChartExamplesButton: {
      type: Boolean,
      default: true,
    },
  },
  emits: [
    // Header actions
    "showTutorial",
    "showQueryInspector",
    "closeQueryInspector",
    "dateTimePickerHide",
    "discard",
    "save",
    "apply",
    "applyClick",
    "update:selectedDate",

    // Chart actions
    "chartTypeChange",
    "collapseFieldList",
    "metadataUpdate",
    "resultMetadataUpdate",
    "limitWarningUpdate",
    "chartError",
    "dataZoom",
    "vrlFunctionFieldListUpdate",
    "lastTriggeredAtUpdate",
    "seriesDataUpdate",
    "showLegends",

    // Query builder
    "customChartTemplateSelected",

    // Variables
    "variablesData",
    "openAddVariable",

    // Custom chart
    "customChartSplitterUpdate",
    "openCustomChartTypeSelector",
  ],
  setup(props, { expose }) {
    const { t } = useI18n();
    const store = useStore();

    // Computed property for datetime picker visibility
    // Ensures reactivity when selectedDate changes from null to object
    const showDateTimePickerComputed = computed(() => {
      return props.showDateTimePicker && props.selectedDate != null;
    });

    // Refs for child components that parent may need to access
    const dateTimePickerRef = ref<any>(null);
    const panelSchemaRendererRef = ref<any>(null);

    // Create a proxy object that exposes the underlying component instances
    // This allows parent to access: panelSchemaRendererRef.value.dateTimePickerRef.getConsumableDateTime()
    const exposedDateTimePickerRef = {
      get value() {
        return dateTimePickerRef.value;
      },
      getConsumableDateTime() {
        return dateTimePickerRef.value?.getConsumableDateTime?.();
      },
    };

    // Expose refs and methods to parent components
    expose({
      // Expose dateTimePickerRef as an object with getConsumableDateTime method
      dateTimePickerRef: exposedDateTimePickerRef,
      // Expose panelSchemaRendererRef for accessing panelData
      panelSchemaRendererRef,
      // Expose panelData computed from panelSchemaRendererRef for backwards compatibility
      get panelData() {
        return panelSchemaRendererRef.value?.panelData || {};
      },
      // Expose getConsumableDateTime method directly for convenience
      getConsumableDateTime() {
        return dateTimePickerRef.value?.getConsumableDateTime?.();
      },
    });

    return {
      t,
      store,
      config,
      outlinedWarning,
      symOutlinedDataInfoAlert,
      outlinedRunningWithErrors,
      dateTimePickerRef,
      panelSchemaRendererRef,
      showDateTimePickerComputed,
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/visualization-layout.scss";

.dynamic-input {
  min-width: 200px;
  max-width: 400px;
}

.lastRefreshedAt {
  font-size: 12px;
  color: var(--q-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.lastRefreshedAtIcon {
  font-size: 14px;
}
</style>
