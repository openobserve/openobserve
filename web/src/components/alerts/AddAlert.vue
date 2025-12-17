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
  <div class="full-width q-mx-lg q-pt-xs">
    <div class="row items-center no-wrap card-container tw-mx-[0.625rem]  tw-mb-[0.625rem]">
      <div class="flex items-center justify-between tw-w-full card-container tw-h-[68px] tw-px-2 tw-py-3">
        <div class="flex items-center">
          <div
          data-test="add-alert-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px; 
          "
          title="Go Back"
          @click="router.back()"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div v-if="beingUpdated" class="text-h6" data-test="add-alert-title">
          {{ t("alerts.updateTitle") }}
        </div>
        <div v-else class="text-h6" data-test="add-alert-title">
          {{ t("alerts.addTitle") }}
        </div>
        </div>
        <div class="flex items-center tw-gap-2">
          <!-- Wizard View Toggle -->
          <q-btn-toggle
            v-model="viewMode"
            toggle-color="primary"
            :options="[
              { label: 'Classic', value: 'classic' },
              { label: 'Wizard', value: 'wizard' }
            ]"
            dense
            no-caps
            unelevated
            size="sm"
            data-test="view-mode-toggle"
          />
          <q-btn
            outline
            class="pipeline-icons q-px-sm hideOnPrintMode"
            size="sm"
            no-caps
            icon="code"
            data-test="pipeline-json-edit-btn"
            @click="openJsonEditor"
            >
        <q-tooltip>{{ t("dashboard.editJson") }}</q-tooltip>
        </q-btn>
        </div>
      </div>
    </div>

    <!-- WIZARD VIEW -->
    <div
      v-if="viewMode === 'wizard'"
      class="wizard-view-container tw-mb-2"
      style="
        max-height: calc(100vh - 194px);
        overflow-y: auto;
        scroll-behavior: smooth;
      "
    >
      <div class="card-container tw-px-2 tw-mx-[0.675rem] tw-py-2">
        <!-- Stepper Header (Full Width) -->
        <q-form class="add-alert-form" ref="addAlertForm" @submit="onSubmit">
        <q-stepper
          v-model="wizardStep"
          ref="wizardStepper"
          color="primary"
          flat
          class="alert-wizard-stepper"
          header-nav
        >
        <!-- Persistent Step Caption (Between Header and Content) -->
        <template v-slot:message>
          <div
            v-if="currentStepCaption"
            class="persistent-step-caption tw-px-3 tw-py-1 tw-mb-1 tw-mt-2"
            :class="store.state.theme === 'dark' ? 'dark-mode-caption' : 'light-mode-caption'"
          >
            {{ currentStepCaption }}
          </div>
        </template>

        <!-- Step 1: Alert Setup -->
        <q-step
          :name="1"
          title="Alert Setup"
          caption=""
          icon="settings"
          :done="wizardStep > 1"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <AlertSetup
                  ref="step1Ref"
                  :formData="formData"
                  :beingUpdated="beingUpdated"
                  :streamTypes="streamTypes"
                  :filteredStreams="filteredStreams"
                  :isFetchingStreams="isFetchingStreams"
                  :activeFolderId="Array.isArray(activeFolderId) ? activeFolderId[0] : activeFolderId"
                  :streamFieldRef="streamFieldRef"
                  :streamTypeFieldRef="streamTypeFieldRef"
                  @update:streams="updateStreams()"
                  @filter:streams="filterStreams"
                  @update:stream-name="updateStreamFields"
                  @update:active-folder-id="updateActiveFolderId"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>

        <!-- Step 2: Query Configuration -->
        <q-step
          :name="2"
          title="Conditions"
          caption=""
          icon="search"
          :done="wizardStep > 2"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <QueryConfig
                  :tab="scheduledAlertRef?.tab || 'custom'"
                  :disableQueryTypeSelection="false"
                  :columns="filteredColumns"
                  :streamFieldsMap="streamFieldsMap"
                  :generatedSqlQuery="generatedSqlQuery"
                  :inputData="formData.query_condition"
                  :streamType="formData.stream_type"
                  :isRealTime="formData.is_real_time"
                  :sqlQuery="formData.query_condition.sql"
                  :promqlQuery="formData.query_condition.promql"
                  :vrlFunction="decodedVrlFunction"
                  :streamName="formData.stream_name"
                  @update:tab="updateTab"
                  @update-group="updateGroup"
                  @remove-group="removeConditionGroup"
                  @input:update="onInputUpdate"
                  @update:sqlQuery="(value) => formData.query_condition.sql = value"
                  @update:promqlQuery="(value) => formData.query_condition.promql = value"
                  @update:vrlFunction="(value) => formData.query_condition.vrl_function = value"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>

        <!-- Step 3: Compare with Past (Scheduled only) -->
        <q-step
          v-if="formData.is_real_time === 'false'"
          :name="3"
          title="Compare with Past"
          caption=""
          icon="compare_arrows"
          :done="wizardStep > 3"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: 100%; overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <CompareWithPast
                  :multiTimeRange="formData.query_condition.multi_time_range"
                  :period="formData.trigger_condition.period"
                  :frequency="formData.trigger_condition.frequency"
                  :frequencyType="formData.trigger_condition.frequency_type"
                  :cron="formData.trigger_condition.cron"
                  @update:multiTimeRange="(val) => formData.query_condition.multi_time_range = val"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>

        <!-- Step 4: Alert Settings -->
        <q-step
          :name="4"
          title="Alert Settings"
          caption=""
          icon="tune"
          :done="wizardStep > 4"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <AlertSettings
                  :formData="formData"
                  :isRealTime="formData.is_real_time"
                  :columns="filteredColumns"
                  :isAggregationEnabled="isAggregationEnabled"
                  :destinations="formData.destinations"
                  :formattedDestinations="getFormattedDestinations"
                  @update:trigger="(val) => formData.trigger_condition = val"
                  @update:aggregation="(val) => formData.query_condition.aggregation = val"
                  @update:isAggregationEnabled="(val) => isAggregationEnabled = val"
                  @update:destinations="updateDestinations"
                  @refresh:destinations="refreshDestinations"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>

        <!-- Step 5: Deduplication (Scheduled only) -->
        <q-step
          v-if="formData.is_real_time === 'false'"
          :name="5"
          title="Deduplication"
          caption=""
          icon="filter_list"
          :done="wizardStep > 5"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <Deduplication
                  :deduplication="formData.deduplication"
                  :columns="filteredColumns"
                  @update:deduplication="(val) => formData.deduplication = val"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>

        <!-- Step 6: Advanced Settings -->
        <q-step
          :name="6"
          title="Advanced"
          caption=""
          icon="settings_applications"
          :done="false"
        >
          <!-- 70/30 Split Layout with Equal Heights -->
          <div class="tw-flex tw-gap-[0.625rem] tw-items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (70%) -->
            <div class="tw-flex-[0_0_68%] tw-flex tw-flex-col" style="height: 100%; overflow: hidden;">
              <div class="tw-flex-1" style="overflow: auto;">
                <Advanced
                  :contextAttributes="formData.context_attributes"
                  :description="formData.description"
                  :rowTemplate="formData.row_template"
                  :rowTemplateType="formData.row_template_type"
                  @update:contextAttributes="(val) => formData.context_attributes = val"
                  @update:description="(val) => formData.description = val"
                  @update:rowTemplate="(val) => formData.row_template = val"
                  @update:rowTemplateType="(val) => formData.row_template_type = val"
                />
              </div>

            </div>

            <AlertWizardRightColumn
              ref="previewAlertRef"
              :formData="formData"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :focusManager="focusManager"
              :wizardStep="wizardStep"
            />
          </div>
        </q-step>
      </q-stepper>
      </q-form>
      </div>
    </div>

    <!-- CLASSIC VIEW (Original) -->
    <div
      v-else
      ref="addAlertFormRef"
      style="
        max-height: calc(100vh - 194px);
        overflow: auto;
        scroll-behavior: smooth;
      "
      class="tw-mb-2"
    >
      <div class="row flex items-start" style="width: 100%;">
        <div class="col" :class="store.state.theme === 'dark' ? 'dark-mode1' : 'light-mode1'">
          <q-form class="add-alert-form" ref="addAlertForm" @submit="onSubmit">
            <!-- alerts setup  section -->
             <div class="tw-px-[0.625rem] tw-pb-[0.625rem] tw-w-full tw-h-full">
            <div
              class="flex justify-start items-center flex-wrap card-container"
            >
              <div class="tw-w-full tw-ml-2">
                <AlertsContainer 
                  name="query"
                  v-model:is-expanded="expandState.alertSetup"
                  label="Alert Setup"
                  subLabel="Set the stage for your alert."
                  icon="edit"
                  class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2 "
                  :iconClass="'tw-mt-[2px]'"
                />
              </div>
              <div v-if="expandState.alertSetup" class="tw-w-full row alert-setup-container o2-alert-tab-border tw-px-4 tw-pt-2 tw-pb-3">
    
              <div class="tw-w-full ">

                <div
                  class="alert-name-input flex justify-between items-center tw-gap-10 tw-pb-3"
                  data-test="add-alert-name-input-container"
                >
                  <q-input
                    data-test="add-alert-name-input row"
                    v-model="formData.name"
                    :label="t('alerts.name') + ' *'"
                      class="showLabelOnTop col"
                    stack-label
                    dense
                    borderless
                    v-bind:readonly="beingUpdated"
                    v-bind:disable="beingUpdated"
                    :rules="[
                      (val: any) =>
                        !!val
                          ? isValidResourceName(val) ||
                            `Characters like :, ?, /, #, and spaces are not allowed.`
                          : t('common.nameRequired'),
                    ]"
                    tabindex="0"
                    hide-bottom-space
                  />
                  <div class="col" style="height: 68px;">
                    <SelectFolderDropDown
                      :disableDropdown="beingUpdated"
                      :type="'alerts'"
                      :style="'height: 36px;'"
                      @folder-selected="updateActiveFolderId"
                      :activeFolderId="activeFolderId"
                  />
                  </div>
                
                </div>
              </div>

              <div
                  class="flex tw-w-full items-center justify-between row tw-gap-10 tw-pb-4"
                  style="padding-top: 0px"
                  data-test="add-alert-stream-type-select-container"
                >
                  <div
                    data-test="add-alert-stream-type-select"
                    class="tw-w-full col "
                    style="padding-top: 0"

                  >
                    <q-select
                      ref="streamTypeFieldRef"
                      data-test="add-alert-stream-type-select-dropdown"
                      v-model="formData.stream_type"
                      :options="streamTypes"
                      :label="t('alerts.streamType') + ' *'"
                      :popup-content-style="{ textTransform: 'lowercase' }"
                      class="q-py-sm showLabelOnTop no-case col"
                      stack-label
                      borderless
                      dense
                      hide-bottom-space
                      v-bind:readonly="beingUpdated"
                      v-bind:disable="beingUpdated"
                      @update:model-value="updateStreams()"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                    />
                  </div>
                  <div
                    data-test="add-alert-stream-select"
                    class="col"
                    style="padding-top: 0"
                  >
                    <q-select
                      ref="streamFieldRef"
                      data-test="add-alert-stream-name-select-dropdown"
                      v-model="formData.stream_name"
                      :options="filteredStreams"
                      :label="t('alerts.stream_name') + ' *'"
                      :loading="isFetchingStreams"
                      color="input-border"
                      class="q-py-sm showLabelOnTop no-case col"
                      stack-label
                      dense
                      use-input
                      borderless
                      hide-selected
                      hide-bottom-space
                      fill-input
                      :input-debounce="400"
                      v-bind:readonly="beingUpdated"
                      v-bind:disable="beingUpdated"
                      @filter="filterStreams"
                      @update:model-value="
                        updateStreamFields(formData.stream_name)
                      "
                      behavior="menu"
                      :rules="[(val: any) => !!val || 'Field is required!']"
                    />
                  </div>
                </div>
                <div class="tw-flex tw-items-center tw-gap-5">
                <q-radio
                  data-test="add-alert-scheduled-alert-radio"
                  v-bind:readonly="beingUpdated"
                  v-bind:disable="beingUpdated"
                  v-model="formData.is_real_time"
                  :checked="formData.is_real_time"
                  val="false"
                  dense
                  :label="t('alerts.scheduled')"
                  class="q-ml-none o2-radio-button"
                />
                <q-radio
                  data-test="add-alert-realtime-alert-radio"
                  v-bind:readonly="beingUpdated"
                  v-bind:disable="beingUpdated"
                  v-model="formData.is_real_time"
                  :checked="!formData.is_real_time"
                  val="true"
                  dense
                  :label="t('alerts.realTime')"
                  class="q-ml-none o2-radio-button"
                  />
              </div>
              </div>
            </div>
          </div>

            <div
              v-if="formData.is_real_time === 'true'"
              class="q-pa-none q-ma-none"
              data-test="add-alert-query-input-title"
            >
              <real-time-alert
                ref="realTimeAlertRef"
                :columns="filteredColumns"
                :streamFieldsMap="streamFieldsMap"
                :generatedSqlQuery="generatedSqlQuery"
                :conditions="formData.query_condition?.conditions || {}"
                @input:update="onInputUpdate"
                :expandState = expandState
                @update:expandState="updateExpandState"
                :trigger="formData.trigger_condition"
                :destinations="formData.destinations"
                :formattedDestinations="getFormattedDestinations"
                @refresh:destinations="refreshDestinations"
                @update:destinations="updateDestinations"
                @update:group="updateGroup"
                @remove:group="removeConditionGroup"

              />
            </div>
            <div v-else class="q-pa-none q-ma-none  ">
              <scheduled-alert
                v-if="!isLoadingPanelData"
                ref="scheduledAlertRef"
                :columns="filteredColumns"
                :streamFieldsMap="streamFieldsMap"
                :generatedSqlQuery="generatedSqlQuery"
                :conditions="formData.query_condition?.conditions || {}"
                :expandState = expandState
                :alertData="formData"
                :sqlQueryErrorMsg="sqlQueryErrorMsg"
                :vrlFunctionError="vrlFunctionError"
                :showTimezoneWarning="showTimezoneWarning"
                :selectedStream="formData.stream_name"
                :selected-stream-type="formData.stream_type"
                :destinations="formData.destinations"
                :formattedDestinations="getFormattedDestinations"
                v-model:trigger="formData.trigger_condition"
                v-model:sql="formData.query_condition.sql"
                v-model:promql="formData.query_condition.promql"
                v-model:query_type="formData.query_condition.type"
                v-model:aggregation="formData.query_condition.aggregation"
                v-model:silence="formData.trigger_condition.silence"
                v-model:promql_condition="
                  formData.query_condition.promql_condition
                "
                v-model:multi_time_range="
                  formData.query_condition.multi_time_range
                "
                v-model:vrl_function="formData.query_condition.vrl_function"
                v-model:isAggregationEnabled="isAggregationEnabled"
                v-model:showVrlFunction="showVrlFunction"
                @update:group="updateGroup"
                @remove:group="removeConditionGroup"
                @input:update="onInputUpdate"
                @validate-sql="validateSqlQuery"
                @update:showVrlFunction="updateFunctionVisibility"
                @update:multi_time_range="updateMultiTimeRange"
                @update:expandState="updateExpandState"
                @update:silence="updateSilence"
                @refresh:destinations="refreshDestinations"
                @update:destinations="updateDestinations"
              />
            </div>
  
            <!-- additional setup starts here -->
             <div class="tw-px-[0.625rem] tw-w-full tw-h-full">
                   <div
              class="flex justify-start items-center q-pb-sm flex-wrap card-container"
            >
              <div class="tw-w-full tw-ml-2   ">
                <AlertsContainer 
                    name="advanced"
                    v-model:is-expanded="expandState.advancedSetup"
                    label="Advanced Setup"
                    :icon="'add'"
                   class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2 "
                    />
            </div>
            <div v-if="expandState.advancedSetup" class=" tw-w-full row alert-setup-container tw-px-4 tw-pt-2 tw-pb-3 o2-alert-tab-border" >

            <div class="tw-w-full row">
              <div v-if="expandState.advancedSetup" class="tw-mt-2 tw-w-full ">
              <variables-input
                :variables="formData.context_attributes"
                @add:variable="addVariable"
                @remove:variable="removeVariable"
              />
            </div>
            <!-- TODO: make text area also similar to qinput -->
            <div v-if="expandState.advancedSetup" class=" tw-w-full t">
              <div data-test="add-alert-description-input tw-w-full " :class="store.state.theme === 'dark' ? '' : 'light-mode'">
                <div class="flex items-center q-mb-sm ">
                  <span class="text-bold custom-input-label">Description</span>
                </div>
                <q-input
                  v-model="formData.description"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop q-mb-sm q-text-area-input"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="0"
                  style="width: 100%; resize: none;"
                  type="textarea"
                  :placeholder="t('alerts.placeholders.typeSomething')"
                  rows="5"
                />
              </div>
              <div data-test="add-alert-row-input tw-w-full">
                <div class="flex items-center justify-between q-mb-sm">
                  <div class="flex items-center">
                    <span class="text-bold custom-input-label">Row Template</span>
                    <q-btn
                      data-test="add-alert-row-input-info-btn"
                      style="color: #A0A0A0;"
                      no-caps
                      padding="xs"
                      class="q-ml-xs"
                      size="sm"
                      flat
                      icon="info_outline"
                    >
                      <q-tooltip>
                        Row Template is used to format the alert message.
                      </q-tooltip>
                    </q-btn>
                  </div>
                  <div class="flex items-center">
                    <span class="text-caption q-mr-sm">Template Type:</span>
                    <q-btn-toggle
                      data-test="add-alert-row-template-type-toggle"
                      v-model="formData.row_template_type"
                      toggle-color="primary"
                      :options="rowTemplateTypeOptions"
                      dense
                      no-caps
                      unelevated
                      size="sm"
                    />
                  </div>
                </div>
                <q-input
                  data-test="add-alert-row-input-textarea"
                  v-model="formData.row_template"
                  color="input-border"
                  bg-color="input-bg"
                  class="row-template-input"
                  :class="store.state.theme === 'dark' ? 'dark-mode-row-template' : 'light-mode-row-template'"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="0"
                  style="width: 100%; resize: none;"
                  type="textarea"
                  :placeholder="rowTemplatePlaceholder"
                  rows="5"
                >

              </q-input>
              </div>
            </div>
            </div>

            </div>
            </div>
            
             </div>




          </q-form>

        </div>
        <div
          style="width: 430px; min-height: calc(100vh - 200px); position: sticky; top: 0 "
          class=" col-2"
        >
          <div style="height: calc(100vh - 194px); display: flex; flex-direction: column; gap: 8px;">
            <!-- Preview Alert - Top Half -->
            <preview-alert
              style="height: calc(50% - 4px); width: 100%;"
              ref="previewAlertRef"
              :formData="formData"
              :query="previewQuery"
              :selectedTab="scheduledAlertRef?.tab || 'custom'"
              :isAggregationEnabled="isAggregationEnabled"
            />

            <!-- Alert Summary - Bottom Half -->
            <alert-summary
              style="height: calc(50% - 4px);"
              :formData="formData"
              :destinations="formData.destinations"
              :focusManager="focusManager"
            />
          </div>

        </div>
        
      </div>

    </div>
    <div class="tw-mx-2">
      <div
          class="flex q-px-md full-width tw-py-3 card-container tw-justify-end"
          style="position: sticky; bottom: 0px; z-index: 2"
        >
        <!-- All Buttons (Right Side) -->
        <div class="tw-flex tw-items-center tw-gap-2">
          <!-- Wizard Navigation Buttons -->
          <template v-if="viewMode === 'wizard'">
            <q-btn
              flat
              label="Back"
              icon="arrow_back"
              class="o2-secondary-button tw-h-[36px]"
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              :disable="wizardStep === 1"
              no-caps
              @click="goToPreviousStep"
            />
            <q-btn
              flat
              label="Continue"
              icon-right="arrow_forward"
              class="o2-secondary-button tw-h-[36px]"
              :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
              :disable="isLastStep"
              no-caps
              @click="goToNextStep"
            />
            <q-separator vertical class="tw-mx-2" style="height: 36px;" />
          </template>

          <!-- Cancel and Save Buttons -->
          <q-btn
            data-test="add-alert-cancel-btn"
            v-close-popup="true"
            class="o2-secondary-button tw-h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            data-test="add-alert-submit-btn"
            class="o2-primary-button no-border tw-h-[36px]"
            :label="t('alerts.save')"
            type="submit"
            no-caps
            flat
            :disable="!isLastStep"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="onSubmit"
          />
        </div>
      </div>
    </div>

  </div>

    <q-dialog
      v-model="showJsonEditorDialog"
      position="right"
      full-height
      maximized
      :persistent="true"
    >
      <JsonEditor
        :data="formData"
        :title="'Edit Alert JSON'"
        :type="'alerts'"
        :validation-errors="validationErrors"
        @close="showJsonEditorDialog = false"
        @saveJson="saveAlertJson"
        :isEditing="beingUpdated"
      />
    </q-dialog>
<!-- 
    <!-- Hidden ScheduledAlert for Editor Dialog Access -->
    <scheduled-alert
      v-if="false"
      ref="scheduledAlertRef"
      :columns="filteredColumns"
      :streamFieldsMap="streamFieldsMap"
      :generatedSqlQuery="generatedSqlQuery"
      :conditions="formData.query_condition?.conditions || {}"
      :expandState="expandState"
      :alertData="formData"
      :sqlQueryErrorMsg="sqlQueryErrorMsg"
      :vrlFunctionError="vrlFunctionError"
      :showTimezoneWarning="showTimezoneWarning"
      :selectedStream="formData.stream_name"
      :selected-stream-type="formData.stream_type"
      :destinations="formData.destinations"
      :formattedDestinations="getFormattedDestinations"
      v-model:trigger="formData.trigger_condition"
      v-model:sql="formData.query_condition.sql"
      v-model:promql="formData.query_condition.promql"
      v-model:query_type="formData.query_condition.type"
      v-model:aggregation="formData.query_condition.aggregation"
      v-model:silence="formData.trigger_condition.silence"
      v-model:promql_condition="formData.query_condition.promql_condition"
      v-model:multi_time_range="formData.query_condition.multi_time_range"
      v-model:vrl_function="formData.query_condition.vrl_function"
      @input:update="onInputUpdate"
      @update:expandState="updateExpandState"
      @update:formData="formData = $event"
      @refresh:destinations="refreshDestinations"
      @update:destinations="updateDestinations"
      @update:group="updateGroup"
      @remove:group="removeConditionGroup"
      @update:silence="updateSilence"
      @update:multi-time-range="updateMultiTimeRange"
    /> -->

</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onUnmounted,
  watch,
  type Ref,
  computed,
  nextTick,
  defineAsyncComponent,
  onBeforeMount,
} from "vue";

import alertsService from "../../services/alerts";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar, debounce } from "quasar";
import segment from "../../services/segment_analytics";
import {
  getUUID,
  getTimezoneOffset,
  b64DecodeUnicode,
  isValidResourceName,
  getTimezonesByOffset,
} from "@/utils/zincutils";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import useFunctions from "@/composables/useFunctions";
import useQuery from "@/composables/useQuery";
import { convertDateToTimestamp } from "@/utils/date";
import {
  generateSqlQuery,
} from "@/utils/alerts/alertQueryBuilder";
import {
  validateInputs as validateInputsUtil,
  validateSqlQuery as validateSqlQueryUtil,
  saveAlertJson as saveAlertJsonUtil,
  type ValidationContext,
  type JsonValidationContext,
} from "@/utils/alerts/alertValidation";
import {
  getAlertPayload as getAlertPayloadUtil,
  prepareAndSaveAlert as prepareAndSaveAlertUtil,
  type PayloadContext,
  type SaveAlertContext,
} from "@/utils/alerts/alertPayload";
import {
  getParser as getParserUtil,
  addHavingClauseToQuery,
  type SqlUtilsContext,
} from "@/utils/alerts/alertSqlUtils";

import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import AlertsContainer from "./AlertsContainer.vue";
import JsonEditor from "../common/JsonEditor.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { createAlertsContextProvider, contextRegistry } from "@/composables/contextProviders";
import HorizontalStepper from "./HorizontalStepper.vue";
import AlertSetup from "./steps/AlertSetup.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import {
  updateGroup as updateGroupUtil,
  removeConditionGroup as removeConditionGroupUtil,
  transformFEToBE as transformFEToBEUtil,
  retransformBEToFE as retransformBEToFEUtil,
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  ensureIds,
  type TransformContext,
} from "@/utils/alerts/alertDataTransforms";
import { AlertFocusManager } from "@/utils/alerts/focusManager";

const defaultValue: any = () => {
  return {
    name: "",
    stream_type: "",
    stream_name: "",
    is_real_time: "false",
    query_condition: {
      conditions:
      {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "",
        conditions: []
        },
      sql: "",
      promql: "",
      type: "custom",
      aggregation: {
        group_by: [""],
        function: "avg",
        having: {
          column: "",
          operator: ">=",
          value: 1,
        },
      },
      promql_condition: null,
      vrl_function: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: 10,
      operator: ">=",
      frequency: 1,
      cron: "",
      threshold: 3,
      silence: 10,
      frequency_type: "minutes",
      timezone: "UTC",
    },
    destinations: [],
    context_attributes: [],
    enabled: true,
    description: "",
    row_template: "",
    row_template_type: "String",
    lastTriggeredAt: 0,
    createdAt: "",
    updatedAt: "",
    owner: "",
    lastEditedBy: "",
    folder_id : "",
  };
};
let callAlert: Promise<{ data: any }>;
export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:list", "cancel:hideform", "refresh:destinations"],
  components: {
    ScheduledAlert: defineAsyncComponent(() => import("./ScheduledAlert.vue")),
    RealTimeAlert: defineAsyncComponent(() => import("./RealTimeAlert.vue")),
    VariablesInput: defineAsyncComponent(() => import("./VariablesInput.vue")),
    PreviewAlert: defineAsyncComponent(() => import("./PreviewAlert.vue")),
    AlertSummary: defineAsyncComponent(() => import("./AlertSummary.vue")),
    SelectFolderDropDown,
    AlertsContainer,
    JsonEditor,
    HorizontalStepper,
    AlertSetup,
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    AlertWizardRightColumn,
  },
  setup(props, { emit }) {
    const store: any = useStore();
    let beingUpdated: boolean = false;
    const addAlertForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const { t } = useI18n();
    const q = useQuasar();
    const editorRef: any = ref(null);
    const filteredColumns: any = ref([]);
    const filteredStreams: Ref<string[]> = ref([]);
    let editorobj: any = null;
    var sqlAST: any = ref(null);
    const selectedRelativeValue = ref("1");
    const selectedRelativePeriod = ref("Minutes");
    const relativePeriods: any = ref(["Minutes"]);
    var triggerCols: any = ref([]);
    const selectedDestinations = ref("slack");
    const originalStreamFields: any = ref([]);
    const isAggregationEnabled = ref(false);
    const realTimeAlertRef: any = ref(null);
    const expandState = ref({
      alertSetup: true,
      queryMode: true,
      advancedSetup: true,
      realTimeMode: true,
      thresholds: true,
      multiWindowSelection: false,
    });
    var triggerOperators: any = ref([

      "=",
      "!=",
      ">=",
      "<=",
      ">",
      "<",
      "Contains",
      "NotContains",
    ]);
    const showVrlFunction = ref(false);
    const isFetchingStreams = ref(false);
    const streamTypes = ["logs", "metrics", "traces"];
    const rowTemplateTypeOptions = [
      { label: 'String', value: 'String' },
      { label: 'JSON', value: 'Json' }
    ];
    const editorUpdate = (e: any) => {
      formData.value.sql = e.target.value;
    };
    const { getAllFunctions } = useFunctions();

    const { getStreams, getStream } = useStreams();

    const { buildQueryPayload } = useQuery();

    // Focus manager for alert summary clickable fields
    const focusManager = new AlertFocusManager();
    const streamFieldRef = ref(null);
    const streamTypeFieldRef = ref(null);

    const previewQuery = ref("");

    const sqlQueryErrorMsg = ref("");

    const validateSqlQueryPromise = ref<Promise<unknown>>();

    const addAlertFormRef = ref(null);

    const router = useRouter();
    const scheduledAlertRef: any = ref(null);
    const viewSqlEditorDialog = ref(false);

    const plotChart: any = ref(null);

    const previewAlertRef: any = ref(null);

    let parser: any = null;

    const vrlFunctionError = ref("");

    const showTimezoneWarning = ref(false);

    const showJsonEditorDialog = ref(false);
    const validationErrors = ref([]);

    const isLoadingPanelData = ref(false);

    const { track } = useReo();

    const activeFolderId = ref(router.currentRoute.value.query.folder || "default");

    const updateActiveFolderId = (folderId: any) => {
      activeFolderId.value = folderId.value;
    };

    // View mode toggle: 'classic' or 'wizard'
    const viewMode = ref('classic');

    // Wizard step state
    const wizardStep = ref(1);
    const wizardStepper = ref(null);
    const step1Ref = ref(null);

    // Computed property for step captions to avoid flickering
    const currentStepCaption = computed(() => {
      const captions: Record<number, string> = {
        1: 'Set the stage for your alert',
        2: 'What should trigger the alert',
        3: 'Set your alert rules and choose how you\'d like to be notified.',
        4: 'Compare current results with data from another time period',
        5: 'Avoid sending the same alert multiple times by grouping similar alerts together.',
        6: 'Context variables, description, and row template',
      };
      return captions[wizardStep.value] || '';
    });

    const goToStep2 = async () => {
      // Validate step 1 before proceeding
      if (step1Ref.value && typeof step1Ref.value.validate === 'function') {
        const isValid = await step1Ref.value.validate();
        if (isValid) {
          wizardStep.value = 2;
        }
      } else {
        wizardStep.value = 2;
      }
    };

    onBeforeMount(async () => {
      await importSqlParser();
      await getAllFunctions();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    const streamFieldsMap = computed(() => {
      const map: any = {};
      originalStreamFields.value.forEach((field: any) => {
        map[field.value] = field;
      });
      return map;
    });

    const showPreview = computed(() => {
      return formData.value.stream_type && formData.value.stream_name;
    });

    const rowTemplatePlaceholder = computed(() => {
      return formData.value.row_template_type === 'Json'
        ? 'e.g - {"user": "{name}", "timestamp": "{timestamp}"}'
        : 'e.g - Alert was triggered at {timestamp}';
    });

    const decodedVrlFunction = computed(() => {
      if (!formData.value.query_condition.vrl_function) {
        return "";
      }
      try {
        return b64DecodeUnicode(formData.value.query_condition.vrl_function);
      } catch (e) {
        return formData.value.query_condition.vrl_function;
      }
    });

    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");
    const alertType = ref(router.currentRoute.value.query.alert_type || "all");

    onMounted(async () => {
      // Set up alerts context provider
      const alertsProvider = createAlertsContextProvider(formData, store, props.isUpdated);
      contextRegistry.register('alerts', alertsProvider);
      contextRegistry.setActive('alerts');

      // Register fields with focus manager for clickable summary
      // Wait for next tick to ensure refs are available
      await nextTick();
      focusManager.registerField('streamType', { ref: streamTypeFieldRef });
      focusManager.registerField('stream', { ref: streamFieldRef });
    });

    // Track setTimeout IDs to clean them up properly
    let multiWindowTimeout: number | null = null;

    // Track which fields are currently registered for each alert type
    const scheduledFieldIds = ['frequency', 'period', 'threshold', 'operator', 'silence', 'conditions', 'multiwindow', 'destinations'];
    const realTimeFieldIds = ['silence', 'conditions', 'destinations'];

    // Watch for scheduledAlertRef to become available and register its fields
    watch(scheduledAlertRef, (newVal, oldVal) => {
      // Clean up old registrations if switching away from scheduled alert
      if (oldVal && !newVal) {
        scheduledFieldIds.forEach(fieldId => {
          focusManager.unregisterField(fieldId);
        });
        // Clear any pending multiwindow timeout
        if (multiWindowTimeout) {
          clearTimeout(multiWindowTimeout);
          multiWindowTimeout = null;
        }
      }

      if (newVal) {
        // Register ScheduledAlert fields once the component is mounted
        nextTick(() => {
          focusManager.registerField('frequency', {
            ref: newVal.frequencyFieldRef,
            onBeforeFocus: () => {
              // Expand Query section if collapsed
              expandState.value.queryMode = true;
            }
          });
          focusManager.registerField('period', {
            ref: newVal.periodFieldRef,
            onBeforeFocus: () => {
              // Expand Query section if collapsed
              expandState.value.queryMode = true;
            }
          });
          focusManager.registerField('threshold', {
            ref: newVal.thresholdFieldRef,
            onBeforeFocus: () => {
              // Expand Thresholds section if collapsed
              expandState.value.thresholds = true;
            }
          });
          focusManager.registerField('operator', {
            ref: newVal.operatorFieldRef,
            onBeforeFocus: () => {
              // Expand Thresholds section if collapsed
              expandState.value.thresholds = true;
            }
          });
          focusManager.registerField('silence', {
            ref: newVal.silenceFieldRef,
            onBeforeFocus: () => {
              // Expand Thresholds section if collapsed
              expandState.value.thresholds = true;
            }
          });
          focusManager.registerField('conditions', {
            ref: newVal.conditionsFieldRef,
            onBeforeFocus: () => {
              // Expand Query section if collapsed
              expandState.value.queryMode = true;
            }
          });
          // Register multiwindow field with additional delay to ensure ref is populated
          // Clear any existing timeout first
          if (multiWindowTimeout) {
            clearTimeout(multiWindowTimeout);
          }
          multiWindowTimeout = window.setTimeout(() => {
            // Check if component still exists before registering
            if (scheduledAlertRef.value && newVal.multiWindowContainerRef) {
              focusManager.registerField('multiwindow', {
                ref: newVal.multiWindowContainerRef,
                onBeforeFocus: () => {
                  // Expand Multi Window section if collapsed
                  expandState.value.multiWindowSelection = true;
                }
              });
            }
            multiWindowTimeout = null;
          }, 100);
          focusManager.registerField('destinations', {
            ref: newVal.destinationSelectRef,
            onBeforeFocus: () => {
              // Expand Thresholds section if collapsed (destinations are in thresholds section)
              expandState.value.thresholds = true;
            }
          });
        });
      }
    }, { immediate: true });

    // Watch for realTimeAlertRef to become available and register its fields
    watch(realTimeAlertRef, (newVal, oldVal) => {
      // Clean up old registrations if switching away from real-time alert
      if (oldVal && !newVal) {
        realTimeFieldIds.forEach(fieldId => {
          focusManager.unregisterField(fieldId);
        });
      }

      if (newVal) {
        // Register RealTimeAlert fields once the component is mounted
        nextTick(() => {
          focusManager.registerField('silence', {
            ref: newVal.silenceFieldRef,
            onBeforeFocus: () => {
              // Expand Alert Settings section if collapsed
              expandState.value.thresholds = true;
            }
          });
          focusManager.registerField('conditions', {
            ref: newVal.conditionsFieldRef,
            onBeforeFocus: () => {
              // Expand Conditions section if collapsed
              expandState.value.realTimeMode = true;
            }
          });
          focusManager.registerField('destinations', {
            ref: newVal.destinationSelectRef,
            onBeforeFocus: () => {
              // Expand Alert Settings section if collapsed
              expandState.value.thresholds = true;
            }
          });
        });
      }
    }, { immediate: true });

    onUnmounted(() => {
      // Clean up alerts-specific context provider
      contextRegistry.unregister('alerts');
      contextRegistry.setActive('');

      // Clear any pending multiwindow timeout
      if (multiWindowTimeout) {
        clearTimeout(multiWindowTimeout);
        multiWindowTimeout = null;
      }

      // Clean up focus manager
      focusManager.clear();
    });

    const updateEditorContent = async (stream_name: string) => {
      triggerCols.value = [];
      if (!stream_name) return;

      if (editorData.value) {
        editorData.value = editorData.value
          .replace(prefixCode.value, "")
          .trim();
        editorData.value = editorData.value
          .replace(suffixCode.value, "")
          .trim();
      }

      if (!props.isUpdated) {
        prefixCode.value = `select * from`;
        suffixCode.value = "'" + formData.value.stream_name + "'";
        const someCode = `${prefixCode.value} ${editorData.value} ${suffixCode.value}`;
      }

      const selected_stream: any = await getStream(
        stream_name,
        formData.value.stream_type,
        true,
      );
      selected_stream.schema.forEach(function (item: any) {
        triggerCols.value.push(item.name);
      });
    };

    const updateStreamFields = async (stream_name: any) => {
      let streamCols: any = [];
      const streams: any = await getStream(
        stream_name,
        formData.value.stream_type,
        true,
      );

      if (streams && Array.isArray(streams.schema)) {
        streamCols = streams.schema.map((column: any) => ({
          label: column.name,
          value: column.name,
          type: column.type,
        }));
      }

      originalStreamFields.value = [...streamCols];
      filteredColumns.value = [...streamCols];

      onInputUpdate("stream_name", stream_name);
    };
    watch(
      () => props.destinations.length, // Watch for length changes
      (newLength, oldLength) => {
        formData.value.destinations = formData.value.destinations.filter(
          (destination: any) => {
            return props.destinations.some((dest: any) => {
              return dest.name === destination;
            });
          },
        );
      },
    );

    watch(
      triggerCols.value,
      () => {
        filteredColumns.value = [...triggerCols.value];
      },
      { immediate: true },
    );
    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter(
          (column: any) => column.toLowerCase().indexOf(value) > -1,
        );
      });
      return filteredOptions;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) formData.value.stream_name = "";
      if (streams.value[formData.value.stream_type]) {
        schemaList.value = streams.value[formData.value.stream_type];
        indexOptions.value = streams.value[formData.value.stream_type].map(
          (data: any) => {
            return data.name;
          },
        );
        return;
      }

      if (!formData.value.stream_type) return Promise.resolve();

      isFetchingStreams.value = true;
      return getStreams(formData.value.stream_type, false)
        .then((res: any) => {
          streams.value[formData.value.stream_type] = res.list;
          schemaList.value = res.list;
          indexOptions.value = res.list.map((data: any) => {
            return data.name;
          });

          if (formData.value.stream_name)
            updateStreamFields(formData.value.stream_name);
          return Promise.resolve();
        })
        .catch(() => Promise.reject())
        .finally(() => (isFetchingStreams.value = false));
    };

    const filterStreams = (val: string, update: any) => {
      filteredStreams.value = filterColumns(indexOptions.value, val, update);
    };


    const addVariable = () => {
      formData.value.context_attributes.push({
        name: "",
        value: "",
        id: getUUID(),
      });
    };

    const removeVariable = (variable: any) => {
      formData.value.context_attributes =
        formData.value.context_attributes.filter(
          (_variable: any) => _variable.id !== variable.id,
        );
    };

    const getSelectedTab = computed(() => {
      return scheduledAlertRef.value?.tab || null;
    });

    const openEditorDialog = () => {
      viewSqlEditorDialog.value = true;
    };

    // Watch viewSqlEditorDialog and sync with ScheduledAlert
    watch(viewSqlEditorDialog, (newValue) => {
      if (scheduledAlertRef.value && scheduledAlertRef.value.viewSqlEditor) {
        scheduledAlertRef.value.viewSqlEditor.value = newValue;
      }
    });

    // Watch ScheduledAlert's viewSqlEditor and sync back
    watch(() => scheduledAlertRef.value?.viewSqlEditor?.value, (newValue) => {
      if (newValue !== undefined && newValue !== viewSqlEditorDialog.value) {
        viewSqlEditorDialog.value = newValue;
      }
    });

    const previewAlert = async () => {
      if (getSelectedTab.value === "custom"){
        previewQuery.value = generateSqlQueryLocal();

      }
      else if (getSelectedTab.value === "sql")
        previewQuery.value = formData.value.query_condition.sql.trim();
      else if (getSelectedTab.value === "promql")
        previewQuery.value = formData.value.query_condition.promql.trim();

      if (formData.value.is_real_time === "true") {
        previewQuery.value = generateSqlQueryLocal();
      }

      await nextTick();
      if (getSelectedTab.value !== "sql") {
        previewAlertRef.value?.refreshData();
      }
    };




    const generateSqlQueryLocal = () => {
      return generateSqlQuery(
        formData.value,
        streamFieldsMap.value,
        isAggregationEnabled.value,
        store.state.zoConfig.timestamp_column || "_timestamp"
      );
    };

    // Computed SQL query for preview in FilterGroup
    // Only generate when in custom tab with conditions
    const generatedSqlQuery = computed(() => {
      try {
        if (formData.value.query_condition?.conditions &&
            Object.keys(formData.value.query_condition.conditions).length > 0) {
          return generateSqlQueryLocal();
        }
      } catch (e) {
        console.error('Error generating SQL query for preview:', e);
      }
      return '';
    });

    const debouncedPreviewAlert = debounce(previewAlert, 500);

    const onInputUpdate = async (name: string, value: any) => {
      if (showPreview.value) {
        debouncedPreviewAlert();
      }
    };
    const getParser = (sqlQuery: string) => {
      const sqlUtilsContext: SqlUtilsContext = {
        parser,
        sqlQueryErrorMsg,
      };
      return getParserUtil(sqlQuery, sqlUtilsContext);
    };

    const getAlertPayload = () => {
      const payloadContext: PayloadContext = {
        store,
        isAggregationEnabled,
        getSelectedTab,
        beingUpdated,
      };
      return getAlertPayloadUtil(formData.value, payloadContext);
    };

    const validateInputs = (input: any, notify: boolean = true) => {
      const validationContext: ValidationContext = {
        q,
        store,
        scheduledAlertRef,
        validateSqlQueryPromise,
        sqlQueryErrorMsg,
        vrlFunctionError,
        buildQueryPayload,
        getParser,
      };
      return validateInputsUtil(input, validationContext, notify);
    };

    const validateSqlQuery = async () => {
      const validationContext: ValidationContext = {
        q,
        store,
        scheduledAlertRef,
        validateSqlQueryPromise,
        sqlQueryErrorMsg,
        vrlFunctionError,
        buildQueryPayload,
        getParser,
      };
      return validateSqlQueryUtil(formData.value, validationContext);
    };

    const updateFunctionVisibility = () => {
      // if validateSqlQueryPromise has error "function_error" then reset the promise when function is disabled
      if (!showVrlFunction.value && vrlFunctionError.value) {
        validateSqlQueryPromise.value = Promise.resolve("");
        vrlFunctionError.value = "";
      }
    };
    const updateMultiTimeRange = (value: any) => {
      if (value) {
        formData.value.query_condition.multi_time_range = value;
      }
    };
    const updateSilence = (value: any) => {
      if (value) {
        formData.value.trigger_condition.silence = value;
      }
    }

    const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    const HTTP_FORBIDDEN = 403;

    const handleAlertError = (err: any) => {
      if (err.response?.status !== HTTP_FORBIDDEN) {
        console.log(err);
        q.notify({
          type: "negative",
          message: err.response?.data?.message || err.response?.data?.error || err.response?.data,
        });
      }
    };
    const updateExpandState = (value: any) => {
      expandState.value = value;
    };

    const refreshDestinations = () => {
      emit("refresh:destinations");
    }
    const updateDestinations = (destinations: any[]) => {
      formData.value.destinations = destinations;
    }

    const updateTab = (tab: string) => {
      if (scheduledAlertRef.value) {
        scheduledAlertRef.value.tab = tab;
      }
    }


// Method to handle the emitted changes and update the structure
  const updateGroup = (updatedGroup: any) => {
    const transformContext: TransformContext = { formData: formData.value };
    updateGroupUtil(updatedGroup, transformContext);
  };
  const removeConditionGroup = (targetGroupId: string, currentGroup?: any) => {
    const transformContext: TransformContext = { formData: formData.value };
    removeConditionGroupUtil(targetGroupId, currentGroup, transformContext);
  };


  // Method to transform the form data to the backend format
  //so in the FE we are constructing the data like 
  //eg: 
  // {
  //   groupId: '123',
  //   label: 'and',
  //   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  // but in the BE we are expecting the data like 
  // {
  //   and: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  const transformFEToBE = (node: any) => {
    return transformFEToBEUtil(node);
  };

  // Method to transform the backend data to the frontend format
  //when we get response from the BE we need to transform it to the frontend format
  //eg: 
  // {
  //   and: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  // to
  // {
  //   groupId: '123',  
  //   label: 'and',
  //   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  const retransformBEToFE = (data: any) => {
    return retransformBEToFEUtil(data);
  };
  const validateFormAndNavigateToErrorField = async (formRef: any) => {
      const isValid = await formRef.validate().then(async (valid: any) => {
        return valid;
      });
      if (!isValid) {
        navigateToErrorField(formRef);
        return false;
      }
      return true;
    }

    const navigateToErrorField = (formRef: any) => {
      const errorField = formRef.$el.querySelector('.q-field--error');
      if (errorField) {
        errorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    const loadPanelDataIfPresent = async () => {
      const route = router.currentRoute.value;

      if (route.query.fromPanel === "true" && route.query.panelData) {
        isLoadingPanelData.value = true;
        try {
          const panelData = JSON.parse(decodeURIComponent(route.query.panelData as string));

          if (panelData.queries && panelData.queries.length > 0) {
            const query = panelData.queries[0];

            formData.value.name = `Alert from ${panelData.panelTitle}`;

            // Show notification that query was imported
            q.notify({
              type: "positive",
              message: t("alerts.importedFromPanel", { panelTitle: panelData.panelTitle }),
              timeout: 3000,
            });

            if (query.fields?.stream_type) {
              formData.value.stream_type = query.fields.stream_type;
            }

            if (query.fields?.stream) {
              formData.value.stream_name = query.fields.stream;
              await updateStreams(false);
              await updateStreamFields(query.fields.stream);
            }

            // Set query type based on panel (SQL or PromQL)
            // Always set a specific type - never leave it as empty string to avoid defaulting to quick mode
            if (panelData.queryType === "sql") {
              formData.value.query_condition.type = "sql";
              // Use executedQuery if available (has variables replaced), otherwise use query.query
              const sourceQuery = panelData.executedQuery || query.query;
              if (sourceQuery) {
                let sqlQuery = sourceQuery;

                // If threshold is provided and we have a SQL query with GROUP BY,
                // add a HAVING clause to filter the aggregated column
                if (panelData.threshold !== undefined && panelData.condition && panelData.yAxisColumn) {
                  const threshold = panelData.threshold;
                  const operator = panelData.condition === 'above' ? '>=' : '<=';
                  const yAxisColumn = panelData.yAxisColumn;

                  // Use node-sql-parser to properly insert HAVING clause in the correct position
                  // This handles queries with ORDER BY, LIMIT, OFFSET, etc.
                  // Ensure parser is initialized first
                  if (!parser) {
                    await importSqlParser();
                  }
                  sqlQuery = addHavingClauseToQuery(sqlQuery, yAxisColumn, operator, threshold, parser);
                }

                formData.value.query_condition.sql = sqlQuery;
              }
            } else if (panelData.queryType === "promql") {
              formData.value.query_condition.type = "promql";
              // Use executedQuery if available (has variables replaced), otherwise use query.query
              const sourceQuery = panelData.executedQuery || query.query;
              if (sourceQuery) {
                formData.value.query_condition.promql = sourceQuery;
              }
            } else {
              // Default to SQL mode if queryType is not specified
              // This prevents falling back to quick mode
              formData.value.query_condition.type = "sql";
            }

            // Handle query builder fields for SQL panels
            if (panelData.queryType === "sql" && query.customQuery === false && query.fields) {
              // Enable aggregation for query builder generated SQL
              isAggregationEnabled.value = true;

              if (query.fields.x && query.fields.x.length > 0) {
                if (!formData.value.query_condition.aggregation) {
                  formData.value.query_condition.aggregation = {
                    group_by: [],
                    function: "count",
                    having: {
                      column: "",
                      operator: ">=",
                      value: 1,
                    },
                  };
                }
                formData.value.query_condition.aggregation.group_by = query.fields.x.map((x: any) => x.alias || x.column);
              }

              if (query.fields.y && query.fields.y.length > 0) {
                const yField = query.fields.y[0];
                if (yField.aggregationFunction) {
                  if (!formData.value.query_condition.aggregation) {
                    formData.value.query_condition.aggregation = {
                      group_by: [""],
                      function: "count",
                      having: {
                        column: "",
                        operator: ">=",
                        value: 1,
                      },
                    };
                  }
                  formData.value.query_condition.aggregation.function = yField.aggregationFunction.toLowerCase();
                  // Set the having.column to the Y-axis field for threshold comparison
                  formData.value.query_condition.aggregation.having.column = yField.alias || yField.column;
                }
              }

              if (query.fields.filter && query.fields.filter.length > 0) {
                const conditions: any[] = [];
                query.fields.filter.forEach((filter: any) => {
                  if (filter.type === 'list' && filter.values && filter.values.length > 0) {
                    // V2: Create condition with filterType and logicalOperator
                    conditions.push({
                      filterType: 'condition',
                      column: filter.column,
                      operator: "=",
                      value: filter.values[0],
                      values: [],
                      logicalOperator: 'AND',
                      id: getUUID()
                    });
                  }
                });

                if (conditions.length > 0) {
                  // V2: Create group with filterType and conditions array
                  formData.value.query_condition.conditions = {
                    filterType: 'group',
                    logicalOperator: 'AND',
                    groupId: getUUID(),
                    conditions: conditions
                  };
                }
              }
            }

            if (query.vrlFunctionQuery) {
              showVrlFunction.value = true;
              formData.value.query_condition.vrl_function = query.vrlFunctionQuery;
            }

            if (panelData.timeRange?.value_type === "relative") {
              const relativeValue = panelData.timeRange.relative_value || 15;
              const relativePeriod = panelData.timeRange.relative_period || "Minutes";

              let periodInMinutes = relativeValue;
              if (relativePeriod === "Hours") {
                periodInMinutes = relativeValue * 60;
              } else if (relativePeriod === "Days") {
                periodInMinutes = relativeValue * 60 * 24;
              } else if (relativePeriod === "Weeks") {
                periodInMinutes = relativeValue * 60 * 24 * 7;
              }

              formData.value.trigger_condition.period = periodInMinutes;
            }

            // Handle threshold and condition from context menu
            if (panelData.threshold !== undefined && panelData.condition) {
              // For SQL with aggregation: use HAVING clause for value comparison
              // For PromQL: use promql_condition for value comparison
              // In both cases, set trigger_condition.threshold to 1 (fire when any row/result is returned)

              if (panelData.queryType === 'promql') {
                // For PromQL: Set up promql_condition with the threshold
                if (!formData.value.query_condition.promql_condition) {
                  formData.value.query_condition.promql_condition = {
                    operator: '>=',
                    value: 1,
                  };
                }
                formData.value.query_condition.promql_condition.value = panelData.threshold;
                formData.value.query_condition.promql_condition.operator =
                  panelData.condition === 'above' ? '>=' : '<=';
              } else {
                // For SQL: Set up aggregation HAVING clause with the threshold
                // If aggregation is enabled, set the having clause
                if (isAggregationEnabled.value && formData.value.query_condition.aggregation) {
                  if (!formData.value.query_condition.aggregation.having) {
                    formData.value.query_condition.aggregation.having = {
                      column: "",
                      operator: ">=",
                      value: 1,
                    };
                  }
                  formData.value.query_condition.aggregation.having.value = panelData.threshold;
                  formData.value.query_condition.aggregation.having.operator =
                    panelData.condition === 'above' ? '>=' : '<=';
                }
              }

              // Set alert trigger threshold to 1 and operator to >=
              // This means: fire the alert when ANY row is returned from the query
              // (The actual value comparison is done in HAVING clause for SQL or in PromQL query)
              formData.value.trigger_condition.threshold = 1;
              formData.value.trigger_condition.operator = '>=';
            }
          }
        } catch (error) {
          console.error("Error loading panel data:", error);
          q.notify({
            type: "negative",
            message: "Failed to load panel data",
            timeout: 2000
          });
        } finally {
          isLoadingPanelData.value = false;
        }
      }
    };


    const openJsonEditor = () => {
      showJsonEditorDialog.value = true;
    };

    const saveAlertJson = async (json: any) => {
      const saveContext: SaveAlertContext = {
        q,
        store,
        props,
        emit,
        router,
        isAggregationEnabled,
        activeFolderId: { value: Array.isArray(activeFolderId.value) ? activeFolderId.value[0] : activeFolderId.value },
        handleAlertError,
      };

      const prepareAndSaveAlertFunction = (data: any) => prepareAndSaveAlertUtil(data, saveContext);

      const jsonValidationContext: JsonValidationContext = {
        q,
        store,
        streams,
        getParser,
        buildQueryPayload,
        prepareAndSaveAlert: prepareAndSaveAlertFunction,
      };

      await saveAlertJsonUtil(
        json,
        props,
        validationErrors,
        showJsonEditorDialog,
        formData,
        jsonValidationContext,
      );
    };

    // Wizard step navigation logic
    const goToNextStep = () => {
      if (formData.value.is_real_time === 'true') {
        // For real-time alerts: 1 -> 2 -> 4 -> 6 (skip 3 and 5)
        if (wizardStep.value === 2) {
          wizardStep.value = 4;
        } else if (wizardStep.value === 4) {
          wizardStep.value = 6;
        } else {
          wizardStep.value = wizardStep.value + 1;
        }
      } else {
        // For scheduled alerts: normal progression 1 -> 2 -> 3 -> 4 -> 5 -> 6
        wizardStep.value = wizardStep.value + 1;
      }
    };

    const goToPreviousStep = () => {
      if (formData.value.is_real_time === 'true') {
        // For real-time alerts: 6 -> 4 -> 2 -> 1 (skip 5 and 3)
        if (wizardStep.value === 6) {
          wizardStep.value = 4;
        } else if (wizardStep.value === 4) {
          wizardStep.value = 2;
        } else {
          wizardStep.value = wizardStep.value - 1;
        }
      } else {
        // For scheduled alerts: normal progression 6 -> 5 -> 4 -> 3 -> 2 -> 1
        wizardStep.value = wizardStep.value - 1;
      }
    };

    const isLastStep = computed(() => {
      if (formData.value.is_real_time === 'true') {
        // For real-time alerts, step 6 is the last step
        return wizardStep.value === 6;
      } else {
        // For scheduled alerts, step 6 is also the last step
        return wizardStep.value === 6;
      }
    });

    return {
      t,
      q,
      disableColor,
      beingUpdated,
      formData,
      addAlertForm,
      store,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorData,
      selectedRelativeValue,
      selectedRelativePeriod,
      relativePeriods,
      editorUpdate,
      updateStreamFields,
      updateEditorContent,
      triggerCols,
      triggerOperators,
      sqlAST,
      schemaList,
      filteredColumns,
      streamTypes,
      rowTemplateTypeOptions,
      streams,
      updateStreams,
      isFetchingStreams,
      filteredStreams,
      filterStreams,
      removeVariable,
      addVariable,
      selectedDestinations,
      scheduledAlertRef,
      router,
      isAggregationEnabled,
      plotChart,
      previewAlert,
      addAlertFormRef,
      validateInputs,
      getAlertPayload,
      getParser,
      onInputUpdate,
      showPreview,
      rowTemplatePlaceholder,
      streamFieldsMap,
      generatedSqlQuery,
      previewQuery,
      previewAlertRef,
      outlinedInfo,
      getTimezoneOffset,
      showVrlFunction,
      validateSqlQuery,
      validateSqlQueryPromise,
      isValidResourceName,
      sqlQueryErrorMsg,
      vrlFunctionError,
      updateFunctionVisibility,
      convertDateToTimestamp,
      getTimezonesByOffset,
      showTimezoneWarning,
      updateMultiTimeRange,
      routeToCreateDestination,
      handleAlertError,
      activeFolderId,
      updateActiveFolderId,
      alertType,
      expandState,
      updateExpandState,
      updateSilence,
      refreshDestinations,
      updateDestinations,
      updateTab,
      updateGroup,
      removeConditionGroup,
      transformFEToBE,
      retransformBEToFE,
      validateFormAndNavigateToErrorField,
      openEditorDialog,
      decodedVrlFunction,
      viewSqlEditorDialog,
      navigateToErrorField,
      realTimeAlertRef,
      openJsonEditor,
      showJsonEditorDialog,
      saveAlertJson,
      validationErrors,
      originalStreamFields,
      generateSqlQuery: generateSqlQueryLocal,
      track,
      loadPanelDataIfPresent,
      isLoadingPanelData,
      focusManager,
      streamFieldRef,
      streamTypeFieldRef,
      viewMode,
      wizardStep,
      wizardStepper,
      step1Ref,
      currentStepCaption,
      goToStep2,
      goToNextStep,
      goToPreviousStep,
      isLastStep,
    };
  },

  async created() {
    // TODO OK: Refactor this code
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...cloneDeep(this.modelValue) };

    // Check if this is from a dashboard panel - if so, don't set default query type
    const route = this.router.currentRoute.value;
    const isFromPanel = route.query.fromPanel === "true" && route.query.panelData;

    if(!this.isUpdated){
      this.formData.is_real_time = this.alertType === 'realTime'? true : false;
    }
      this.formData.is_real_time = this.formData.is_real_time.toString();

    // If from panel, load panel data BEFORE initializing child components
    // This ensures the correct query type is set before ScheduledAlert initializes
    if (isFromPanel) {
      this.formData.query_condition.type = ""; // Temporarily set to empty
      await this.loadPanelDataIfPresent(); // Load panel data and set correct type
    }

    // Set default frequency to min_auto_refresh_interval
    if (this.store.state?.zoConfig?.min_auto_refresh_interval)
      this.formData.trigger_condition.frequency = Math.ceil(
        this.store.state?.zoConfig?.min_auto_refresh_interval / 60 || 1,
      );

    this.beingUpdated = this.isUpdated;
    this.updateStreams(false)?.then(() => {
      this.updateEditorContent(this.formData.stream_name);
    });
    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = cloneDeep(this.modelValue);
      this.isAggregationEnabled = !!this.formData.query_condition.aggregation;

      if (!this.formData.trigger_condition?.timezone) {
        if (this.formData.tz_offset === 0) {
          this.formData.trigger_condition.timezone = "UTC";
        } else {
          this.getTimezonesByOffset(this.formData.tz_offset).then(
            (res: any) => {
              if (res.length > 1) this.showTimezoneWarning = true;
              this.formData.trigger_condition.timezone = res[0];
            },
          );
        }
      }

      if (this.formData.query_condition.vrl_function) {
        this.showVrlFunction = true;
        this.formData.query_condition.vrl_function = b64DecodeUnicode(
          this.formData.query_condition.vrl_function,
        );
      }
    }

    this.formData.is_real_time = this.formData.is_real_time.toString();
    this.formData.context_attributes = Object.keys(
      this.formData.context_attributes,
    ).map((attr) => {
      return {
        key: attr,
        value: this.formData.context_attributes[attr],
        id: getUUID(),
      };
    });
    // VERSION DETECTION AND CONVERSION
    // Supports three versions:
    // - V0: Flat array of conditions with implicit AND between all (no groups)
    // - V1: Tree-based structure with {and: [...]} or {or: [...]} or {label, items, groupId}
    // - V2: Linear structure with filterType, logicalOperator per condition

    // Check for V2 format from backend
    // Backend sends: query_condition: { conditions: { version: 2, conditions: {...} } }
    if (this.formData.query_condition.conditions?.version === "2" || this.formData.query_condition.conditions?.version === 2) {
      // V2: Extract the nested conditions object
      // Backend sends { version: 2, conditions: {...} }, we need just the inner conditions
      this.formData.query_condition.conditions = ensureIds(this.formData.query_condition.conditions.conditions);
    } else if(this.formData.query_condition.conditions && ( !Array.isArray(this.formData.query_condition.conditions) && Object.keys(this.formData.query_condition.conditions).length != 0)){
      // No version field - could be V1 or old V2
      // Detect version by structure
      const version = detectConditionsVersion(this.formData.query_condition.conditions);

      if (version === 0) {
        // V0: Flat array format - convert to V2
        // V0 had implicit AND between all conditions (no groups)
        this.formData.query_condition.conditions = ensureIds(convertV0ToV2(this.formData.query_condition.conditions));
      } else if (version === 1) {
        // V1 format - need to convert to V2
        // First check if it's BE format ({and: [...]}) or FE format ({label, items, groupId})
        if (this.formData.query_condition.conditions.and || this.formData.query_condition.conditions.or) {
          // V1 Backend format - convert to V2
          this.formData.query_condition.conditions = ensureIds(convertV1BEToV2(this.formData.query_condition.conditions));
        } else if (this.formData.query_condition.conditions.label && this.formData.query_condition.conditions.items) {
          // V1 Frontend format - convert to V2
          // this wont be executed atleast once but we are keeping it incase any FE logics got saved already 
          this.formData.query_condition.conditions = ensureIds(convertV1ToV2(this.formData.query_condition.conditions));
        }
      } else {
        // V2 format - ensure all IDs exist
        this.formData.query_condition.conditions = ensureIds(this.formData.query_condition.conditions);
      }
    } else if (Array.isArray(this.formData.query_condition.conditions) && this.formData.query_condition.conditions.length > 0) {
      // V0: Flat array of conditions - convert to V2
      // This handles the case where conditions is directly an array at the top level
      this.formData.query_condition.conditions = ensureIds(convertV0ToV2(this.formData.query_condition.conditions));
    }
    else if (this.formData.query_condition.conditions == null || this.formData.query_condition.conditions == undefined || this.formData.query_condition.conditions.length == 0 || Object.keys(this.formData.query_condition.conditions).length == 0){
      // No conditions - create empty V2 group
      this.formData.query_condition.conditions = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [],
        groupId: getUUID(),
      }
    }
  },

  computed: {
    getFormattedDestinations: function () {
      return this.destinations.map((destination: any) => {
        return destination.name;
      });
    },
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },

    async onSubmit() {
      // Delaying submission by 500ms to allow the form to validate, as query is validated in validateSqlQuery method
      // When user updated query and click on save
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Ensure all accordion sections are expanded before validation
      this.expandState.alertSetup = true;
      this.expandState.queryMode = true;
      this.expandState.thresholds = true;
      this.expandState.realTimeMode = true;
      this.expandState.advancedSetup = true;
      await nextTick(); // Wait for DOM to update with all expanded sections

      if (
        this.formData.is_real_time == "false" &&
        this.formData.query_condition.type == "sql" &&
        !this.getParser(this.formData.query_condition.sql)
      ) {
        this.q.notify({
          type: "negative",
          message: "Selecting all Columns in SQL query is not allowed.",
          timeout: 1500,
        });
        return false;
      }

      // if (this.formData.stream_name == "") {
      //   this.q.notify({
      //     type: "negative",
      //     message: "Please select stream name.",
      //     timeout: 1500,
      //   });
      //   return false;
      // }

      if (
        this.formData.is_real_time == "false" &&
        this.formData.trigger_condition.frequency_type == "cron"
      ) {
        const now = new Date();

        // Get the day, month, and year from the date object
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0"); // January is 0!
        const year = now.getFullYear();

        // Combine them in the DD-MM-YYYY format
        const date = `${day}-${month}-${year}`;

        // Get the hours and minutes, ensuring they are formatted with two digits
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");

        // Combine them in the HH:MM format
        const time = `${hours}:${minutes}`;

        const convertedDateTime = this.convertDateToTimestamp(
          date,
          time,
          this.formData.trigger_condition.timezone,
        );

        this.formData.tz_offset = convertedDateTime.offset;
      }

            //from here validation starts so if there are any errors we need to navigate user to that paricular field
      //this is for main form validation
      let isAlertValid = true;
      let isScheduledAlertValid = true;
      let isRealTimeAlertValid = true;
        isAlertValid = await this.validateFormAndNavigateToErrorField(this.addAlertForm);
        //we need to handle scheduled alert validation separately 
        //if there are any scheduled alert errors then we need to navigate user to that field
        if(this.formData.is_real_time == "false"){
          isScheduledAlertValid = this.scheduledAlertRef?.$el?.querySelectorAll('.q-field--error').length == 0;
        }
        else{
          isRealTimeAlertValid = this.realTimeAlertRef?.$el?.querySelectorAll('.q-field--error').length == 0;
        }
        if( isAlertValid && !isScheduledAlertValid){
          this.navigateToErrorField(this.scheduledAlertRef); 
        }
        if( isAlertValid && !isRealTimeAlertValid){
          this.navigateToErrorField(this.realTimeAlertRef);
        }
        if (!isAlertValid || !isScheduledAlertValid || !isRealTimeAlertValid) return false;


        const payload = this.getAlertPayload();
        if (!this.validateInputs(payload)) return;

        const dismiss = this.q.notify({
          spinner: true,
          message: "Please wait...",
          timeout: 2000,
        });

        if (
          this.formData.is_real_time == "false" &&
          this.formData.query_condition.type == "sql"
        ) {
          try {
            // Wait for the promise to resolve
            // Storing the SQL query validation promise in a variable
            // Case: When user edits the query and directly saves it without waiting for the validation to complete
            // So waiting here for sql validation to complete
            await this.validateSqlQueryPromise;
          } catch (error) {

            dismiss();
            this.q.notify({
              type: "negative",
              message: "Error while validating sql query. Please check the query and try again.",
              timeout: 1500,
            });
            console.error("Error while validating sql query",error);
            return false;
          }
        }

        // VERSION HANDLING
        // All conditions are converted to V2 format during data loading,
        // so we always wrap with version field for backend
        // Backend expects: query_condition: { conditions: { version: 2, conditions: {...} } }
        payload.query_condition.conditions = {
          version: 2,
          conditions: this.formData.query_condition.conditions,
        };

        if (this.beingUpdated) {
          payload.folder_id = this.router.currentRoute.value.query.folder || "default";
          callAlert = alertsService.update_by_alert_id(
            this.store.state.selectedOrganization.identifier,
            payload,
            this.activeFolderId
          );
          callAlert
            .then((res: { data: any }) => {
              this.formData = { ...defaultValue() };
              this.$emit("update:list", this.activeFolderId);
              this.addAlertForm.resetValidation();
              dismiss();
              this.q.notify({
                type: "positive",
                message: `Alert updated successfully.`,
              });
            })
            .catch((err: any) => {
              dismiss();
              this.handleAlertError(err);
            });
          this.track("Button Click", {
            button: "Update Alert",
            page: "Alerts"
          });
          segment.track("Button Click", {
            button: "Update Alert",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.formData.stream_name,
            alert_name: this.formData.name,
            page: "Add/Update Alert",
          });
          return;
        } else {
          payload.folder_id = this.activeFolderId;
          callAlert = alertsService.create_by_alert_id(
            this.store.state.selectedOrganization.identifier,
            payload,
            this.activeFolderId
          );

          callAlert
            .then((res: { data: any }) => {
              this.formData = { ...defaultValue() };
              this.$emit("update:list", this.activeFolderId);
              this.addAlertForm.resetValidation();
              dismiss();
              this.q.notify({
                type: "positive",
                message: `Alert saved successfully.`,
              });
            })
            .catch((err: any) => {
              dismiss();
              this.handleAlertError(err);
            });
          this.track("Button Click", {
            button: "Create Alert",
            page: "Alerts"
          });
          segment.track("Button Click", {
            button: "Save Alert",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.formData.stream_name,
            alert_name: this.formData.name,
            page: "Add/Update Alert",
          });
        }

    },
  },
});
</script>

<style scoped lang="scss">
#editor {
  width: 100%;
  min-height: 5rem;
  // padding-bottom: 14px;
  resize: both;
}

.alert-condition {
  .__column,
  .__value {
    width: 250px;
  }

  .__operator {
    width: 100px;
  }
}
</style>
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}

.no-case .q-field__input {
  text-transform: none !important;
}

.add-alert-form {
  .q-field--dense .q-field__control {
    .q-field__native span {
      overflow: hidden;
    }
  }

  .alert-condition .__column .q-field__control .q-field__native span {
    max-width: 152px;
    text-overflow: ellipsis;
    text-align: left;
    white-space: nowrap;
  }

  .q-field__bottom {
    padding: 2px 0;
  }
}

.silence-notification-input,
.threshould-input {
  .q-field--filled .q-field__control {
    background-color: transparent !important;
  }

  .q-field--dark .q-field__control {
    background-color: rgba(255, 255, 255, 0.07) !important;
  }
}

.dark-mode{
  .alert-setup-container{
  background-color: #212121;
  padding: 8px 16px;
  margin-left: 8px;
  border: 1px solid #343434;
  border-top: 0px !important;
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px ;
}
.q-text-area-input > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.dark-mode-row-template  > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.custom-input-label{
  color: #BDBDBD;
}
}
.light-mode{
  .alert-setup-container{
    background-color: #ffffff;
    padding: 8px 16px;
    margin-left: 8px;
    border: 1px solid #e6e6e6;
    border-top: 0px !important;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px ;
  }
  .custom-input-label{
    color: #5C5C5C;
  }
  .q-field--labeled.showLabelOnTop.q-field .q-field__control{
    border: 1px solid #d4d4d4;
  }
  .add-folder-btn{
    border: 1px solid #d4d4d4;
  }
  .dark-mode .q-text-area-input > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}

.light-mode .q-text-area-input > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
.dark-mode-row-template > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}
.light-mode-row-template > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
}
.q-text-area-input > div > div > div > textarea{  
    height: 80px !important;
    resize: none !important;
}
.row-template-input > div > div > div > textarea{
  height: 160px !important;
  resize: none !important;
}
.bottom-sticky-dark{
  background-color: #212121;
}
.bottom-sticky-light{
  background-color: #ffffff;
  border-top: 1px solid #d4d4d4
}
.input-box-bg-dark .q-field__control{
  background-color: #181a1b !important;
}
.input-box-bg-light .q-field__control{
  background-color: #ffffff !important;
}
.input-border-dark .q-field__control{
  border: 1px solid #181a1b !important;
}
.input-border-light .q-field__control{
  border: 1px solid #d4d4d4 !important;
}


.o2-alert-tab-border{
  border-top: 0.0625rem solid var(--o2-border-color);
}

// Wizard Stepper Styles
.alert-wizard-stepper {
  box-shadow: none;
  .q-stepper__step-inner{
    padding: 0.375rem !important;
  }
  .q-stepper__tab{
    padding-left: 0.375rem !important;
    min-height: 30px !important;

  }

  :deep(.q-stepper__header) {
    border-bottom: 1px solid #e0e0e0;
  }

  :deep(.q-stepper__tab) {
    padding: 12px 16px;
    min-height: 60px;
  }

  // Hide captions for inactive steps
  :deep(.q-stepper__tab) {
    .q-stepper__caption {
      display: none !important;
    }
  }

  // Show caption only on active step
  :deep(.q-stepper__tab--active) {
    .q-stepper__caption {
      display: block !important;
      opacity: 0.7;
      font-size: 12px;
      margin-top: 4px;
    }
  }

  :deep(.q-stepper__tab--active) {
    color: #1976d2;
    font-weight: 600;
  }

  :deep(.q-stepper__tab--done) {
    color: #4caf50;
  }

  :deep(.q-stepper__dot) {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  .q-stepper--horizontal .q-stepper__step-inner {
    padding: 8px !important;
  }

  // Make step titles more compact
  :deep(.q-stepper__title) {
    font-size: 14px;
    line-height: 1.2;
  }
}

.wizard-view-container {
  .q-stepper {
    background: transparent !important;
  }
}

// Dark mode adjustments
.dark-mode1 {
  .alert-wizard-stepper {
    :deep(.q-stepper__header) {
      border-bottom-color: #424242;
    }
  }
}

// Persistent step caption styles (helper text style)
.persistent-step-caption {
  font-size: 12px;
  line-height: 1.6;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-weight: 400;
  margin-left: 0.375rem;
  letter-spacing: 0.01em;
}

.dark-mode-caption {
  background-color: transparent;
  color: #9e9e9e;
  border-left: 3px solid #5a5a5a;
  padding-left: 12px !important;
}

.light-mode-caption {
  background-color: transparent;
  color: #757575;
  border-left: 3px solid #bdbdbd;
  padding-left: 12px !important;
}

</style>