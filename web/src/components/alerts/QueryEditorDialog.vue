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
  <!-- Editor Dialog -->
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    maximized
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="tw:flex tw:h-full editor-dialog-card tw:pl-1">
      <div
        class="tw:h-full tw:flex tw:pr-1"
        :style="{
          width: isFullScreen ? '100vw' : store.state.isAiChatEnabled ? '65vw' : '90vw'
        }"
      >
        <div class="tw:h-full tw:w-full tw:px-2 tw:py-2">
          <!-- Header -->
          <div class="tw:h-8 tw:flex tw:items-center tw:justify-between" style="font-size: 20px;">
            <div class="tw:flex tw:items-center tw:gap-2">
              <div
                data-test="add-alert-back-btn"
                class="flex justify-center items-center cursor-pointer"
                style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px;"
                title="Go Back"
                @click="closeDialog"
              >
                <q-icon name="arrow_back_ios_new" size="14px" />
              </div>
              <span class="tw:text-[18px] tw:font-[400]">Add Conditions</span>
            </div>
            <div class="tw:flex tw:items-center">
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
                <div class="row items-center no-wrap tw:gap-2">
                  <img :src="getBtnLogo" class="header-icon ai-icon" />
                </div>
              </q-btn>
              <q-btn
                icon="fullscreen"
                size="16px"
                dense
                class="tw:cursor-pointer"
                :class="store.state.theme === 'dark' ? 'tw:text-white' : ''"
                :color="isFullScreen ? 'primary' : undefined"
                @click="() => isFullScreen = !isFullScreen"
              />
            </div>
          </div>
          <q-separator class="tw:my-2"/>

          <!-- Main Content Grid -->
          <div class="tw:grid tw:h-[calc(100vh-100px)] tw:w-full tw:grid-cols-[60%_40%] tw:gap-x-2">
            <!-- Left Section (60%) -->
            <div class="tw:flex tw:w-full">
              <div class="tw:flex tw:w-full tw:flex-col tw:h-full tw:gap-y-2">
                <!-- SQL/PromQL Editor Section (60% of left) -->
                <div class="tw:flex-[3] tw:w-full">
                  <div class="tw:w-full tw:h-full" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
                    <div class="tw:flex tw:items-center tw:justify-between tw:pb-2 tw:pt-1">
                      <span class="editor-text-title">{{ localTab === 'sql' ? 'SQL Editor' : 'PromQL Editor' }}</span>
                      <div class="tw:flex tw:gap-2 tw:items-center tw:h-6">
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
                            <span class="tw:font-[400] tw:pl-[4px] tw:text-[12px] tw:pr-[6px] tw:py-[4px] tw:text-[#7980cc]">
                              {{ localTab == 'sql' ? 'Generate SQL' : 'Generate PromQL' }}
                            </span>
                          </q-btn>
                        </div>
                        <div class="tw:h-full tw:flex tw:justify-center tw:items-center o2-select-input tw:w-full col" style="padding-top: 0">
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
                            <span class="tw:text-[12px] tw:font-[400]">Run Query</span>
                          </q-btn>
                        </div>
                      </div>
                    </div>
                    <FullViewContainer
                      name="Input"
                      label="Input"
                      :isExpanded="true"
                      :showExpandIcon="false"
                      :label-class="'tw:ml-2'"
                      class="tw:mt-1"
                    >
                      <template #right>
                        <div v-if="streamName" class="tw:text-[12px] tw:font-semibold tw:mr-2">
                          on <span class="tw:text-[14px] tw:font-bold">{{ streamName }}</span> stream
                        </div>
                        <div v-else class="tw:text-[12px] tw:font-semibold tw:mr-2">
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
                      class="tw:w-full"
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
                      v-show="!!(sqlQueryErrorMsg || localSqlQueryErrorMsg) && localTab === 'sql'"
                      class="text-negative q-py-sm invalid-sql-error"
                    >
                      <span v-show="!!(sqlQueryErrorMsg || localSqlQueryErrorMsg)">Error: {{ localSqlQueryErrorMsg || sqlQueryErrorMsg }}</span>
                    </div>

                    <!-- PromQL Editor -->
                    <QueryEditor
                      v-if="localTab === 'promql'"
                      data-test="scheduled-alert-promql-editor"
                      ref="queryEditorRef"
                      editor-id="alerts-query-editor-dialog"
                      class="tw:w-full"
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
                <div v-if="localTab !== 'promql'" class="tw:flex-[2] tw:w-full">
                  <div class="tw:w-full tw:h-full" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
                    <div class="tw:flex tw:items-center tw:justify-between tw:pb-1 tw:pt-1">
                      <span class="editor-text-title">VRL Editor</span>
                      <div class="tw:flex tw:gap-2 tw:items-center">
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
                            <span class="tw:font-[400] tw:pl-[4px] tw:text-[12px] tw:pr-[6px] tw:py-[4px] tw:text-[#7980cc]">
                              Generate VRL
                            </span>
                          </q-btn>
                        </div>
                        <div class="tw:h-full tw:flex tw:justify-center tw:items-center o2-select-input tw:w-full col" style="padding-top: 0;">
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
                            <span class="tw:text-[12px] tw:font-[400]">Apply VRL</span>
                          </q-btn>
                        </div>
                      </div>
                    </div>
                    <FullViewContainer
                      name="Input"
                      label="Input"
                      :isExpanded="true"
                      :showExpandIcon="false"
                      :label-class="'tw:ml-2'"
                      class="tw:mt-1"
                    ></FullViewContainer>
                    <QueryEditor
                      data-test="scheduled-alert-vrl-function-editor"
                      ref="fnEditorRef"
                      editor-id="fnEditor-dialog"
                      class="tw:w-full tw:h-[calc(100%-80px)]"
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
              class="tw:flex tw:flex-col tw:h-full tw:p-2 tw:gap-y-2 tw:overflow-y-hidden tw:transition-none"
              :class="store.state.theme === 'dark' ? 'tw:bg-[#374151]' : 'tw:bg-[#F4F4F5]'"
            >
              <!-- SQL/PromQL Output -->
              <div
                class="tw:w-full tw:transition-none"
                :class="expandCombinedOutput ?
                  expandSqlOutput && localTab == 'sql' ? 'tw:flex-1 tw:h-[calc(50%-24px)]' : localTab != 'sql' ? 'tw:flex-1 tw:h-[calc(100%-24px)]' : 'tw:h-[24px]' :
                  expandSqlOutput ? 'tw:flex-1 tw:h-[calc(100%-24px)]' : 'tw:h-[24px]'"
              >
                <div class="tw:flex tw:items-center tw:justify-between tw:w-[100%] tw:gap-2">
                  <FullViewContainer
                    name="Output"
                    label="Output"
                    class="tw:w-full"
                    :isExpanded="expandSqlOutput"
                    @update:isExpanded="expandSqlOutput = $event"
                  >
                    <template #right>
                      <div
                        class="tw:flex tw:items-center tw:justify-center tw:text-[12px] tw:font-semibold tw:mr-2"
                        :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-[#6B7280]'"
                      >
                        Results include all multi-window additions
                      </div>
                    </template>
                  </FullViewContainer>
                </div>
                <div v-if="expandSqlOutput" class="tw:h-[calc(100%-0px)] tw:overflow-y-hidden">
                  <!-- No output before run query -->
                  <div v-if="!tempRunQuery && outputEvents == ''" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)] tw:w-full no-output-before-run-query">
                    <div class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:gap-2">
                      <q-icon
                        :name="outlinedLightbulb"
                        size="40px"
                        :class="store.state.theme === 'dark' ? 'tw:text-[#FB923C]' : 'tw:text-[#FB923C]'"
                      />
                      <div>
                        <span>Please click Run Query to see the output</span>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="(outputEvents == '') && !runQueryLoading" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)] no-output-before-run-query">
                    <div class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:gap-2">
                      <q-icon
                        :name="outlinedWarning"
                        size="40px"
                        class="tw:text-orange-400"
                      />
                      <div>
                        <span>{{ runPromqlError ? runPromqlError : "No results found" }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="runQueryLoading" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)]">
                    <q-spinner-hourglass color="primary" size="40px" />
                    <div class="tw:text-sm tw:text-gray-500">
                      Fetching Search Results...
                    </div>
                  </div>
                  <QueryEditor
                    v-else-if="expandSqlOutput"
                    class="tw:w-full tw:h-[calc(100%-24px)] tw:overflow-y-auto"
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
                class="tw:w-full tw:transition-none"
                :class="expandSqlOutput ?
                  expandCombinedOutput ? 'tw:flex-1 tw:h-[calc(50%-24px)]' : 'tw:flex-1 tw:h-[calc(100%-24px)]'
                  : expandCombinedOutput ? 'tw:flex-1 tw:h-[24px]' : 'tw:flex-1 tw:h-[calc(100%-24px)]'"
              >
                <div class="tw:flex tw:flex-col tw:items-start tw:justify-between tw:h-fit">
                  <FullViewContainer
                    name="Combined Output"
                    label="Combined Output"
                    :isExpanded="expandCombinedOutput"
                    class="tw:w-full"
                    @update:isExpanded="expandCombinedOutput = $event"
                  >
                    <template #right>
                      <div
                        class="tw:flex tw:items-center tw:justify-center tw:text-[12px] tw:font-semibold tw:mr-2"
                        :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-[#6B7280]'"
                      >
                        SQL + VRL
                      </div>
                    </template>
                  </FullViewContainer>
                </div>
                <div v-if="expandCombinedOutput && localTab !== 'promql'" class="tw:h-full">
                  <div v-if="!tempTestFunction && !runFnQueryLoading" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)] tw:w-full no-output-before-run-query">
                    <div class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:gap-2">
                      <q-icon
                        :name="outlinedLightbulb"
                        size="40px"
                        :class="store.state.theme === 'dark' ? 'tw:text-[#FB923C]' : 'tw:text-[#FB923C]'"
                      />
                      <div>
                        <span>Please click Apply VRL to see the combined output</span>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="(outputFnEvents == '') && !runFnQueryLoading && tempTestFunction" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)] no-output-before-run-query">
                    <div class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:gap-2">
                      <q-icon
                        :name="outlinedWarning"
                        size="40px"
                        class="tw:text-orange-400"
                      />
                      <div>
                        <span>No results found</span>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="runFnQueryLoading" class="tw:flex tw:flex-col tw:justify-center tw:items-center tw:h-[calc(100%-24px)]">
                    <q-spinner-hourglass color="primary" size="40px" />
                    <div class="tw:text-sm tw:text-gray-500">
                      Fetching Search Results...
                    </div>
                  </div>
                  <QueryEditor
                    v-else
                    class="tw:w-full tw:h-[calc(100%-24px)]"
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
</template>

<script setup lang="ts">
import { ref, computed, watch, type PropType, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { debounce } from "lodash-es";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { getImageURL } from "@/utils/zincutils";
import { outlinedLightbulb, outlinedWarning } from "@quasar/extras/material-icons-outlined";
import searchService from "@/services/search";
import QueryEditor from "@/components/CodeQueryEditor.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import config from "@/aws-exports";
import useQuery from "@/composables/useQuery";
import { getParser as getParserUtil, type SqlUtilsContext } from "@/utils/alerts/alertSqlUtils";
import useParser from "@/composables/useParser";

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  tab: {
    type: String,
    default: "sql",
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
  streamType: {
    type: String,
    default: "logs",
  },
  columns: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  period: {
    type: Number,
    default: 10,
  },
  multiTimeRange: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  savedFunctions: {
    type: Array as PropType<any[]>,
    default: () => [],
  },
  sqlQueryErrorMsg: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "update:modelValue",
  "update:sqlQuery",
  "update:promqlQuery",
  "update:vrlFunction",
  "validate-sql",
]);

const { t } = useI18n();
const store = useStore();
const q = useQuasar();
const { buildQueryPayload } = useQuery();
const { sqlParser } = useParser();

// SQL Parser for validation
const parser: any = ref({});
const localSqlQueryErrorMsg = ref("");

// Initialize SQL parser on mount
onMounted(async () => {
  parser.value = await sqlParser();
});

// Get parser function to validate SQL queries (checks for SELECT * and reserved words)
const getParser = (sqlQuery: string) => {
  const sqlUtilsContext: SqlUtilsContext = {
    parser: parser.value,
    sqlQueryErrorMsg: localSqlQueryErrorMsg,
  };
  return getParserUtil(sqlQuery, sqlUtilsContext);
};

// Dialog state
const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const closeDialog = () => {
  isOpen.value = false;
};

// Local state
// Default to SQL tab if no tab is provided, otherwise use the provided tab
const localTab = ref(props.tab || 'sql');
const localSqlQuery = ref(props.sqlQuery);
const localPromqlQuery = ref(props.promqlQuery);
const vrlFunctionContent = ref(props.vrlFunction);
const isFullScreen = ref(false);
const isHovered = ref(false);

// Editor state
const queryEditorPlaceholderFlag = ref(false);
const functionEditorPlaceholderFlag = ref(false);

// Field selection
const selectedColumn = ref<any>({ label: "", value: "" });
const filteredFields = ref(props.columns);
const selectedFunction = ref<any>(null);
const functionOptions = ref<any[]>(props.savedFunctions);

// Output state
const outputEvents = ref("");
const outputFnEvents = ref("");
// Expand output sections by default so users can see query results immediately
const expandSqlOutput = ref(true);
const expandCombinedOutput = ref(true);
const runQueryLoading = ref(false);
const runFnQueryLoading = ref(false);
const tempRunQuery = ref(false);
const tempTestFunction = ref(false);
const runPromqlError = ref("");

// Watch props
watch(() => props.tab, (newVal) => {
  localTab.value = newVal || 'sql';
});

watch(() => props.sqlQuery, (newVal) => {
  localSqlQuery.value = newVal;
});

watch(() => props.promqlQuery, (newVal) => {
  localPromqlQuery.value = newVal;
});

// Clear local error message when SQL query changes
watch(() => localSqlQuery.value, () => {
  localSqlQueryErrorMsg.value = "";
});

watch(() => props.vrlFunction, (newVal) => {
  vrlFunctionContent.value = newVal;
});

watch(() => props.columns, (newVal) => {
  filteredFields.value = [...newVal];
});

watch(() => props.savedFunctions, (newVal) => {
  functionOptions.value = [...newVal];
});

// Filter functions
const filterFields = (val: string, update: any) => {
  update(() => {
    if (val === "") {
      filteredFields.value = [...props.columns];
    } else {
      const needle = val.toLowerCase();
      filteredFields.value = props.columns.filter((v: any) =>
        v.label.toLowerCase().indexOf(needle) > -1
      );
    }
  });
};

const filterFunctionOptions = (val: string, update: any) => {
  update(() => {
    if (val === "") {
      functionOptions.value = [...props.savedFunctions];
    } else {
      const needle = val.toLowerCase();
      functionOptions.value = props.savedFunctions.filter((v: any) =>
        v.name.toLowerCase().indexOf(needle) > -1
      );
    }
  });
};

// Update handlers
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
  const encoded = b64EncodeUnicode(value);
  emit("update:vrlFunction", encoded);
};

const onBlurQueryEditor = debounce(() => {
  queryEditorPlaceholderFlag.value = localTab.value === 'sql' ? localSqlQuery.value === '' : localPromqlQuery.value === '';
  // Only validate SQL queries on blur, not PromQL
  if (localTab.value === 'sql') {
    emit("validate-sql");
  }
}, 10);

const onBlurFunctionEditor = () => {
  functionEditorPlaceholderFlag.value = vrlFunctionContent.value === '';
};

// Column and function selection
const onColumnSelect = (column: any) => {
  if (localTab.value === 'sql') {
    localSqlQuery.value += ` ${column.value}`;
    updateSqlQuery(localSqlQuery.value);
  } else {
    localPromqlQuery.value += ` ${column.value}`;
    updatePromqlQuery(localPromqlQuery.value);
  }
  selectedColumn.value = { label: "", value: "" };
};

const onFunctionSelect = (func: any) => {
  if (func && func.function) {
    vrlFunctionContent.value = func.function;
    updateVrlFunction(func.function);
  }
};

const onFunctionClear = () => {
  vrlFunctionContent.value = "";
  updateVrlFunction("");
  selectedFunction.value = null;
};

// Build multi-window query - includes all multi-windows automatically
const buildMultiWindowQuery = (sql: string, fn: boolean, periodInMicroseconds: number) => {
  const queryToSend: any[] = [];
  const regex = /^(\d+)([smhdwM])$/;

  const unitToMicroseconds: Record<string, number> = {
    s: 1 * 1_000_000,           // seconds
    m: 60 * 1_000_000,          // minutes
    h: 60 * 60 * 1_000_000,     // hours
    d: 24 * 60 * 60 * 1_000_000,// days
    w: 7 * 24 * 60 * 60 * 1_000_000, // weeks
    M: 30 * 24 * 60 * 60 * 1_000_000 // month
  };

  const now = Date.now() * 1000; // Current time in microseconds because we are using microseconds of unix timestamp

  // Include all multi-windows (no selection needed)
  props.multiTimeRange.forEach((date: any) => {
    const individualQuery: any = {};
    const match = date.offSet.match(regex);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const offsetMicroseconds = value * unitToMicroseconds[unit];

      const endTime = now;
      const startTime = endTime - offsetMicroseconds;
      individualQuery.start_time = startTime - periodInMicroseconds;
      individualQuery.end_time = startTime;
      individualQuery.sql = sql;
      individualQuery.query_fn = fn ? b64EncodeUnicode(vrlFunctionContent.value) : null;
      queryToSend.push(individualQuery);
    } else {
      console.warn("Invalid format:", date);
    }
  });

  return queryToSend;
};

// Query execution
const triggerQuery = async (fn = false) => {
  try {
    const queryReq = buildQueryPayload({
      sqlMode: true,
      streamName: props.streamName,
    });
    queryReq.query.sql = localSqlQuery.value;
    queryReq.query.size = 10;

    const periodInMicroseconds = props.period * 60 * 1000000;
    const endTime = new Date().getTime() * 1000; // ← Use 1000 to get microseconds
    const startTime = endTime - periodInMicroseconds;

    queryReq.query.query_fn = null;
    queryReq.query.sql_mode = true;
    queryReq.query.per_query_response = true;

    //initial query to send like with period for suppose we have 10minutes of period then we will send 10 minutes of data
    //so we will send 10 minutes of data in initial query
    //and then if any multi window offset is selected then we will call buildMultiWindowQuery function to get the query to send
    //and then we will push the query to send to the queryReq.query.sql

    let queryToSend = [
      {
        start_time: startTime,
        end_time: endTime,
        sql: queryReq.query.sql,
        query_fn: fn ? b64EncodeUnicode(vrlFunctionContent.value) : null
      }
    ];

    queryToSend.push(...buildMultiWindowQuery(queryReq.query.sql, fn, periodInMicroseconds));
    queryReq.query.sql = queryToSend;

    const res = await searchService.search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: queryReq,
      page_type: props.streamType,
      validate: true,
    });

    if (res.data.hits.length > 0) {
      if (fn) {
        outputFnEvents.value = JSON.stringify(res.data.hits, null, 2);
      } else {
        outputEvents.value = JSON.stringify(res.data.hits, null, 2);
      }
    }
  } catch (err: any) {
    q.notify({
      type: "negative",
      message: err.response?.data?.message ?? "Error while fetching results",
      timeout: 1500,
    });
  }
};

const runSqlQuery = async () => {
  runPromqlError.value = "";

  // Validate SQL query before running (checks for SELECT * and reserved words)
  if (!getParser(localSqlQuery.value)) {
    // Parser validation failed - don't run the query
    // Error message is already set by getParser via sqlQueryErrorMsg
    return;
  }

  tempRunQuery.value = true;
  expandSqlOutput.value = true;
  try {
    runQueryLoading.value = true;
    await triggerQuery();
    runQueryLoading.value = false;
  } catch (err) {
    runQueryLoading.value = false;
  }
};

const runTestFunction = async () => {
  runPromqlError.value = "";
  tempTestFunction.value = true;
  expandCombinedOutput.value = true;
  runFnQueryLoading.value = true;
  try {
    await triggerQuery(true);
    runFnQueryLoading.value = false;
  } catch (err) {
    runFnQueryLoading.value = false;
  }
};

const triggerPromqlQuery = async () => {
  const queryReq = buildQueryPayload({
    sqlMode: true,
    streamName: props.streamName,
  });

  const periodInMicroseconds = props.period * 60 * 1000000;
  const endTime = new Date().getTime() * 1000;
  const startTime = endTime - periodInMicroseconds;

  outputEvents.value = "";
  queryReq.query = localPromqlQuery.value;

  try {
    const res = await searchService.metrics_query_range({
      org_identifier: store.state.selectedOrganization.identifier,
      query: queryReq.query,
      start_time: startTime,
      end_time: endTime,
      step: '0'
    });

    if (res?.data?.data?.result.length > 0) {
      outputEvents.value = JSON.stringify(res?.data?.data?.result, null, 2);
    }
  } catch (err: any) {
    runPromqlError.value = err.response?.data?.error ?? "Something went wrong";
  }
};

const runPromqlQuery = async () => {
  runPromqlError.value = "";
  tempRunQuery.value = true;
  expandSqlOutput.value = true;
  runQueryLoading.value = true;
  try {
    await triggerPromqlQuery();
    runQueryLoading.value = false;
  } catch (err) {
    runQueryLoading.value = false;
  }
};

// AI Chat
const toggleAIChat = () => {
  const isEnabled = !store.state.isAiChatEnabled;
  store.dispatch("setIsAiChatEnabled", isEnabled);
};

const getBtnO2Logo = computed(() => {
  return getImageURL('images/common/ai_icon_blue.svg');
});

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL('images/common/ai_icon_dark.svg')
  }

  return store.state.theme === 'dark'
    ? getImageURL('images/common/ai_icon_dark.svg')
    : getImageURL('images/common/ai_icon.svg')
})
</script>

<style scoped lang="scss">
.editor-text-title {
  font-size: 14px;
  font-weight: 600;
}

.no-output-before-run-query {
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
}

.dark-mode-chat-container {
  background-color: #1f2937;
}

.light-mode-chat-container {
  background-color: #ffffff;
}

.editor-dialog-card {
  background-color: var(--o2-card-bg);
}

.invalid-sql-error {
  padding: 8px;
  border-radius: 4px;
  background-color: rgba(255, 0, 0, 0.1);
}

.ai-hover-btn {
  opacity: 1;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(121, 128, 204, 0.1);
  }
}

.ai-btn-active {
  background-color: rgba(121, 128, 204, 0.2);
}

// Force no transitions on collapsible output sections
.tw:transition-none {
  transition: none !important;
}
</style>
