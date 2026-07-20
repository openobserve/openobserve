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
    class="flex flex-col h-full flex-nowrap searchdetaildialog"
    data-test="dialog-box"
  >
    <!-- Single Tab Row -->
    <div class="flex justify-between pt-2 items-center">
      <div class="flex items-center gap-2 -mb-0.75">
        <OTabs v-model="tab" align="left">
          <OTab
            data-test="log-detail-json-tab"
            name="json"
            :label="t('common.json')"
          />
          <OTab
            data-test="log-detail-table-tab"
            name="table"
            :label="t('common.table')"
          />
          <!-- Correlation Tabs (only visible when service streams enabled and enterprise license) -->
          <OTab
            data-test="correlated-logs-tab"
            v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
            name="correlated-logs"
            :label="t('correlation.correlatedLogs')"
          />
          <OTab
            data-test="correlated-metrics-tab"
            v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
            name="correlated-metrics"
            :label="t('correlation.correlatedMetrics')"
          />
          <OTab
            data-test="correlated-traces-tab"
            v-if="serviceStreamsEnabled && config.isEnterprise === 'true'"
            name="correlated-traces"
            :label="t('correlation.correlatedTraces')"
          />
        </OTabs>
      </div>
      <div class="flex items-center gap-2 pr-3 shrink-0">
        <O2AIContextAddBtn
          data-test="logs-detail-ai-context-btn"
          @sendToAiChat="sendToAiChat(JSON.stringify(rowData))"
        />
        <OSwitch
          v-show="tab === 'table'"
          data-test="log-detail-wrap-values-toggle-btn"
          v-model="shouldWrapValues"
          :label="t('common.wrap')"
          size="sm"
          @update:model-value="toggleWrapLogDetails"
        />
      </div>
    </div>

    <OSeparator />

    <div
      :class="[
        'flex flex-col h-full',
        tab.startsWith('correlated-') ? 'overflow-hidden full-height-panels' : 'overflow-y-auto',
      ]"
    >
    <OTabPanels
      data-test="log-detail-tab-container"
      v-model="tab"
      keep-alive
      grow
      class="overflow-y-auto!"
    >
      <OTabPanel name="json">
        <OCardSection
          data-test="log-detail-json-content"
          class="p-0 mb-6 pt-2"
        >
          <json-preview
            :value="rowData"
            show-copy-button
            mode="sidebar"
            hide-view-related
            :highlight-query="highlightQuery"
            :should-wrap-values="shouldWrapValues"
            @copy="copyContentToClipboard"
            @add-field-to-table="addFieldToTable"
            @add-search-term="toggleIncludeSearchTerm"
            @view-trace="viewTrace"
            @send-to-ai-chat="sendToAiChat"
            @closeTable="closeTable"
            @show-correlation="showCorrelation"
          />
        </OCardSection>
      </OTabPanel>
      <OTabPanel name="table">
        <OCardSection
          class="p-[0.675rem] mb-6"
          data-test="log-detail-table-content"
        >
          <div v-if="rowData.length == 0" class="pt-3 max-w-[350px]">
            {{ t('logs.detailTable.noDataAvailable') }}
          </div>
          <OTable
            v-else
            data-test="log-detail-table"
            :data="tableRows"
            :columns="tableColumns"
            row-key="_rowKey"
            pagination="none"
            :default-columns="false"
            class="o2-table o2-row-md o2-schema-table log-detail-source-table w-full border border-solid border-[var(--o2-border-color)]"
            :class="store.state.theme === 'dark' && 'dark'"
          >
            <template #cell-field="{ row, value }">
              <div
                :data-test="`log-detail-${value}-key`"
                class="text-left"
                :class="
                  store.state.theme == 'dark'
                    ? 'text-[#f67a7aff]'
                    : 'text-[#B71C1C]'
                "
              >
                {{ value }}
              </div>
            </template>

            <template #cell-value="{ row }">
              <div class="text-left" :class="!shouldWrapValues ? 'ellipsis' : ''">
                <div class="flex items-start gap-2">
                  <ODropdown v-model:open="tableDropdownOpenMap[row.field]" side="bottom" align="start">
                    <template #trigger>
                      <OButton
                        :data-test="`log-details-include-exclude-field-btn-${row.field}`"
                        size="icon-xs"
                        variant="ghost"
                        class="log-json-field-dropdown-btn"
                        :aria-label="t('logs.detailTable.addIcon')"
                      >
                        <OIcon :name="tableDropdownOpenMap[row.field] ? 'arrow-drop-up' : 'arrow-drop-down'" size="sm" />
                      </OButton>
                    </template>
                    <ODropdownItem
                      v-if="
                        searchObj.data.stream.selectedStreamFields.some(
                          (item: any) =>
                            item.name === row.field ? item.isSchemaField : '',
                        )
                      "
                      data-test="log-details-include-field-btn"
                      @select="toggleIncludeSearchTerm(row.field, row.value, 'include')"
                    >
                      <template #icon-left><EqualIcon class="size-2.5" /></template>
                      {{ t("common.includeSearchTerm") }}
                    </ODropdownItem>
                    <ODropdownItem
                      v-if="
                        searchObj.data.stream.selectedStreamFields.some(
                          (item: any) =>
                            item.name === row.field ? item.isSchemaField : '',
                        )
                      "
                      data-test="log-details-exclude-field-btn"
                      @select="toggleExcludeSearchTerm(row.field, row.value, 'exclude')"
                    >
                      <template #icon-left><NotEqualIcon class="size-2.5" /></template>
                      {{ t("common.excludeSearchTerm") }}
                    </ODropdownItem>
                    <template v-if="row.field !== store.state.zoConfig.timestamp_column">
                      <ODropdownItem
                        v-if="!searchObj.data.stream.selectedFields.includes(row.field.toString())"
                        data-test="log-details-include-field-btn"
                        @select="addFieldToTable(row.field.toString())"
                        icon-left="visibility"
                      >
                        {{ t("common.addFieldToTable") }}
                      </ODropdownItem>
                      <ODropdownItem
                        v-else
                        data-test="log-details-include-field-btn"
                        @select="addFieldToTable(row.field.toString())"
                        icon-left="visibility-off"
                      >
                        {{ t("common.removeFieldFromTable") }}
                      </ODropdownItem>
                    </template>
                    <!-- Cross-link options -->
                    <template v-if="getCrossLinksForField(row.field).length > 0">
                      <ODropdownSeparator />
                      <ODropdownItem
                        v-for="crossLink in getCrossLinksForField(row.field)"
                        :key="crossLink.name"
                        :data-test="`log-details-cross-link-${crossLink.name}`"
                        @select.stop="openCrossLink(crossLink.resolvedUrl)"
                        icon-left="open-in-new"
                      >
                        {{ crossLink.name }}
                      </ODropdownItem>
                    </template>
                    <ODropdownItem
                      v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
                      data-test="log-details-table-send-to-ai-chat-btn"
                      @select="sendToAiChat(JSON.stringify({ [row.field]: row.value }))"
                    >
                      <template #icon-left>
                        <img :src="getBtnLogo" width="14" height="14" alt="" />
                      </template>
                      {{ t('logs.detailTable.sendToAiChat') }}
                    </ODropdownItem>
                    <ODropdownItem
                      v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
                      data-test="log-details-table-redirect-to-regex-pattern-btn"
                      @select="createRegexPatternFromLogs(row.field, row.value)"
                    >
                      <template #icon-left>
                        <img :src="regexIcon" width="14" height="14" alt="" />
                      </template>
                      {{ t("regex_patterns.create_regex_pattern_field") }}
                    </ODropdownItem>
                  </ODropdown>
                  <pre
                    :data-test="`log-detail-${row.field}-value`"
                    class="table-pre flex-1 min-w-0"
                    :class="
                      !shouldWrapValues
                        ? 'whitespace-nowrap overflow-hidden text-ellipsis'
                        : 'whitespace-pre-wrap'
                    "
                  ><ChunkedContent
                      v-if="getContentSize(row.value) > 50000"
                      :data="row.value"
                      :field-key="`detail_${row.field}`"
                      :query-string="highlightQuery"
                      :simple-mode="false"
                    /><LogsHighLighting
                      v-else
                      :data="getDisplayValue(row.field, row.value)"
                      :show-braces="false"
                      :query-string="highlightQuery"
                    /></pre>
                </div>
              </div>
            </template>
          </OTable>
        </OCardSection>
      </OTabPanel>

      <!-- Correlated Logs Tab Panel (Custom Component) -->
      <OTabPanel name="correlated-logs" stretch>
        <CorrelatedLogsTable
          v-if="correlationProps"
          :service-name="correlationProps.serviceName"
          :matched-dimensions="correlationProps.matchedDimensions"
          :additional-dimensions="correlationProps.additionalDimensions"
          :matched-set-id="correlationProps.matchedSetId"
          :chip-dimensions="correlationProps.chipDimensions"
          :source-event="correlationProps.sourceEvent"
          :log-streams="correlationProps.logStreams"
          :source-stream="correlationProps.sourceStream"
          :source-type="correlationProps.sourceType"
          :available-dimensions="correlationProps.availableDimensions"
          :fts-fields="correlationProps.ftsFields"
          :time-range="correlationProps.timeRange"
          :hide-view-related-button="true"
          :hide-search-term-actions="false"
          :hide-dimension-filters="true"
          :hide-reset-filters-button="true"
          class="pr-3!"
          @sendToAiChat="sendToAiChat"
          @addSearchTerm="addSearchTerm"
        />
        <!-- Loading/Empty state when no data -->
        <div
          v-else
          class="flex items-center justify-center h-full py-20"
        >
          <div class="text-center">
            <OSpinner v-if="correlationLoading" size="lg" class="mb-4" data-test="logs-correlation-loading-indicator" />
            <div
              v-else-if="correlationError"
              class="text-base text-red-500"
            >
              {{ correlationError }}
            </div>
            <div v-else class="text-base text-gray-500">
              {{ t("correlation.clickToLoadLogs") }}
            </div>
          </div>
        </div>
      </OTabPanel>

      <!-- Correlated Metrics Tab Panel -->
      <OTabPanel name="correlated-metrics" stretch>
        <TelemetryCorrelationDashboard
          v-if="correlationProps"
          mode="embedded-tabs"
          external-active-tab="metrics"
          :service-name="correlationProps.serviceName"
          :matched-dimensions="correlationProps.matchedDimensions"
          :additional-dimensions="correlationProps.additionalDimensions"
          :matched-set-id="correlationProps.matchedSetId"
          :chip-dimensions="correlationProps.chipDimensions"
          :source-event="correlationProps.sourceEvent"
          :metric-streams="correlationProps.metricStreams"
          :log-streams="correlationProps.logStreams"
          :trace-streams="correlationProps.traceStreams"
          :source-stream="correlationProps.sourceStream"
          :source-type="correlationProps.sourceType"
          :available-dimensions="correlationProps.availableDimensions"
          :fts-fields="correlationProps.ftsFields"
          :time-range="correlationProps.timeRange"
          :hide-dimension-filters="true"
          @close="tab = 'json'"
        />
        <!-- Loading/Empty state when no data -->
        <div v-else class="flex items-center justify-center h-full py-20">
          <div class="text-center">
            <OSpinner v-if="correlationLoading" size="lg" class="mb-4" data-test="logs-correlation-loading-indicator" />
            <div v-else-if="correlationError" class="text-base text-red-500">{{ correlationError }}</div>
            <div v-else class="text-base text-gray-500">{{ t('correlation.clickToLoadMetrics') }}</div>
          </div>
        </div>
      </OTabPanel>

      <!-- Correlated Traces Tab Panel -->
      <OTabPanel name="correlated-traces" stretch>
        <TelemetryCorrelationDashboard
          v-if="correlationProps"
          mode="embedded-tabs"
          external-active-tab="traces"
          :service-name="correlationProps.serviceName"
          :matched-dimensions="correlationProps.matchedDimensions"
          :additional-dimensions="correlationProps.additionalDimensions"
          :matched-set-id="correlationProps.matchedSetId"
          :chip-dimensions="correlationProps.chipDimensions"
          :source-event="correlationProps.sourceEvent"
          :metric-streams="correlationProps.metricStreams"
          :log-streams="correlationProps.logStreams"
          :trace-streams="correlationProps.traceStreams"
          :source-stream="correlationProps.sourceStream"
          :source-type="correlationProps.sourceType"
          :available-dimensions="correlationProps.availableDimensions"
          :fts-fields="correlationProps.ftsFields"
          :time-range="correlationProps.timeRange"
          :hide-dimension-filters="true"
          @close="tab = 'json'"
        />
        <!-- Loading/Empty state when no data -->
        <div v-else class="flex items-center justify-center h-full py-20">
          <div class="text-center">
            <OSpinner v-if="correlationLoading" size="lg" class="mb-4" data-test="logs-correlation-loading-indicator" />
            <div v-else-if="correlationError" class="text-base text-red-500">{{ correlationError }}</div>
            <div v-else class="text-base text-gray-500">{{ t('correlation.clickToLoadTraces') }}</div>
          </div>
        </div>
      </OTabPanel>
    </OTabPanels>
    </div>

    <!-- Navigation buttons for log details (show only on JSON/Table tabs) -->
    <OSeparator v-if="tab === 'json' || tab === 'table'" />
    <OCardSection v-if="tab === 'json' || tab === 'table'" class="p-4 pb-4 sticky bottom-0 bg-dialog-bg z-10">
      <div class="flex items-center flex-nowrap justify-between">
        <div class="w-1/12">
          <OButton
            data-test="log-detail-previous-detail-btn"
            variant="outline"
            size="sm-action"
            :disabled="currentIndex <= 0"
            @click="$emit('showPrevDetail', false, true)"
          ><OIcon name="navigate-before" size="sm" class="mr-1" />{{ t('common.previous') }}</OButton>
        </div>
        <div
          v-show="
            streamType !== 'enrichment_tables' &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            hasAggregationQuery == false
          "
          class="flex items-center gap-2"
        >
          <label class="font-bold whitespace-nowrap">{{ t("common.noOfRecords") }}</label>
          <OSelect
            v-model="selectedRelativeValue"
            :options="recordSizeOptions"
            size="md"
            class="select-noof-records"
          />
          <OButton
            data-test="logs-detail-table-search-around-btn"
            variant="outline"
            size="sm-action"
            @click="searchTimeBoxed(rowData, selectedRelativeValue)"
          >{{ t('common.searchAround') }}</OButton>
        </div>
        <div class="w-1/12 items-end" style="display: contents;">
          <OButton
            data-test="log-detail-next-detail-btn"
            variant="outline"
            size="sm-action"
            :disabled="currentIndex >= totalLength - 1"
            @click="$emit('showNextDetail', true, false)"
          >{{ t('common.next') }}<OIcon name="navigate-next" size="sm" class="ml-1" /></OButton>
        </div>
      </div>
    </OCardSection>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue';
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import { defineComponent, ref, reactive, onBeforeMount, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { timestampToTimezoneDate } from "@/utils/timezone";
import JsonPreview from "./JsonPreview.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import ChunkedContent from "@/components/logs/ChunkedContent.vue";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { searchState } from "@/composables/useLogs/searchState";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import TelemetryCorrelationDashboard from "@/plugins/correlation/TelemetryCorrelationDashboard.vue";
import CorrelatedLogsTable from "@/plugins/correlation/CorrelatedLogsTable.vue";
import config from "@/aws-exports";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
const defaultValue: any = () => {
  return {
    data: {},
  };
};

export default defineComponent({
  name: "SearchDetail",
  components: {
    OSeparator, OCardSection,
    OTabs, OTab, OTabPanels, OTabPanel, EqualIcon, NotEqualIcon, JsonPreview, O2AIContextAddBtn, LogsHighLighting, ChunkedContent, TelemetryCorrelationDashboard, CorrelatedLogsTable, OButton, OSelect, ODropdown, ODropdownItem, ODropdownSeparator, OSwitch, OSpinner,
    OIcon,
    OTable,
  },
  emits: [
    "showPrevDetail",
    "showNextDetail",
    "add:searchterm",
    "remove:searchterm",
    "search:timeboxed",
    "add:table",
    "view-trace",
    "sendToAiChat",
    "closeTable",
    "show-correlation",
    "load-correlation", // New event for lazy loading correlation data
  ],
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    currentIndex: {
      type: Number,
      required: true,
    },
    totalLength: {
      type: Number,
      required: true,
    },
    streamType: {
      type: String,
      default: "logs",
    },
    highlightQuery: {
      type: String,
      default: "",
    },
    correlationProps: {
      type: Object,
      default: null,
    },
    correlationLoading: {
      type: Boolean,
      default: false,
    },
    correlationError: {
      type: String,
      default: null,
    },
    initialTab: {
      type: String,
      default: "json",
    },
  },
  methods: {
    toggleIncludeSearchTerm(
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) {
      this.$emit("add:searchterm", field, field_value, action);
    },
    toggleExcludeSearchTerm(
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) {
      this.$emit("add:searchterm", field, field_value, action);
    },
    searchTimeBoxed(rowData: any, size: number) {
      this.$emit("search:timeboxed", {
        key: rowData[this.store.state.zoConfig.timestamp_column],
        size: size,
        body: rowData,
      });
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const rowData: any = ref({});
    const router = useRouter();
    const store = useStore();
    const tableDropdownOpenMap = reactive<Record<string, boolean>>({});
    const tab = ref(props.initialTab || "json");
    const selectedRelativeValue = ref<number>(10);
    const recordSizeOptions = ref<Array<{ label: string; value: number }>>([
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "200", value: 200 },
      { label: "500", value: 500 },
      { label: "1000", value: 1000 },
    ]);
    const shouldWrapValues: any = ref(true);
    const { searchObj } = searchState();
    const {fnParsedSQL, hasAggregation} = logsUtils();


    // Watch for initialTab prop changes to update tab
    watch(
      () => props.initialTab,
      (newInitialTab) => {
        if (newInitialTab) {
          tab.value = newInitialTab;
        }
      },
      { immediate: true }, // Run on mount to handle initial tab
    );

    // Watch for rowData to become available and trigger correlation load if needed
    watch(
      rowData,
      (newRowData) => {
        // If tab is correlation and data not loaded, trigger load once rowData is available
        if (
          newRowData &&
          Object.keys(newRowData).length > 0 &&
          tab.value.startsWith("correlated-") &&
          !props.correlationProps
        ) {
          // Emit the original modelValue (not flattened rowData) as it has _timestamp
          emit("load-correlation", props.modelValue);
        }
      },
      { deep: true },
    );

    // Watch for tab changes - load correlation data when user clicks a correlation tab
    watch(tab, (newTab, oldTab) => {
      const isCorrelationTab = newTab.startsWith("correlated-");

      // Only emit if switching TO a correlation tab AND we don't have data yet
      // Skip if this is the initial load (oldTab is undefined) as rowData watcher handles it
      if (
        isCorrelationTab &&
        !props.correlationProps &&
        oldTab !== undefined &&
        rowData.value &&
        Object.keys(rowData.value).length > 0
      ) {
        // Emit the original modelValue (not flattened rowData) as it has _timestamp
        emit("load-correlation", props.modelValue);
      }

      // If switching FROM correlation tab back to JSON/Table, we keep the data loaded
      // (tabs persist, data persists until navigation)
    });

    // Table columns
    const tableColumns = [
      {
        id: "field",
        header: t("search.sourceName"),
        accessorKey: "field",
        sortable: false,
        size: 220,
        meta: { align: "left" as const },
      },
      {
        id: "value",
        header: t("search.sourceValue"),
        accessorKey: "value",
        sortable: false,
        size: 1200,
        meta: { align: "left" as const },
      },
    ];

    // Transform rowData object into array of rows
    const tableRows = computed(() => {
      return Object.entries(rowData.value).map(([field, value]) => ({
        _rowKey: "field_" + field,
        field,
        value,
      }));
    });

    let multiStreamFields: any = ref([]);
    let hasAggregationQuery: any = computed(() => {
      let parsedSQL = fnParsedSQL();
      return hasAggregation(parsedSQL?.columns);
    });

    // Compute status color for the top border
    const statusColor = computed(() => {
      return extractStatusFromLog(rowData.value).color;
    });

    // Check if service streams feature is enabled
    const serviceStreamsEnabled = computed(() => {
      return store.state.zoConfig.service_streams_enabled !== false;
    });

    onBeforeMount(() => {
      if (window.localStorage.getItem("wrap-log-details") === null) {
        window.localStorage.setItem("wrap-log-details", "true");
      }
      shouldWrapValues.value =
        window.localStorage.getItem("wrap-log-details") === "true";

      searchObj.data.stream.selectedStreamFields.forEach((item: any) => {
        if (
          item.streams.length == searchObj.data.stream.selectedStream.length
        ) {
          multiStreamFields.value.push(item.name);
        }
      });
    });

    const toggleWrapLogDetails = () => {
      window.localStorage.setItem(
        "wrap-log-details",
        shouldWrapValues.value ? "true" : "false",
      );
    };

    const flattenJSONObject = (obj: any, param: string) => {
      let newObj: any = {};
      for (let key in obj) {
        if (typeof obj[key] === "object") {
          // let childJSON = JSON.stringify(obj[key]);
          // let unflatten = flattenJSONObject(obj[key], key + ".");
          newObj = {
            ...newObj,
            ...flattenJSONObject(obj[key], param + key + "."),
          };
        } else {
          newObj[param + key] = obj[key];
        }
      }
      return newObj;
    };

    const copyContentToClipboard = (log: any) => {
      copyToClipboard(JSON.stringify(log), {
        successMessage: t("logs.detailTable.contentCopiedSuccessfully"),
        timeout: 1000,
      });
    };

    const addFieldToTable = (value: string) => {
      emit("add:table", value);
    };

    // Cross-linking: get all matching cross-links for a field
    const getCrossLinksForField = (fieldName: string): Array<{ name: string; resolvedUrl: string }> => {
      if (!store.state.zoConfig?.enable_cross_linking) return [];

      const crossLinks = searchObj.data.crossLinks;
      if (!crossLinks) return [];

      const { stream_links = [], org_links = [] } = crossLinks;

      const aliasToOriginal: Record<string, string> = {};
      for (const link of [...stream_links, ...org_links]) {
        for (const f of link.fields || []) {
          if (f.alias) aliasToOriginal[f.alias] = f.name;
        }
      }

      const originalFieldName = aliasToOriginal[fieldName] || fieldName;
      const fieldValue = rowData.value?.[fieldName];

      const streamCoveredFields = new Set<string>();
      for (const link of stream_links) {
        for (const f of link.fields || []) {
          if (f.alias) streamCoveredFields.add(f.name);
        }
      }

      const results: Array<{ name: string; resolvedUrl: string }> = [];

      for (const link of stream_links) {
        if (link.fields?.some((f: any) => f.name === originalFieldName && f.alias)) {
          const resolved = resolveCrossLinkUrl(link.url, originalFieldName, fieldValue);
          results.push({ name: link.name, resolvedUrl: resolved });
        }
      }

      if (!streamCoveredFields.has(originalFieldName)) {
        for (const link of org_links) {
          if (link.fields?.some((f: any) => f.name === originalFieldName && f.alias)) {
            const resolved = resolveCrossLinkUrl(link.url, originalFieldName, fieldValue);
            results.push({ name: link.name, resolvedUrl: resolved });
          }
        }
      }

      return results;
    };

    const resolveCrossLinkUrl = (
      urlTemplate: string,
      fieldName: string,
      fieldValue: any,
    ): string => {
      const startTime = searchObj.data.datetime?.startTime || 0;
      const endTime = searchObj.data.datetime?.endTime || 0;
      const query = searchObj.data.crossLinkQuery || searchObj.data.query || "";

      return urlTemplate
        .replace(/\$\{field\.__name\}/g, encodeURIComponent(String(fieldName)))
        .replace(/\$\{field\.__value\}/g, encodeURIComponent(String(fieldValue ?? "")))
        .replace(/\$\{start_time\}/g, String(startTime))
        .replace(/\$\{end_time\}/g, String(endTime))
        .replace(/\$\{query\}/g, encodeURIComponent(query))
        .replace(/\$\{query_encoded\}/g, btoa(query));
    };

    const openCrossLink = (url: string) => {
      window.open(url, "_blank");
    };

    const viewTrace = () => {
      emit("view-trace");
    };

    const sendToAiChat = (value: any, append: boolean = true) => {
      emit("sendToAiChat", value, append);
      emit("closeTable");
    };

    const addSearchTerm = (
      field: string | number,
      fieldValue: string | number | boolean,
      action: string,
    ) => {
      emit("add:searchterm", field, fieldValue, action);
    };

    const closeTable = () => {
      emit("closeTable");
    };

    const getBtnLogo = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });

    const regexIcon = computed(() => {
      return getImageURL(
        store.state.theme == "dark"
          ? "images/regex_pattern/regex_icon_dark.svg"
          : "images/regex_pattern/regex_icon_light.svg",
      );
    });

    const createRegexPatternFromLogs = (key: string, value: any) => {
      emit("closeTable");
      const promptToBeAdded = `Create a regex pattern for ${key} field that contains the following value: "${value}" from the ${searchObj.data.stream.selectedStream[0]} stream`;
      router.push({
        path: "/settings/regex_patterns",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          from: "logs",
        },
      });
      store.state.organizationData.regexPatternPrompt = promptToBeAdded;
      store.state.organizationData.regexPatternTestValue = value;
      emit("sendToAiChat", promptToBeAdded);
    };

    const showCorrelation = () => {
      // Emit the original modelValue (not flattened rowData) as it has _timestamp
      emit("show-correlation", props.modelValue);
    };

    const getContentSize = (data: any): number => {
      if (data === null || data === undefined) return 0;
      if (typeof data === "string") return data.length;
      if (typeof data === "object") {
        try {
          return JSON.stringify(data).length;
        } catch {
          return 0;
        }
      }
      return String(data).length;
    };

    // Display-only: render the timestamp column in a human-readable format in
    // the user-selected timezone (same representation as the traces detail
    // sidebar). The raw value is kept intact for include/exclude search terms
    // and all other field actions.
    const getDisplayValue = (field: string | number, value: any): any => {
      if (
        field === store.state.zoConfig.timestamp_column &&
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !isNaN(Number(value))
      ) {
        return timestampToTimezoneDate(
          Number(value) / 1000,
          store.state.timezone,
          "MMM dd, yyyy HH:mm:ss.SSS ZZZ",
        );
      }
      return value;
    };

    return {
      t,
      store,
      router,
      rowData,
      tab,
      flattenJSONObject,
      selectedRelativeValue,
      recordSizeOptions,
      getImageURL,
      tableDropdownOpenMap,
      shouldWrapValues,
      toggleWrapLogDetails,
      copyContentToClipboard,
      addFieldToTable,
      getCrossLinksForField,
      openCrossLink,
      searchObj,
      multiStreamFields,
      viewTrace,
      hasAggregationQuery,
      sendToAiChat,
      addSearchTerm,
      closeTable,
      showCorrelation,
      statusColor,
      tableColumns,
      tableRows,
      serviceStreamsEnabled,
      config,
      getContentSize,
      getDisplayValue,
      getBtnLogo,
      regexIcon,
      createRegexPatternFromLogs,
    };
  },
  async created() {
    const newObj = await this.flattenJSONObject(this.modelValue, "");
    this.rowData = newObj;
  },
});
</script>

<style>
.full-height-panels .o-tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
