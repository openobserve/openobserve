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
    <div class="step-content card-container tw:px-3 tw:py-4">
      <!-- Query Mode Tabs (hidden for real-time alerts) -->
      <div v-if="shouldShowTabs" class="tw:mb-4 tw:flex tw:items-center tw:justify-between">
        <div class="flex items-center app-tabs-container tw:h-[36px] tw:w-fit">
          <AppTabs
            data-test="step2-query-tabs"
            :tabs="tabOptions"
            class="tabs-selection-container"
            :active-tab="localTab"
            @update:active-tab="updateTab"
          />
        </div>

        <!-- View Editor Button (only for SQL/PromQL tabs) -->
        <q-btn
          v-if="localTab !== 'custom'"
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

      <!-- Custom Query Builder -->
      <template v-if="localTab === 'custom'">
        <q-form ref="customConditionsForm" greedy>
          <div ref="customPreviewRef">
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
        </q-form>
      </template>

      <!-- SQL/PromQL Preview Mode -->
      <template v-else>
        <div class="tw:w-full tw:flex tw:flex-col tw:gap-4">

          <!-- Preview Boxes Container -->
          <div class="tw:flex tw:gap-4 tw:w-full">
            <!-- SQL/PromQL Preview Box (50% or 100% if no VRL) -->
            <div ref="sqlPromqlPreviewRef" class="preview-box tw:flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" style="height: 464px;">
              <div class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
                <span class="preview-title">{{ localTab === 'sql' ? 'SQL' : 'PromQL' }} Preview</span>
              </div>
              <div class="preview-content tw:px-3 tw:py-2">
                <pre class="preview-code">{{ sqlOrPromqlQuery || `No ${localTab === 'sql' ? 'SQL' : 'PromQL'} query defined yet` }}</pre>
              </div>
            </div>

            <!-- VRL Preview Box (50%) - Only show if VRL function exists -->
            <div v-if="vrlFunction" class="preview-box tw:flex-1" :class="store.state.theme === 'dark' ? 'dark-mode-preview' : 'light-mode-preview'" style="height: 464px;">
              <div class="preview-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
                <span class="preview-title">VRL Preview</span>
              </div>
              <div class="preview-content tw:px-3 tw:py-2">
                <pre class="preview-code">{{ vrlFunction }}</pre>
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
import { defineComponent, ref, computed, type PropType, defineAsyncComponent, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { b64EncodeUnicode } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import CustomConfirmDialog from "@/components/alerts/CustomConfirmDialog.vue";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue")
);

export default defineComponent({
  name: "Step2QueryConfig",
  components: {
    AppTabs,
    FilterGroup,
    QueryEditor,
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
  },
  emits: ["update:tab", "update-group", "remove-group", "input:update", "update:sqlQuery", "update:promqlQuery", "update:vrlFunction", "validate-sql", "clear-multi-windows"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localTab = ref(props.tab);
    const viewSqlEditor = ref(false);
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

    // Get saved VRL functions from store
    const functionsList = computed(() => store.state.organizationData.functions || []);


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
      return props.isRealTime === "false";
    });

    const updateTab = (tab: string) => {
      const hasComparisonWindow = props.multiTimeRange?.length > 0;

      // Check if switching to custom or promql while multi-windows are present
      if ((tab === 'custom' || tab === 'promql') && hasComparisonWindow) {
        // Show confirmation dialog
        pendingTab.value = tab;
        showMultiWindowDialog.value = true;
        return;
      }

      // No multi-windows, proceed with tab change
      localTab.value = tab;
      emit("update:tab", tab);
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

    // Handler for VRL function updates from QueryEditorDialog
    // The dialog emits the encoded value, so we just pass it through
    const handleVrlFunctionUpdate = (encodedValue: string) => {
      emit("update:vrlFunction", encodedValue);
    };

    // Handler for SQL validation from QueryEditorDialog
    const handleValidateSql = () => {
      emit("validate-sql");
    };

    // Validation function for Step 2
    const validate = async () => {
      // Custom mode: Check if conditions have empty columns or values
      if (localTab.value === 'custom') {
        return await validateCustomMode();
      }

      // SQL mode: Check for empty query and backend validation errors
      if (localTab.value === 'sql') {
        return validateSqlMode();
      }

      // PromQL mode: No validation required
      return true;
    };

    // Validate custom mode conditions
    const validateCustomMode = async () => {
      const conditions = props.inputData.conditions;

      // If no conditions added at all, allow navigation
      if (!conditions || !conditions.conditions || conditions.conditions.length === 0) {
        return true;
      }

      // Use Quasar form validation
      if (customConditionsForm.value && typeof (customConditionsForm.value as any).validate === 'function') {
        const validationResult = (customConditionsForm.value as any).validate();

        // Await if async
        const isValid = validationResult instanceof Promise ? await validationResult : validationResult;

        // Focus first error field if validation failed
        if (!isValid) {
          await nextTick();
          const firstErrorField = document.querySelector('.q-field--error input, .q-field--error textarea, .q-field--error .q-select') as HTMLElement;
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
      if (!sqlQuery || sqlQuery.trim() === '') {
        return false;
      }

      // Check if there's a backend validation error
      if (props.sqlQueryErrorMsg && props.sqlQueryErrorMsg.trim() !== '') {
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
