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
    class="step-query-config"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content tw:px-1 tw:pt-0 tw:pb-2">
      <!-- Step intro -->
      <p class="step-intro-hint tw:mb-3">
        {{ t("alerts.stepIntro.conditions") }}
      </p>

      <!-- Query Mode Tabs (hidden for real-time alerts) -->
      <div
        v-if="shouldShowTabs"
        class="tw:mb-3 tw:flex tw:items-center tw:justify-between tw:mt-2"
      >
        <div class="flex items-center app-tabs-container tw:h-[36px] tw:w-fit">
          <AppTabs
            data-test="step2-query-tabs"
            :tabs="tabOptions"
            class="tabs-selection-container"
            :active-tab="localTab"
            @update:active-tab="updateTab"
          />
        </div>

        <!-- Right side controls (only for SQL/PromQL tabs) -->
        <div
          v-if="localTab !== 'custom'"
          class="tw:flex tw:items-center tw:gap-2"
        >
          <!-- VRL Function Toggle -->
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <span class="tw:text-xs tw:font-medium">VRL Function</span>
            <q-toggle
              v-model="showVrlEditor"
              size="30px"
              class="o2-toggle-button-xs"
              data-test="step2-vrl-toggle"
            />
          </div>
          <q-btn
            data-test="step2-view-editor-btn"
            label="Full View"
            size="sm"
            class="o2-secondary-button q-py-sm"
            @click="viewSqlEditor = true"
          />
        </div>
      </div>

      <!-- Custom Query Builder -->
      <template v-if="localTab === 'custom'">
        <q-form ref="customConditionsForm" greedy>
          <!-- Conditions Group -->
          <div
            class="section-group tw:rounded tw:mb-4"
            :class="
              store.state.theme === 'dark'
                ? 'section-group-dark'
                : 'section-group-light'
            "
          >
            <div
              class="section-group-header tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:py-2"
            >
              <span
                class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide section-group-label"
                >{{ t("alerts.alertDetails.conditions") }}</span
              >
            </div>
            <div ref="customPreviewRef" class="tw:px-3 tw:py-2">
              <FilterGroup
                :stream-fields="columns"
                :stream-fields-map="streamFieldsMap"
                :show-sql-preview="true"
                :sql-query="generatedSqlQuery"
                :group="inputData.conditions"
                :depth="0"
                module="alerts"
                @add-condition="updateGroup"
                @add-group="updateGroup"
                @remove-group="removeConditionGroup"
                @input:update="onInputUpdate"
              />
            </div>
          </div>

          <!-- Aggregation Section (only for custom mode and scheduled alerts) -->
          <div
            v-if="isRealTime === 'false'"
            class="section-group tw:rounded"
            :class="
              store.state.theme === 'dark'
                ? 'section-group-dark'
                : 'section-group-light'
            "
          >
            <!-- Aggregation Header -->
            <div
              class="section-group-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2"
            >
              <div class="tw:flex tw:items-center tw:gap-1.5">
                <span
                  class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide section-group-label"
                  >{{ t("common.aggregation") }}</span
                >
                <q-icon
                  name="info"
                  size="13px"
                  class="cursor-pointer"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-6'
                  "
                >
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                  >
                    <span style="font-size: 14px">
                      Enable to summarize data using functions like count, sum,
                      avg, etc. before triggering the alert.<br />
                      Example: Alert when average response time exceeds 500ms
                      instead of individual events.
                    </span>
                  </q-tooltip>
                </q-icon>
              </div>
              <q-toggle
                v-model="localIsAggregationEnabled"
                size="30px"
                class="o2-toggle-button-xs"
                @update:model-value="toggleAggregation"
              />
            </div>

            <!-- Aggregation Fields (visible when enabled) -->
            <div
              v-if="localIsAggregationEnabled && inputData.aggregation"
              class="tw:px-3 tw:py-3 tw:flex tw:flex-col tw:gap-3"
            >
              <!-- Group By Fields -->
              <div class="flex items-start no-wrap q-mr-sm">
                <div
                  class="flex items-center tw:font-semibold"
                  style="width: 190px; height: 36px"
                >
                  {{ t("alerts.groupBy") }}
                  <q-icon
                    name="info"
                    size="17px"
                    class="q-ml-xs cursor-pointer"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    <q-tooltip
                      anchor="center right"
                      self="center left"
                      max-width="300px"
                    >
                      <span style="font-size: 14px">
                        {{ t("alerts.groupByHelp.description") }}<br />
                        {{ t("alerts.groupByHelp.example") }}
                      </span>
                    </q-tooltip>
                  </q-icon>
                </div>
                <div
                  class="flex justify-start items-center flex-wrap"
                  style="width: calc(100% - 190px)"
                >
                  <template
                    v-for="(group, index) in inputData.aggregation.group_by"
                    :key="index"
                  >
                    <div class="flex justify-start items-center no-wrap">
                      <div>
                        <q-select
                          v-model="inputData.aggregation.group_by[index]"
                          :options="filteredFields"
                          class="no-case q-py-none q-mb-sm"
                          borderless
                          dense
                          use-input
                          emit-value
                          hide-selected
                          :placeholder="t('alerts.placeholders.selectColumn')"
                          fill-input
                          :input-debounce="400"
                          hide-bottom-space
                          @filter="
                            (val: string, update: any) =>
                              filterFields(val, update)
                          "
                          :rules="[(val: any) => !!val || 'Field is required!']"
                          style="width: 200px"
                          @update:model-value="emitAggregationUpdate"
                        />
                      </div>
                      <q-btn
                        icon="delete"
                        class="iconHoverBtn q-mb-sm q-ml-xs q-mr-sm"
                        :class="
                          store.state?.theme === 'dark' ? 'icon-dark' : ''
                        "
                        padding="xs"
                        unelevated
                        size="sm"
                        round
                        flat
                        :title="t('alert_templates.delete')"
                        @click="deleteGroupByColumn(index)"
                        style="min-width: auto"
                      />
                    </div>
                  </template>
                  <q-btn
                    icon="add"
                    class="iconHoverBtn q-mb-sm q-mr-sm"
                    :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                    padding="xs"
                    unelevated
                    size="sm"
                    round
                    flat
                    :title="t('common.add')"
                    @click="addGroupByColumn"
                    style="min-width: auto"
                  />
                </div>
              </div>

              <!-- Threshold with Aggregation -->
              <div class="flex justify-start items-start q-mb-xs no-wrap">
                <div
                  class="tw:font-semibold flex items-center"
                  style="width: 190px; height: 36px"
                >
                  {{ t("alerts.aggregation_threshold") + " *" }}
                  <q-icon
                    name="info"
                    size="17px"
                    class="q-ml-xs cursor-pointer"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    <q-tooltip
                      anchor="center right"
                      self="center left"
                      max-width="300px"
                    >
                      <span style="font-size: 14px">
                        Defines when the alert should trigger based on the
                        aggregated value.<br />
                        Example: If set to "avg latency > 500", the alert
                        triggers when the average latency exceeds 500ms.
                      </span>
                    </q-tooltip>
                  </q-icon>
                </div>
                <div style="width: calc(100% - 190px)">
                  <div class="flex items-center tw:gap-2 tw:flex-wrap">
                    <div style="flex: 0 0 auto; width: 110px">
                      <q-select
                        v-model="inputData.aggregation.function"
                        :options="aggFunctions"
                        class="no-case q-py-none"
                        borderless
                        hide-bottom-space
                        dense
                        use-input
                        hide-selected
                        fill-input
                        @update:model-value="emitAggregationUpdate"
                      />
                    </div>
                    <div style="flex: 0 0 auto; width: 180px">
                      <q-select
                        v-model="inputData.aggregation.having.column"
                        :options="filteredNumericColumns"
                        class="no-case q-py-none"
                        borderless
                        dense
                        use-input
                        emit-value
                        hide-selected
                        fill-input
                        @filter="filterNumericColumns"
                        @update:model-value="emitAggregationUpdate"
                        hide-bottom-space
                        :error="
                          !inputData.aggregation.having.column ||
                          inputData.aggregation.having.column.length === 0
                        "
                        error-message="Field is required!"
                      />
                    </div>
                    <div style="flex: 0 0 auto; width: 110px">
                      <q-select
                        v-model="inputData.aggregation.having.operator"
                        :options="triggerOperators"
                        color="input-border"
                        class="no-case q-py-none"
                        borderless
                        dense
                        use-input
                        hide-selected
                        fill-input
                        @update:model-value="emitAggregationUpdate"
                      />
                    </div>
                    <div style="flex: 0 0 auto; width: 150px">
                      <q-input
                        v-model="inputData.aggregation.having.value"
                        type="number"
                        dense
                        borderless
                        min="0"
                        :placeholder="t('alerts.placeholders.value')"
                        @update:model-value="emitAggregationUpdate"
                        hide-bottom-space
                        :rules="[(val: any) => !!val || 'Field is required!']"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </q-form>
      </template>

      <!-- SQL/PromQL Preview Mode -->
      <template v-else>
        <div class="tw:w-full tw:flex tw:flex-col tw:gap-4">
          <!-- SQL/PromQL Editor (full width) -->
          <div
            ref="sqlPromqlPreviewRef"
            class="query-editor-box"
            :class="
              store.state.theme === 'dark'
                ? 'dark-mode-preview'
                : 'light-mode-preview'
            "
          >
            <div
              class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2"
            >
              <span class="preview-title">{{
                localTab === "sql" ? "SQL" : "PromQL"
              }}</span>
            </div>
            <div style="height: 280px">
              <UnifiedQueryEditor
                :languages="localTab === 'sql' ? ['sql'] : ['promql']"
                :default-language="localTab"
                :query="sqlOrPromqlQuery"
                :disable-ai="!streamName"
                :disable-ai-reason="t('search.selectStreamForAI')"
                editor-height="280px"
                data-test-prefix="alert-inline"
                @update:query="updateMainQuery"
              />
            </div>
          </div>

          <!-- VRL Function Editor (full width, below SQL) -->
          <div
            v-if="showVrlEditor && localTab !== 'promql'"
            class="query-editor-box"
            :class="
              store.state.theme === 'dark'
                ? 'dark-mode-preview'
                : 'light-mode-preview'
            "
          >
            <div
              class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2"
            >
              <span class="preview-title">VRL Function</span>
            </div>
            <div style="height: 200px">
              <UnifiedQueryEditor
                :languages="['vrl']"
                default-language="vrl"
                :query="vrlFunctionContent"
                :disable-ai="!streamName"
                :disable-ai-reason="t('search.selectStreamForAI')"
                editor-height="200px"
                data-test-prefix="alert-vrl-inline"
                @update:query="handleVrlEditorUpdate"
              />
            </div>
          </div>

          <!-- PromQL Trigger Condition (only for PromQL tab) - Below the preview -->
          <div
            v-if="localTab === 'promql' && promqlCondition"
            class="flex justify-start items-start q-mb-xs tw:ml-2 no-wrap"
          >
            <div
              class="tw:font-semibold flex items-center"
              style="width: 190px; height: 36px"
            >
              Trigger if the value is *
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">
                    Defines when the alert should trigger based on the PromQL
                    query result value.<br />
                    Example: If set to ">= 100", the alert triggers when the
                    query result is greater than or equal to 100.
                  </span>
                </q-tooltip>
              </q-icon>
            </div>
            <div style="width: calc(100% - 190px)">
              <div class="flex justify-start items-start">
                <div class="tw:flex tw:flex-col">
                  <q-select
                    v-model="promqlCondition.operator"
                    :options="triggerOperators"
                    class="showLabelOnTop no-case q-py-none"
                    borderless
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    :style="{
                      width:
                        promqlCondition.operator === 'Contains' ||
                        promqlCondition.operator === 'NotContains'
                          ? '124px'
                          : '88px',
                      minWidth: '88px',
                    }"
                    @update:model-value="emitPromqlConditionUpdate"
                  />
                  <div
                    v-if="!promqlCondition.operator"
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
                <div
                  class="flex items-start tw:flex-col"
                  style="border-left: none"
                >
                  <div class="tw:flex tw:items-center">
                    <div style="width: 179px; margin-left: 0 !important">
                      <q-input
                        v-model.number="promqlCondition.value"
                        type="number"
                        dense
                        borderless
                        style="background: none"
                        debounce="300"
                        @update:model-value="emitPromqlConditionUpdate"
                      />
                    </div>
                  </div>
                  <div
                    v-if="
                      promqlCondition.value === undefined ||
                      promqlCondition.value === null ||
                      promqlCondition.value === ''
                    "
                    class="text-red-8 q-pt-xs"
                    style="font-size: 11px; line-height: 12px"
                  >
                    Field is required!
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Query Editor Dialog -->
    <QueryEditorDialog
      v-model="viewSqlEditor"
      :tab="localTab"
      :sqlQuery="localSqlQuery"
      :promqlQuery="localPromqlQuery"
      :vrlFunction="vrlFunctionContent"
      :streamName="streamName"
      :streamType="streamType"
      :columns="columns"
      :period="inputData.period"
      :multiTimeRange="inputData.multi_time_range"
      :savedFunctions="functionsList"
      :sqlQueryErrorMsg="sqlQueryErrorMsg"
      @update:sqlQuery="updateSqlQuery"
      @update:promqlQuery="updatePromqlQuery"
      @update:vrlFunction="handleVrlFunctionUpdate"
      @validate-sql="handleValidateSql"
    />

    <!-- Multi-Window Confirmation Dialog -->
    <CustomConfirmDialog
      v-model="showMultiWindowDialog"
      title="Clear Multi-Windows?"
      :message="`Multi-windows are configured. To enable ${pendingTab === 'custom' ? 'Custom' : 'PromQL'} mode, we need to clear them. Do you want to proceed?`"
      @confirm="handleConfirmClearMultiWindows"
      @cancel="handleCancelClearMultiWindows"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  type PropType,
  defineAsyncComponent,
  nextTick,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { b64EncodeUnicode } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import CustomConfirmDialog from "@/components/alerts/CustomConfirmDialog.vue";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
const UnifiedQueryEditor = defineAsyncComponent(
  () => import("@/components/QueryEditor.vue"),
);

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    AppTabs,
    FilterGroup,
    QueryEditor,
    UnifiedQueryEditor,
    QueryEditorDialog,
    CustomConfirmDialog,
  },
  props: {
    tab: {
      type: String,
      default: "custom",
    },
    multiTimeRange: {
      type: Array as PropType<any[]>,
      default: () => [],
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
    sqlQueryErrorMsg: {
      type: String,
      default: "",
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    promqlCondition: {
      type: Object as PropType<any>,
      default: null,
    },
  },
  emits: [
    "update:tab",
    "update-group",
    "remove-group",
    "input:update",
    "update:sqlQuery",
    "update:promqlQuery",
    "update:vrlFunction",
    "validate-sql",
    "clear-multi-windows",
    "editor-closed",
    "editor-state-changed",
    "update:isAggregationEnabled",
    "update:aggregation",
    "update:promqlCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localTab = ref(props.tab);
    const viewSqlEditor = ref(false);
    const showVrlEditor = ref(false);
    const customConditionsForm = ref(null);
    const showMultiWindowDialog = ref(false);
    const pendingTab = ref<string | null>(null);

    // Field refs for focus manager
    const customPreviewRef = ref(null);
    const sqlPromqlPreviewRef = ref(null);

    // Local query values
    const localSqlQuery = ref(props.sqlQuery);
    const localPromqlQuery = ref(props.promqlQuery);
    const vrlFunctionContent = ref(props.vrlFunction);

    // Aggregation state
    const localIsAggregationEnabled = ref(props.isAggregationEnabled);

    // Aggregation functions
    const aggFunctions = [
      "count",
      "min",
      "max",
      "avg",
      "sum",
      "median",
      "p50",
      "p75",
      "p90",
      "p95",
      "p99",
    ];

    // Trigger operators
    const triggerOperators = [
      "=",
      "!=",
      ">=",
      ">",
      "<=",
      "<",
      "Contains",
      "NotContains",
    ];

    // Filtered fields for group by
    const filteredFields = ref([...props.columns]);
    const filterFields = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredFields.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredFields.value = props.columns.filter((v: any) => {
            const label = typeof v === "string" ? v : v.label || v.value || "";
            return label.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    // Filtered numeric columns for aggregation
    const filteredNumericColumns = ref([...props.columns]);
    const filterNumericColumns = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredNumericColumns.value = [...props.columns];
        } else {
          const needle = val.toLowerCase();
          filteredNumericColumns.value = props.columns.filter((v: any) => {
            const label = typeof v === "string" ? v : v.label || v.value || "";
            return label.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    // Get saved VRL functions from store
    const functionsList = computed(
      () => store.state.organizationData.functions || [],
    );

    // Compute tab options based on stream type and alert type
    const tabOptions = computed(() => {
      // For real-time alerts, only show Builder (no tabs needed)
      if (props.isRealTime === "true") {
        return [
          {
            label: t("alerts.queryBuilder"),
            value: "custom",
          },
        ];
      }

      // For metrics, show all three tabs: Builder, SQL, PromQL
      if (props.streamType === "metrics") {
        return [
          {
            label: t("alerts.queryBuilder"),
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

      // For logs and traces, show only Builder and SQL
      return [
        {
          label: "Builder",
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
      return props.isRealTime === "false";
    });

    const updateTab = (tab: string) => {
      const hasComparisonWindow = props.multiTimeRange?.length > 0;

      // Check if switching to custom or promql while multi-windows are present
      if ((tab === "custom" || tab === "promql") && hasComparisonWindow) {
        // Show confirmation dialog
        pendingTab.value = tab;
        showMultiWindowDialog.value = true;
        return;
      }

      // When switching to custom mode, check if there's only one empty condition and remove it
      // This ensures generate_sql API is called
      if (tab === "custom" && props.inputData.conditions) {
        removeSingleEmptyCondition(props.inputData.conditions);
      }

      // No multi-windows, proceed with tab change
      localTab.value = tab;
      emit("update:tab", tab);
    };

    // Helper function to remove a single empty condition if that's the only condition present
    const removeSingleEmptyCondition = (conditionsObj: any) => {
      if (
        !conditionsObj ||
        !conditionsObj.conditions ||
        !Array.isArray(conditionsObj.conditions)
      ) {
        return;
      }

      // Only proceed if there's exactly one condition at the top level
      if (conditionsObj.conditions.length === 1) {
        const singleItem = conditionsObj.conditions[0];

        // Check if it's a condition (not a group) with empty column AND empty value
        if (singleItem.filterType === "condition") {
          const hasColumn =
            singleItem.column && singleItem.column.trim() !== "";
          const hasValue =
            singleItem.value !== undefined &&
            singleItem.value !== "" &&
            singleItem.value !== null;

          // If both column and value are empty, remove this condition
          if (!hasColumn && !hasValue) {
            conditionsObj.conditions = [];
          }
        }
      }
    };

    const handleConfirmClearMultiWindows = () => {
      // Clear multi-windows
      emit("clear-multi-windows");

      // Wait for next tick to ensure multi-windows are cleared, then switch tab
      nextTick(() => {
        if (pendingTab.value) {
          localTab.value = pendingTab.value;
          emit("update:tab", pendingTab.value);
          pendingTab.value = null;
        }
        showMultiWindowDialog.value = false;
      });
    };

    const handleCancelClearMultiWindows = () => {
      pendingTab.value = null;
      showMultiWindowDialog.value = false;
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
      return localTab.value === "sql" ? props.sqlQuery : props.promqlQuery;
    });

    const updateSqlQuery = (value: string) => {
      localSqlQuery.value = value;
      emit("update:sqlQuery", value);
    };

    const updatePromqlQuery = (value: string) => {
      localPromqlQuery.value = value;
      emit("update:promqlQuery", value);
    };

    // Handler for VRL function updates from QueryEditorDialog
    // The dialog now emits plain text VRL (encoding happens once at save time)
    const handleVrlFunctionUpdate = (vrlValue: string) => {
      emit("update:vrlFunction", vrlValue);
    };

    // Handler for VRL editor updates from inline editor
    const handleVrlEditorUpdate = (vrlValue: string) => {
      vrlFunctionContent.value = vrlValue;
      emit("update:vrlFunction", vrlValue);
    };

    // Handler for SQL validation from QueryEditorDialog
    const handleValidateSql = () => {
      emit("validate-sql");
    };

    // Toggle aggregation
    const toggleAggregation = () => {
      if (localIsAggregationEnabled.value) {
        // Enabling — initialize with defaults
        props.inputData.aggregation = {
          group_by: [""],
          function: "avg",
          having: {
            column: "",
            operator: "=",
            value: "",
          },
        };
      } else {
        // Disabling — reset/clear the aggregation data
        props.inputData.aggregation = null;
      }

      emit("update:isAggregationEnabled", localIsAggregationEnabled.value);
      emit("update:aggregation", props.inputData.aggregation);
    };

    // Add group by column
    const addGroupByColumn = () => {
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by.push("");
        emitAggregationUpdate();
      }
    };

    // Delete group by column
    const deleteGroupByColumn = (index: string | number) => {
      const idx = typeof index === "string" ? parseInt(index) : index;
      if (props.inputData.aggregation) {
        props.inputData.aggregation.group_by.splice(idx, 1);
        emitAggregationUpdate();
      }
    };

    // Emit aggregation update
    const emitAggregationUpdate = () => {
      emit("update:aggregation", props.inputData.aggregation);
    };

    // Emit PromQL condition update
    const emitPromqlConditionUpdate = () => {
      emit("update:promqlCondition", props.promqlCondition);
    };

    // Watch for SQL editor dialog state changes
    watch(viewSqlEditor, (newValue, oldValue) => {
      // Emit state change whenever it changes
      console.log(
        "[QueryConfig] SQL Editor state changed:",
        oldValue,
        "->",
        newValue,
      );
      emit("editor-state-changed", newValue);

      // When dialog closes (goes from true to false), emit event to refresh preview
      if (oldValue === true && newValue === false) {
        console.log(
          "[QueryConfig] SQL Editor Dialog closed, emitting editor-closed event",
        );
        emit("editor-closed");
      }
    });

    // Sync filtered lists when columns prop changes (async stream load)
    watch(
      () => props.columns,
      (newCols) => {
        filteredFields.value = [...newCols];
        filteredNumericColumns.value = [...newCols];
      },
    );

    // Watch for isAggregationEnabled prop changes
    watch(
      () => props.isAggregationEnabled,
      (newVal) => {
        localIsAggregationEnabled.value = newVal;
      },
    );

    // Validation function for Step 2
    const validate = async () => {
      // Custom mode: Check if conditions have empty columns or values
      if (localTab.value === "custom") {
        return await validateCustomMode();
      }

      // SQL mode: Check for empty query and backend validation errors
      if (localTab.value === "sql") {
        return validateSqlMode();
      }

      // PromQL mode: No validation required
      return true;
    };

    // Validate custom mode conditions
    const validateCustomMode = async () => {
      const conditions = props.inputData.conditions;

      // If no conditions added at all, allow navigation
      if (
        !conditions ||
        !conditions.conditions ||
        conditions.conditions.length === 0
      ) {
        return true;
      }

      // Use Quasar form validation
      if (
        customConditionsForm.value &&
        typeof (customConditionsForm.value as any).validate === "function"
      ) {
        const validationResult = (customConditionsForm.value as any).validate();

        // Await if async
        const isValid =
          validationResult instanceof Promise
            ? await validationResult
            : validationResult;

        // Focus first error field if validation failed
        if (!isValid) {
          await nextTick();
          const firstErrorField = document.querySelector(
            ".q-field--error input, .q-field--error textarea, .q-field--error .q-select",
          ) as HTMLElement;
          if (firstErrorField) {
            firstErrorField.focus();
          }
        }

        return isValid;
      }

      // If form validation is not available, return true as safe fallback
      return true;
    };

    // Validate SQL mode
    const validateSqlMode = () => {
      const sqlQuery = props.sqlQuery;

      // Check if SQL query is empty
      if (!sqlQuery || sqlQuery.trim() === "") {
        return false;
      }

      // Check if there's a backend validation error
      if (props.sqlQueryErrorMsg && props.sqlQueryErrorMsg.trim() !== "") {
        return false;
      }

      return true;
    };

    return {
      t,
      store,
      localTab,
      tabOptions,
      shouldShowTabs,
      showVrlEditor,
      updateTab,
      updateGroup,
      removeConditionGroup,
      onInputUpdate,
      sqlOrPromqlQuery,
      viewSqlEditor,
      localSqlQuery,
      localPromqlQuery,
      vrlFunctionContent,
      updateSqlQuery,
      updatePromqlQuery,
      handleVrlFunctionUpdate,
      handleVrlEditorUpdate,
      handleValidateSql,
      functionsList,
      validate,
      customConditionsForm,
      // Field refs for focus manager
      customPreviewRef,
      sqlPromqlPreviewRef,
      // Multi-window dialog
      showMultiWindowDialog,
      pendingTab,
      handleConfirmClearMultiWindows,
      handleCancelClearMultiWindows,
      // Aggregation
      localIsAggregationEnabled,
      aggFunctions,
      triggerOperators,
      filteredFields,
      filterFields,
      filteredNumericColumns,
      filterNumericColumns,
      toggleAggregation,
      addGroupByColumn,
      deleteGroupByColumn,
      emitAggregationUpdate,
      emitPromqlConditionUpdate,
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
    min-height: 100%;
  }

  &.dark-mode {
    .step-content {
      background-color: transparent;
    }
  }

  &.light-mode {
    .step-content {
      background-color: transparent;
    }
  }
}

.query-editor-box {
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100%;

  .preview-header {
    border-bottom: 1px solid;
    flex-shrink: 0;
  }

  .preview-title {
    font-weight: 600;
    font-size: 14px;
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
  }

  &.light-mode-preview {
    background-color: #f5f5f5;
    border: 1px solid #e6e6e6;

    .preview-header {
      background-color: #ffffff;
      border-bottom-color: #e6e6e6;
    }

    .preview-title {
      color: #1a1a1a;
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
    font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
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
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.15) 0%,
    rgba(236, 72, 153, 0.15) 100%
  ) !important;
  transition:
    background 0.3s ease,
    box-shadow 0.3s ease;

  &:hover {
    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;
    box-shadow: 0 0.25rem 0.75rem 0 rgba(139, 92, 246, 0.35);
  }

  &.ai-btn-active {
    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;
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

.section-group {
  overflow: hidden;

  .section-group-header {
    border-bottom: 1px solid;
  }

  &.section-group-dark {
    border: 1px solid #343434;
    background-color: transparent;

    .section-group-header {
      background-color: #212121;
      border-bottom-color: #343434;
    }

    .section-group-label {
      color: #9ca3af;
    }
  }

  &.section-group-light {
    border: 1px solid #e6e6e6;
    background-color: transparent;

    .section-group-header {
      background-color: #f9fafb;
      border-bottom-color: #e6e6e6;
    }

    .section-group-label {
      color: #6b7280;
    }
  }
}
</style>
