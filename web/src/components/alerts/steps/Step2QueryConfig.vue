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
  <div class="step-query-config" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw-px-3 tw-py-4">
      <!-- Query Mode Tabs (hidden for real-time alerts) -->
      <div v-if="shouldShowTabs" class="tw-mb-4">
        <div class="flex items-center app-tabs-container tw-h-[36px] tw-w-fit">
          <AppTabs
            data-test="step2-query-tabs"
            :tabs="tabOptions"
            class="tabs-selection-container"
            v-model:active-tab="localTab"
            @update:active-tab="updateTab"
          />
        </div>
      </div>

      <!-- Custom Query Builder -->
      <template v-if="localTab === 'custom'">
        <FilterGroup
          :stream-fields="columns"
          :stream-fields-map="streamFieldsMap"
          :show-sql-preview="true"
          :sql-query="generatedSqlQuery"
          :group="inputData.conditions"
          :depth="0"
          @add-condition="updateGroup"
          @add-group="updateGroup"
          @remove-group="removeConditionGroup"
          @input:update="onInputUpdate"
        />
      </template>

      <!-- SQL/PromQL Preview Mode -->
      <template v-else>
        <div class="tw-w-full tw-flex tw-flex-col tw-gap-4">
          <!-- View Editor Button -->
          <div class="tw-flex tw-justify-end">
            <q-btn
              data-test="step2-view-editor-btn"
              label="View Editor"
              icon="edit"
              size="sm"
              class="text-bold add-variable no-border q-py-sm"
              color="primary"
              style="border-radius: 4px; text-transform: capitalize; color: #fff !important; font-size: 12px; min-width: 130px;"
              @click="viewSqlEditor = true"
            />
          </div>

          <!-- Preview Boxes Container -->
          <div class="tw-flex tw-gap-4 tw-w-full">
            <!-- SQL/PromQL Preview Box (50%) -->
            <div class="preview-box tw-flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" style="height: 500px;">
              <div class="preview-header tw-flex tw-items-center tw-justify-between tw-px-3 tw-py-2">
                <span class="preview-title">{{ localTab === 'sql' ? 'SQL' : 'PromQL' }} Preview</span>
              </div>
              <div class="preview-content tw-px-3 tw-py-2">
                <pre class="preview-code">{{ sqlOrPromqlQuery || `No ${localTab === 'sql' ? 'SQL' : 'PromQL'} query defined yet` }}</pre>
              </div>
            </div>

            <!-- VRL Preview Box (50%) -->
            <div class="preview-box tw-flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" style="height: 500px;">
              <div class="preview-header tw-flex tw-items-center tw-justify-between tw-px-3 tw-py-2">
                <span class="preview-title">VRL Preview</span>
              </div>
              <div class="preview-content tw-px-3 tw-py-2">
                <pre class="preview-code">{{ vrlFunction || 'No VRL function defined yet' }}</pre>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Editor Dialog -->
    <q-dialog
      v-model="viewSqlEditor"
      position="right"
      full-height
      maximized
      :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
    >
      <div class="tw-flex tw-h-full editor-dialog-card tw-pl-1">
        <div
          class="tw-h-full tw-flex tw-pr-1"
          :style="{
            width: isFullScreen ? '100vw' : store.state.isAiChatEnabled ? '65vw' : '90vw'
          }"
        >
          <div class="tw-h-full tw-w-full tw-px-2 tw-py-2">
            <!-- Header -->
            <div class="tw-h-8 tw-flex tw-items-center tw-justify-between" style="font-size: 20px;">
              <div class="tw-flex tw-items-center tw-gap-2">
                <div
                  data-test="add-alert-back-btn"
                  class="flex justify-center items-center cursor-pointer"
                  style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px;"
                  title="Go Back"
                  @click="viewSqlEditor = false"
                >
                  <q-icon name="arrow_back_ios_new" size="14px" />
                </div>
                <span class="tw-text-[18px] tw-font-[400]">Add Conditions</span>
              </div>
              <div class="tw-flex tw-items-center">
                <q-btn
                  v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
                  :ripple="false"
                  @click="toggleAIChat"
                  data-test="menu-link-ai-item"
                  no-caps
                  :borderless="true"
                  flat
                  dense
                  class="o2-button ai-hover-btn q-px-sm q-py-sm q-mr-sm"
                  :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
                  style="border-radius: 100%;"
                  @mouseenter="isHovered = true"
                  @mouseleave="isHovered = false"
                >
                  <div class="row items-center no-wrap tw-gap-2">
                    <img :src="getBtnLogo" class="header-icon ai-icon" />
                  </div>
                </q-btn>
                <q-btn
                  icon="fullscreen"
                  size="16px"
                  dense
                  class="tw-cursor-pointer"
                  :class="store.state.theme === 'dark' ? 'tw-text-white' : ''"
                  :color="isFullScreen ? 'primary' : undefined"
                  @click="() => isFullScreen = !isFullScreen"
                />
              </div>
            </div>
            <q-separator class="tw-my-2"/>

            <!-- Main Content Grid -->
            <div class="tw-grid tw-h-[calc(100vh-100px)] tw-w-full tw-grid-cols-[60%_40%] tw-gap-x-2">
              <!-- Left Section (60%) -->
              <div class="tw-flex tw-w-full">
                <div class="tw-flex tw-w-full tw-flex-col tw-h-full tw-gap-y-2">
                  <!-- SQL/PromQL Editor Section (60% of left) -->
                  <div class="tw-flex-[3] tw-w-full">
                    <div class="tw-w-full tw-h-full" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
                      <div class="tw-flex tw-items-center tw-justify-between tw-pb-2 tw-pt-1">
                        <span class="editor-text-title">{{ localTab === 'sql' ? 'SQL Editor' : 'PromQL Editor' }}</span>
                        <div class="tw-flex tw-gap-2 tw-items-center tw-h-6">
                          <div style="border: 1px solid #7980cc; border-radius: 4px; height: 32px;">
                            <q-btn
                              data-test="alert-generate-query-btn"
                              size="sm"
                              no-caps
                              dense
                              flat
                              class="text-bold no-border"
                              @click="toggleAIChat"
                            >
                              <img :style="{ width: '16px', height: '16px' }" :src="getBtnO2Logo" />
                              <span class="tw-font-[400] tw-pl-[4px] tw-text-[12px] tw-pr-[6px] tw-py-[4px] tw-text-[#7980cc]">
                                {{ localTab == 'sql' ? 'Generate SQL' : 'Generate PromQL' }}
                              </span>
                            </q-btn>
                          </div>
                          <div class="tw-h-full tw-flex tw-justify-center tw-items-center o2-select-input tw-w-full col" style="padding-top: 0">
                            <q-select
                              v-model="selectedColumn"
                              :options="filteredFields"
                              data-test="alert-search-field-select"
                              input-debounce="0"
                              behavior="menu"
                              use-input
                              borderless
                              dense
                              hide-selected
                              menu-anchor="bottom left"
                              fill-input
                              @filter="(val, update) => filterFields(val, update)"
                              @update:modelValue="onColumnSelect"
                              :placeholder="t('alerts.placeholders.searchField')"
                              style="width: 150px;"
                            >
                              <template #no-option>
                                <q-item dense>
                                  <q-item-section>{{ t("search.noResult") }}</q-item-section>
                                </q-item>
                              </template>
                            </q-select>
                          </div>
                          <div>
                            <q-btn
                              data-test="alert-run-query-btn"
                              size="sm"
                              no-caps
                              style="height: 32px;"
                              class="text-bold add-variable no-border q-py-sm"
                              color="primary"
                              @click="localTab === 'sql' ? runSqlQuery() : runPromqlQuery()"
                              :disable="localTab == 'sql' ? localSqlQuery == '' : localPromqlQuery == ''"
                            >
                              <q-icon name="search" size="20px" />
                              <span class="tw-text-[12px] tw-font-[400]">Run Query</span>
                            </q-btn>
                          </div>
                        </div>
                      </div>
                      <FullViewContainer
                        name="Input"
                        label="Input"
                        :isExpanded="true"
                        :showExpandIcon="false"
                        :label-class="'tw-ml-2'"
                        class="tw-mt-1"
                      >
                        <template #right>
                          <div v-if="streamName" class="tw-text-[12px] tw-font-semibold tw-mr-2">
                            on <span class="tw-text-[14px] tw-font-bold">{{ streamName }}</span> stream
                          </div>
                          <div v-else class="tw-text-[12px] tw-font-semibold tw-mr-2">
                            No Stream Selected
                          </div>
                        </template>
                      </FullViewContainer>

                      <!-- SQL Editor -->
                      <QueryEditor
                        v-if="localTab === 'sql'"
                        data-test="scheduled-alert-sql-editor"
                        ref="queryEditorRef"
                        editor-id="alerts-query-editor"
                        class="tw-w-full"
                        :debounceTime="300"
                        v-model:query="localSqlQuery"
                        :class="[
                          localSqlQuery === '' && queryEditorPlaceholderFlag ? 'empty-query' : '',
                          store.state.theme === 'dark' ? 'dark-mode dark-mode-editor' : 'light-mode light-mode-editor',
                        ]"
                        @update:query="updateSqlQuery"
                        @focus="queryEditorPlaceholderFlag = false"
                        @blur="onBlurQueryEditor"
                        style="min-height: 18rem;"
                        :style="{
                          height: !!sqlQueryErrorMsg ? 'calc(100% - 150px)' : 'calc(100% - 80px)'
                        }"
                      />

                      <div
                        style="height: 50px; overflow: auto;"
                        v-show="!!sqlQueryErrorMsg && localTab === 'sql'"
                        class="text-negative q-py-sm invalid-sql-error"
                      >
                        <span v-show="!!sqlQueryErrorMsg">Error: {{ sqlQueryErrorMsg }}</span>
                      </div>

                      <!-- PromQL Editor -->
                      <QueryEditor
                        v-if="localTab === 'promql'"
                        data-test="scheduled-alert-promql-editor"
                        ref="queryEditorRef"
                        editor-id="alerts-query-editor-dialog"
                        class="tw-w-full"
                        :debounceTime="300"
                        v-model:query="localPromqlQuery"
                        @update:query="updatePromqlQuery"
                        :class="[
                          localPromqlQuery === '' ? 'empty-query' : '',
                          store.state.theme === 'dark' ? 'dark-mode-editor dark-mode' : 'light-mode-editor light-mode',
                        ]"
                        :style="{ height: 'calc(100% - 70px)' }"
                        @blur="onBlurQueryEditor"
                        style="min-height: 10rem;"
                      />
                    </div>
                  </div>

                  <!-- VRL Editor Section (40% of left) -->
                  <div v-if="localTab !== 'promql'" class="tw-flex-[2] tw-w-full">
                    <div class="tw-w-full tw-h-full" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
                      <div class="tw-flex tw-items-center tw-justify-between tw-pb-1 tw-pt-1">
                        <span class="editor-text-title">VRL Editor</span>
                        <div class="tw-flex tw-gap-2 tw-items-center">
                          <div style="border: 1px solid #7980cc; border-radius: 4px; height: 32px;">
                            <q-btn
                              data-test="alert-generate-vrl-btn"
                              size="sm"
                              no-caps
                              dense
                              flat
                              class="text-bold no-border"
                              @click="toggleAIChat"
                            >
                              <img :style="{ width: '16px', height: '16px' }" :src="getBtnO2Logo" />
                              <span class="tw-font-[400] tw-pl-[4px] tw-text-[12px] tw-pr-[6px] tw-py-[4px] tw-text-[#7980cc]">
                                Generate VRL
                              </span>
                            </q-btn>
                          </div>
                          <div class="tw-h-full tw-flex tw-justify-center tw-items-center o2-select-input tw-w-full col" style="padding-top: 0;">
                            <q-select
                              v-model="selectedFunction"
                              :options="functionOptions"
                              data-test="alert-saved-vrl-function-select"
                              input-debounce="0"
                              behavior="menu"
                              use-input
                              borderless
                              dense
                              hide-selected
                              menu-anchor="bottom left"
                              fill-input
                              option-label="name"
                              option-value="name"
                              @filter="filterFunctionOptions"
                              @update:modelValue="onFunctionSelect"
                              class="mini-select"
                              clearable
                              @clear="onFunctionClear"
                              style="width: 150px;"
                              :placeholder="t('alerts.placeholders.savedFunctions')"
                            >
                              <template #no-option>
                                <q-item>
                                  <q-item-section>{{ t("search.noResult") }}</q-item-section>
                                </q-item>
                              </template>
                            </q-select>
                          </div>
                          <div>
                            <q-btn
                              data-test="alert-apply-vrl-btn"
                              size="sm"
                              class="text-bold add-variable no-border q-py-sm"
                              color="primary"
                              no-caps
                              @click="runTestFunction"
                              :disable="vrlFunctionContent == ''"
                              style="height: 32px;"
                            >
                              <q-icon name="search" size="18px" />
                              <span class="tw-text-[12px] tw-font-[400]">Apply VRL</span>
                            </q-btn>
                          </div>
                        </div>
                      </div>
                      <FullViewContainer
                        name="Input"
                        label="Input"
                        :isExpanded="true"
                        :showExpandIcon="false"
                        :label-class="'tw-ml-2'"
                        class="tw-mt-1"
                      ></FullViewContainer>
                      <QueryEditor
                        data-test="scheduled-alert-vrl-function-editor"
                        ref="fnEditorRef"
                        editor-id="fnEditor-dialog"
                        class="tw-w-full tw-h-[calc(100%-80px)]"
                        :debounceTime="300"
                        v-model:query="vrlFunctionContent"
                        :class="[
                          vrlFunctionContent == '' && functionEditorPlaceholderFlag ? 'empty-function' : '',
                          store.state.theme === 'dark' ? 'dark-mode-editor dark-mode' : 'light-mode-editor light-mode'
                        ]"
                        @update:query="updateVrlFunction"
                        @focus="functionEditorPlaceholderFlag = false"
                        @blur="onBlurFunctionEditor"
                        style="min-height: 15rem;"
                      />
                    </div>
                  </div>
                </div>
                <q-separator vertical class="q-ml-sm" />
              </div>

              <!-- Right Section (40%) - Output -->
              <div
                class="tw-flex tw-flex-col tw-h-full tw-p-2 tw-gap-y-2 tw-overflow-y-hidden"
                :class="store.state.theme === 'dark' ? 'tw-bg-[#374151]' : 'tw-bg-[#F4F4F5]'"
              >
                <!-- SQL/PromQL Output -->
                <div
                  class="tw-w-full"
                  :class="expandCombinedOutput ?
                    expandSqlOutput && localTab == 'sql' ? 'tw-flex-1 tw-h-[calc(50%-24px)]' : localTab != 'sql' ? 'tw-flex-1 tw-h-[calc(100%-24px)]' : 'tw-h-[24px]' :
                    expandSqlOutput ? 'tw-flex-1 tw-h-[calc(100%-24px)]' : 'tw-h-[24px]'"
                >
                  <div class="tw-flex tw-items-center tw-justify-between tw-w-[100%] tw-gap-2">
                    <FullViewContainer
                      name="Output"
                      label="Output"
                      class="tw-w-full"
                      :isExpanded="expandSqlOutput"
                      @update:isExpanded="expandSqlOutput = $event"
                    >
                      <template #right>
                        <div
                          class="tw-flex tw-items-center tw-justify-center tw-text-[12px] tw-font-semibold tw-mr-2"
                          :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-[#6B7280]'"
                        >
                          Results include all multi-window additions
                        </div>
                      </template>
                    </FullViewContainer>
                  </div>
                  <div v-if="expandSqlOutput" class="tw-h-[calc(100%-0px)] tw-overflow-y-hidden">
                    <!-- No output before run query -->
                    <div v-if="!tempRunQuery && outputEvents == ''" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] tw-w-full no-output-before-run-query">
                      <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                        <q-icon
                          :name="outlinedLightbulb"
                          size="40px"
                          :class="store.state.theme === 'dark' ? 'tw-text-[#FB923C]' : 'tw-text-[#FB923C]'"
                        />
                        <div>
                          <span>Please click Run Query to see the output</span>
                        </div>
                      </div>
                    </div>
                    <div v-else-if="(outputEvents == '') && !runQueryLoading" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] no-output-before-run-query">
                      <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                        <q-icon
                          :name="outlinedWarning"
                          size="40px"
                          class="tw-text-orange-400"
                        />
                        <div>
                          <span>{{ runPromqlError ? runPromqlError : "No results found" }}</span>
                        </div>
                      </div>
                    </div>
                    <div v-else-if="runQueryLoading" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)]">
                      <q-spinner-hourglass color="primary" size="40px" />
                      <div class="tw-text-sm tw-text-gray-500">
                        Fetching Search Results...
                      </div>
                    </div>
                    <QueryEditor
                      v-else-if="expandSqlOutput"
                      class="tw-w-full tw-h-[calc(100%-24px)] tw-overflow-y-auto"
                      data-test="sql-output-editor"
                      ref="outputEventsEditorRef"
                      editor-id="sql-output-editor"
                      language="json"
                      :read-only="true"
                      v-model:query="outputEvents"
                      style="min-height: 10rem; overflow-y: auto;"
                    />
                  </div>
                </div>

                <!-- Combined Output (SQL + VRL) -->
                <div
                  v-if="localTab !== 'promql'"
                  class="tw-w-full"
                  :class="expandSqlOutput ?
                    expandCombinedOutput ? 'tw-flex-1 tw-h-[calc(50%-24px)]' : 'tw-flex-1 tw-h-[calc(100%-24px)]'
                    : expandCombinedOutput ? 'tw-flex-1 tw-h-[24px]' : 'tw-flex-1 tw-h-[calc(100%-24px)]'"
                >
                  <div class="tw-flex tw-flex-col tw-items-start tw-justify-between tw-h-fit">
                    <FullViewContainer
                      name="Combined Output"
                      label="Combined Output"
                      :isExpanded="expandCombinedOutput"
                      class="tw-w-full"
                      @update:isExpanded="expandCombinedOutput = $event"
                    >
                      <template #right>
                        <div
                          class="tw-flex tw-items-center tw-justify-center tw-text-[12px] tw-font-semibold tw-mr-2"
                          :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-[#6B7280]'"
                        >
                          SQL + VRL
                        </div>
                      </template>
                    </FullViewContainer>
                  </div>
                  <div v-if="expandCombinedOutput && localTab !== 'promql'" class="tw-h-full">
                    <div v-if="!tempTestFunction && !runFnQueryLoading" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] tw-w-full no-output-before-run-query">
                      <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                        <q-icon
                          :name="outlinedLightbulb"
                          size="40px"
                          :class="store.state.theme === 'dark' ? 'tw-text-[#FB923C]' : 'tw-text-[#FB923C]'"
                        />
                        <div>
                          <span>Please click Apply VRL to see the combined output</span>
                        </div>
                      </div>
                    </div>
                    <div v-else-if="(outputFnEvents == '') && !runFnQueryLoading && tempTestFunction" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)] no-output-before-run-query">
                      <div class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-gap-2">
                        <q-icon
                          :name="outlinedWarning"
                          size="40px"
                          class="tw-text-orange-400"
                        />
                        <div>
                          <span>No results found</span>
                        </div>
                      </div>
                    </div>
                    <div v-else-if="runFnQueryLoading" class="tw-flex tw-flex-col tw-justify-center tw-items-center tw-h-[calc(100%-24px)]">
                      <q-spinner-hourglass color="primary" size="40px" />
                      <div class="tw-text-sm tw-text-gray-500">
                        Fetching Search Results...
                      </div>
                    </div>
                    <QueryEditor
                      v-else
                      class="tw-w-full tw-h-[calc(100%-24px)]"
                      data-test="vrl-function-test-events-output-editor"
                      ref="outputFnEventsEditorRef"
                      editor-id="test-function-events-output-editor"
                      language="json"
                      :read-only="true"
                      v-model:query="outputFnEvents"
                      style="min-height: 10rem;"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- AI Chat Panel -->
        <div
          class="q-ml-sm"
          v-if="store.state.isAiChatEnabled"
          style="width: 24.5vw; max-width: 100%; min-width: 75px;"
          :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'"
        >
          <O2AIChat
            :header-height="48"
            :is-open="store.state.isAiChatEnabled"
            @close="store.state.isAiChatEnabled = false"
            style="height: calc(100vh - 0px) !important;"
          />
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { outlinedLightbulb, outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { getImageURL, b64EncodeUnicode, b64DecodeUnicode } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import config from "@/aws-exports";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue")
);

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    AppTabs,
    FilterGroup,
    FullViewContainer,
    QueryEditor,
    O2AIChat,
  },
  props: {
    tab: {
      type: String,
      default: "custom",
    },
    disableQueryTypeSelection: {
      type: Boolean,
      default: false,
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    streamFieldsMap: {
      type: Object as PropType<any>,
      default: () => ({}),
    },
    generatedSqlQuery: {
      type: String,
      default: "",
    },
    inputData: {
      type: Object as PropType<any>,
      required: true,
    },
    streamType: {
      type: String,
      default: "",
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    sqlQuery: {
      type: String,
      default: "",
    },
    promqlQuery: {
      type: String,
      default: "",
    },
    vrlFunction: {
      type: String,
      default: "",
    },
    streamName: {
      type: String,
      default: "",
    },
  },
  emits: ["update:tab", "update-group", "remove-group", "input:update", "update:sqlQuery", "update:promqlQuery", "update:vrlFunction"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localTab = ref(props.tab);
    const viewSqlEditor = ref(false);
    const isFullScreen = ref(false);
    const isHovered = ref(false);

    // Editor refs
    const queryEditorRef = ref<any>(null);
    const fnEditorRef = ref<any>(null);
    const outputEventsEditorRef = ref<any>(null);
    const outputFnEventsEditorRef = ref<any>(null);

    // Local query values
    const localSqlQuery = ref(props.sqlQuery);
    const localPromqlQuery = ref(props.promqlQuery);
    const vrlFunctionContent = ref(props.vrlFunction);

    // Editor states
    const queryEditorPlaceholderFlag = ref(true);
    const functionEditorPlaceholderFlag = ref(true);
    const sqlQueryErrorMsg = ref("");

    // Output states
    const expandSqlOutput = ref(true);
    const expandCombinedOutput = ref(true);
    const outputEvents = ref("");
    const outputFnEvents = ref("");
    const tempRunQuery = ref(false);
    const tempTestFunction = ref(false);
    const runQueryLoading = ref(false);
    const runFnQueryLoading = ref(false);
    const runPromqlError = ref("");

    // Field and function selection
    const selectedColumn = ref<any>({ label: "", value: "" });
    const selectedFunction = ref<any>(null);
    const filteredFields = ref(props.columns);
    const functionOptions = ref<any[]>([]);

    // Compute tab options based on stream type and alert type
    const tabOptions = computed(() => {
      // For real-time alerts, only show Custom (no tabs needed)
      if (props.isRealTime === "true") {
        return [
          {
            label: "Custom",
            value: "custom",
          },
        ];
      }

      // For metrics, show all three tabs: Custom, SQL, PromQL
      if (props.streamType === "metrics") {
        return [
          {
            label: "Custom",
            value: "custom",
          },
          {
            label: "SQL",
            value: "sql",
          },
          {
            label: "PromQL",
            value: "promql",
          },
        ];
      }

      // For logs and traces, show only Custom and SQL
      return [
        {
          label: "Custom",
          value: "custom",
        },
        {
          label: "SQL",
          value: "sql",
        },
      ];
    });

    // Hide tabs completely for real-time alerts (only one option)
    const shouldShowTabs = computed(() => {
      return props.isRealTime === "false" && !props.disableQueryTypeSelection;
    });

    const updateTab = (tab: string) => {
      localTab.value = tab;
      emit("update:tab", tab);
    };

    const updateGroup = (data: any) => {
      emit("update-group", data);
    };

    const removeConditionGroup = (data: any) => {
      emit("remove-group", data);
    };

    const onInputUpdate = (name: string, field: any) => {
      emit("input:update", name, field);
    };

    const sqlOrPromqlQuery = computed(() => {
      return localTab.value === 'sql' ? props.sqlQuery : props.promqlQuery;
    });

    const updateSqlQuery = (value: string) => {
      localSqlQuery.value = value;
      emit("update:sqlQuery", value);
    };

    const updatePromqlQuery = (value: string) => {
      localPromqlQuery.value = value;
      emit("update:promqlQuery", value);
    };

    const updateVrlFunction = (value: string) => {
      vrlFunctionContent.value = value;
      // Encode VRL function before emitting
      const encoded = b64EncodeUnicode(value);
      emit("update:vrlFunction", encoded);
    };

    const onBlurQueryEditor = () => {
      queryEditorPlaceholderFlag.value = localTab.value === 'sql' ? localSqlQuery.value === '' : localPromqlQuery.value === '';
    };

    const onBlurFunctionEditor = () => {
      functionEditorPlaceholderFlag.value = vrlFunctionContent.value === '';
    };

    const toggleAIChat = () => {
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
    };

    const getBtnO2Logo = computed(() => {
      return getImageURL('images/common/ai_icon_blue.svg');
    });

    const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL('images/common/ai_icon_dark.svg');
      }
      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg');
    });

    const filterFields = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredFields.value = props.columns;
        } else {
          const needle = val.toLowerCase();
          filteredFields.value = props.columns.filter((v: any) => {
            return v.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    const onColumnSelect = (value: any) => {
      if (queryEditorRef.value) {
        queryEditorRef.value.insertTextAtCursor(value);
      }
      selectedColumn.value = { label: "", value: "" };
    };

    const filterFunctionOptions = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          functionOptions.value = [];
        } else {
          const needle = val.toLowerCase();
          functionOptions.value = [].filter((v: any) => {
            return v.name.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    const onFunctionSelect = (value: any) => {
      if (value && value.function) {
        try {
          vrlFunctionContent.value = b64DecodeUnicode(value.function);
          updateVrlFunction(vrlFunctionContent.value);
        } catch (e) {
          vrlFunctionContent.value = value.function;
          updateVrlFunction(vrlFunctionContent.value);
        }
      }
    };

    const onFunctionClear = () => {
      selectedFunction.value = null;
    };

    const runSqlQuery = async () => {
      runPromqlError.value = "";
      tempRunQuery.value = true;
      expandSqlOutput.value = true;
      runQueryLoading.value = true;

      // Simulate query execution
      setTimeout(() => {
        outputEvents.value = JSON.stringify({ message: "SQL query executed successfully" }, null, 2);
        runQueryLoading.value = false;
      }, 1000);
    };

    const runPromqlQuery = async () => {
      runPromqlError.value = "";
      tempRunQuery.value = true;
      expandSqlOutput.value = true;
      runQueryLoading.value = true;

      // Simulate query execution
      setTimeout(() => {
        outputEvents.value = JSON.stringify({ message: "PromQL query executed successfully" }, null, 2);
        runQueryLoading.value = false;
      }, 1000);
    };

    const runTestFunction = async () => {
      runPromqlError.value = "";
      tempTestFunction.value = true;
      expandCombinedOutput.value = true;
      runFnQueryLoading.value = true;

      // Simulate VRL execution
      setTimeout(() => {
        outputFnEvents.value = JSON.stringify({ message: "VRL function applied successfully" }, null, 2);
        runFnQueryLoading.value = false;
      }, 1000);
    };

    return {
      t,
      store,
      config,
      localTab,
      tabOptions,
      shouldShowTabs,
      updateTab,
      updateGroup,
      removeConditionGroup,
      onInputUpdate,
      sqlOrPromqlQuery,
      viewSqlEditor,
      isFullScreen,
      isHovered,
      queryEditorRef,
      fnEditorRef,
      outputEventsEditorRef,
      outputFnEventsEditorRef,
      localSqlQuery,
      localPromqlQuery,
      vrlFunctionContent,
      updateSqlQuery,
      updatePromqlQuery,
      updateVrlFunction,
      queryEditorPlaceholderFlag,
      functionEditorPlaceholderFlag,
      sqlQueryErrorMsg,
      onBlurQueryEditor,
      onBlurFunctionEditor,
      expandSqlOutput,
      expandCombinedOutput,
      outputEvents,
      outputFnEvents,
      tempRunQuery,
      tempTestFunction,
      runQueryLoading,
      runFnQueryLoading,
      runPromqlError,
      selectedColumn,
      selectedFunction,
      filteredFields,
      functionOptions,
      filterFields,
      onColumnSelect,
      filterFunctionOptions,
      onFunctionSelect,
      onFunctionClear,
      toggleAIChat,
      getBtnO2Logo,
      getBtnLogo,
      runSqlQuery,
      runPromqlQuery,
      runTestFunction,
      outlinedLightbulb,
      outlinedWarning,
    };
  },
});
</script>

<style scoped lang="scss">
.step-query-config {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  overflow: auto;

  .step-content {
    border-radius: 8px;
    min-height: 100%;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.preview-box {
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .preview-header {
    border-bottom: 1px solid;
    flex-shrink: 0;
  }

  .preview-title {
    font-weight: 600;
    font-size: 14px;
  }

  .preview-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .preview-code {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 12px;
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  &.dark-mode-preview {
    background-color: #181a1b;
    border: 1px solid #343434;

    .preview-header {
      background-color: #212121;
      border-bottom-color: #343434;
    }

    .preview-title {
      color: #ffffff;
    }

    .preview-code {
      color: #e0e0e0;
    }
  }

  &.light-mode-preview {
    background-color: #f5f5f5;
    border: 1px solid #e6e6e6;

    .preview-header {
      background-color: #ffffff;
      border-bottom-color: #e6e6e6;
    }

    .preview-title {
      color: #3d3d3d;
    }

    .preview-code {
      color: #3d3d3d;
    }
  }
}

.editor-dialog-card {
  background-color: var(--q-dark-page);
}

.editor-text-title {
  font-weight: 600;
  font-size: 16px;
}

.no-output-before-run-query {
  border-radius: 8px;
}

.dark-mode {
  .no-output-before-run-query {
    background-color: #1a1a1a;
  }
}

.light-mode {
  .no-output-before-run-query {
    background-color: #f9fafb;
  }
}

.ai-hover-btn {
  &:hover {
    background-color: rgba(121, 128, 204, 0.1);
  }

  &.ai-btn-active {
    background-color: rgba(121, 128, 204, 0.2);
  }
}

.dark-mode-chat-container {
  background-color: #1f2937;
  border-left: 1px solid #374151;
}

.light-mode-chat-container {
  background-color: #ffffff;
  border-left: 1px solid #e5e7eb;
}
</style>
