<template>
  <div class="tw:w-full tw:h-full tw:flex tw:flex-col tw:min-h-0">
    <AppPageHeader
      :title="t('search_history.title')"
      icon="history"
      :back="{ onClick: closeSearchHistory }"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
          <OButton
            data-test="search-history-wrap-content-btn"
            variant="ghost"
            size="icon"
            class="wrap-content-btn"
            :class="{ 'wrap-content-btn--active': wrapText }"
            @click="wrapText = !wrapText"
          >
            <OIcon name="wrap-text" size="sm" />
            <OTooltip :content="t('search.messageWrapContent')" />
          </OButton>
          <div
            class="warning-text tw:flex tw:items-center tw:px-2 tw:h-[36px] tw:rounded-md"
          >
            <OIcon name="info" class="tw:mr-1" size="sm" />
            <div>
              {{ t("search_history.delayMessage") }} <b>{{ delayMessage }}</b>
            </div>
          </div>
          <div>
            <date-time
              data-test-name="search-history-date-time"
              ref="searchDateTimeRef"
              auto-apply
              menu-align="end"
              :default-type="searchObj.data.datetime.type"
              @on:date-change="updateDateTime"
            />
          </div>

          <div>
            <OButton
              variant="primary"
              size="sm"
              @click="fetchSearchHistory"
              :disabled="isLoading"
            >
              {{ t("search_history.get_history") }}
            </OButton>
          </div>
      </template>
    </AppPageHeader>
    <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
          <OTable
            :frame="false"
            :data="dataToBeLoaded"
            :columns="columnsToBeRendered"
            row-key="uuid"
            :loading="isLoading"
            pagination="client"
            :page-size="pageSize"
            :page-size-options="pageSizeOptions"
            sorting="client"
            expansion="single"
            :expand-on-row-click="true"
            v-model:expanded-ids="expandedIds"
            :show-global-filter="false"
            :default-columns="false"
            :wrap="wrapText"
            :horizontal-scroll="!wrapText"
            width="100%"
            @update:expanded-ids="onExpandedIdsChange"
          >
            <template #cell-sql="{ row }">
              <span>{{ row.sql }}</span>
            </template>

            <template #expansion="{ row }">
              <div class="app-tabs-container tw:w-fit tw:my-1">
                <app-tabs
                  data-test="expanded-list-tabs"
                  class="tabs-selection-container"
                  :tabs="tabs"
                  v-model:active-tab="activeTab"
                />
              </div>
              <div v-show="activeTab === 'query'">
                <div class="tw:text-left tw:px-2 tw:mb-2 expanded-content">
                  <div class="tw:flex tw:items-center tw:py-2 tw:gap-2">
                    <strong
                      >SQL Query :
                      <span>
                        <OButton
                          variant="ghost"
                          size="icon"
                          class="copy-btn-sql tw:ml-2"
                          @click.stop="
                            copyToClipboard(row.sql, { successMessage: 'SQL Query Copied Successfully!', timeout: 5000 })
                          "
                        >
                          <OIcon name="content-copy" size="sm" /> </OButton></span
                    ></strong>
                    <OButton
                      variant="outline-destructive"
                      size="chip"
                      class="copy-btn tw:mx-2"
                      @click.stop="goToLogs(row)"
                    >
                      <template #icon-left
                        ><OIcon name="search" size="sm"
                      /></template>
                      Logs
                    </OButton>
                    <OButton
                      v-if="
                        config.isEnterprise == 'true' &&
                        config.isCloud == 'false' &&
                        store.state.zoConfig.search_inspector_enabled
                      "
                      variant="ghost"
                      size="sm"
                      class="copy-btn"
                      @click.stop="goToInspector(row)"
                    >
                      <template #icon-left
                        ><OIcon name="analytics" size="sm"
                      /></template>
                      Inspect
                    </OButton>
                  </div>
                  <div class="tw:flex tw:items-start tw:justify-center">
                    <div class="scrollable-content expanded-sql">
                      <pre style="text-wrap: wrap">{{ row?.sql }}</pre>
                    </div>
                  </div>
                </div>
                <div
                  v-if="row?.function"
                  class="tw:text-left tw:mb-2 tw:px-2 expanded-content"
                >
                  <div class="tw:flex tw:items-center tw:py-2">
                    <strong
                      >Function Definition :
                      <span>
                        <OButton
                          variant="ghost"
                          size="icon"
                          class="copy-btn-function tw:ml-2"
                          @click.stop="
                            copyToClipboard(
                              row.function,
                              { successMessage: 'Function Defination Copied Successfully!', timeout: 5000 },
                            )
                          "
                        >
                          <OIcon name="content-copy" size="sm" /> </OButton></span
                    ></strong>
                  </div>

                  <div class="tw:flex tw:items-start tw:justify-center">
                    <div class="scrollable-content expanded-function">
                      <pre style="text-wrap: wrap">{{ row?.function }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <query-editor
                v-show="activeTab === 'more_details'"
                style="height: 200px"
                :ref="`QueryEditorRef${row.trace_id + row.sql}`"
                :editor-id="`search-query-editor${row.trace_id + row.sql}`"
                class="monaco-editor"
                :debounceTime="600"
                v-model:query="moreDetailsToDisplay"
                language="json"
                read-only
              />
            </template>

            <template #empty>
              <div v-if="!isLoading" class="tw:flex tw:w-full">
                <OEmptyState size="hero" preset="no-search-history" />
              </div>
            </template>

            <template #bottom>
              <div
                class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]"
              >
                <div
                  class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md"
                >
                  {{ resultTotal }} {{ t("search_history.results") }}
                </div>
                <div class="tw:ml-auto tw:mr-2">Max Limit : <b>1000</b></div>
              </div>
            </template>
          </OTable>
    </div>
  </div>

  <!-- Show NoData component if there's no data to display -->
</template>
<script lang="ts">
//@ts-nocheck
import { ref, watch, onMounted, nextTick, computed, onUnmounted } from "vue";
import {
  timestampToTimezoneDate,
  b64EncodeUnicode,
  convertDateToTimestamp,
  getUUID,
} from "@/utils/zincutils";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { defineAsyncComponent, defineComponent } from "vue";
import { searchState } from "@/composables/useLogs/searchState";
import TenstackTable from "../../plugins/logs/TenstackTable.vue";
import searchService from "@/services/search";
import NoData from "@/components/shared/grid/NoData.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import DateTime from "@/components/DateTime.vue";
import { useI18n } from "vue-i18n";
import AppTabs from "@/components/common/AppTabs.vue";

import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

import { logsUtils } from "@/composables/useLogs/logsUtils";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

export default defineComponent({
  name: "SearchHistoryComponent",
  components: {
    OEmptyState,
    DateTime,
    NoData,
    AppTabs,
    QueryEditor,
    OButton,
    OSpinner,
    OIcon,
    OTooltip,
    OTable,
    AppPageHeader,
},
  props: {
    isClicked: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["closeSearchHistory"],
  methods: {
    closeSearchHistory() {
      this.$emit("closeSearchHistory");
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const { t } = useI18n();
    const searchDateTimeRef = ref(null);
    const wrapText = ref(true);
    const { searchObj } = searchState();
    const dataToBeLoaded: any = ref([]);
    const dateTimeToBeSent = ref({
      valueType: "relative",
      relativeTimePeriod: "15m",
      startTime: 0,
      endTime: 0,
    });
    const columnsToBeRendered = ref<OTableColumnDef[]>([]);
    const expandedIds = ref<string[]>([]);
    const isLoading = ref(false);
    const isDateTimeChanged = ref(false);
    const moreDetailsToDisplay = ref("");

    const { extractTimestamps } = logsUtils();

    const activeTab = ref("query");
    const tabs = ref([
      {
        label: "Query / Function",
        value: "query",
        icon: "code",
      },
      {
        label: "More Details",
        value: "more_details",
        icon: "info",
      },
    ]);

    onUnmounted(() => {});

    const resultTotal = ref<number>(0);

    const pageSize = ref(100);
    const pageSizeOptions = [5, 10, 20, 50, 100];

    const generateColumns = (data: any): OTableColumnDef[] => {
      if (data.length === 0) return [];
      return [
        {
          id: "executed_time",
          header: t("search_history.executed_at"),
          accessorKey: "executed_time",
          sortable: true,
          size: COL.createdAt,
          meta: { align: "left" },
        },
        {
          id: "sql",
          header: t("search_history.sql_query"),
          accessorKey: "sql",
          cell: " ",
          sortable: true,
          meta: { align: "left", autoWidth: true },
        },
      ];
    };

    const fetchSearchHistory = async () => {
      columnsToBeRendered.value = [];
      dataToBeLoaded.value = [];
      expandedIds.value = [];
      moreDetailsToDisplay.value = "";
      try {
        const { org_identifier } = router.currentRoute.value.query;
        isLoading.value = true;
        if (dateTimeToBeSent.value.valueType === "relative") {
          const convertedData = extractTimestamps(
            dateTimeToBeSent.value.relativeTimePeriod,
          );
          dateTimeToBeSent.value.startTime = convertedData.from * 1000;
          dateTimeToBeSent.value.endTime = convertedData.to * 1000;
        }
        const { startTime, endTime } = dateTimeToBeSent.value;

        //check if datetime is present or not
        //else show the error message
        if (!startTime) {
          toast({
            variant: "error",
            message:
              "The selected start time is  invalid. Please choose a valid time",
            timeout: 5000,
          });
          isLoading.value = false;
          return;
        }
        if (!endTime) {
          toast({
            variant: "error",
            message:
              "The selected end time is  invalid. Please choose a valid time",
            timeout: 5000,
          });
          isLoading.value = false;
          return;
        }

        const response = await searchService.get_history(
          org_identifier,
          startTime,
          endTime,
        );
        const limitedHits = response.data.hits;
        const filteredHits = limitedHits.filter(
          (hit) => hit.event === "Search",
        );
        if (filteredHits.length > 0) {
          resultTotal.value = filteredHits.length;
        }
        columnsToBeRendered.value = generateColumns(filteredHits);
        filteredHits.forEach((hit: any) => {
          //adding uuid to each which will be used to track the expanded "row"
          //why not trace_id ? because trace_id is not unique for each hit
          //and it can be same for multiple hits
          hit.uuid = getUUID();
          const { formatted, raw } = calculateDuration(
            hit.start_time,
            hit.end_time,
          );
          hit.duration = formatted;
          hit.rawDuration = raw;
          hit.toBeStoredStartTime = hit.start_time;
          hit.toBeStoredEndTime = hit.end_time;
          hit.start_time = timestampToTimezoneDate(
            hit.start_time / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS",
          );
          hit.end_time = timestampToTimezoneDate(
            hit.end_time / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS",
          );
          hit.rawTook = hit.took;
          hit.took = formatTime(hit.took);
          hit.rawScanRecords = hit.scan_records;
          hit.scan_records = hit.scan_records;
          hit.rawScanSize = hit.scan_size;
          hit.scan_size = hit.scan_size + hit.unit;
          hit.cached_ratio = hit.cached_ratio;
          hit.rawCachedRatio = hit.cached_ratio;
          hit.sql = hit.sql;
          hit.function = hit.function;
          hit.rawExecutedTime = hit._timestamp;
          hit.executed_time = timestampToTimezoneDate(
            hit._timestamp / 1000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS",
          );
        });
        dataToBeLoaded.value = filteredHits;
        isLoading.value = false;
      } catch (error) {
        toast({
          variant: "error",
          message: "Failed to fetch search history. Please try again later.",
          timeout: 5000,
        });
        console.log(error, "error");
        isLoading.value = false;
      } finally {
        isLoading.value = false;
      }
    };
    const delayMessage = computed(() => {
      const delay = store.state.zoConfig.usage_publish_interval;
      if (delay <= 60) {
        return "60 seconds";
      } else {
        const minutes = Math.floor(delay / 60);
        return `${minutes} minute(s)`;
      }
    });

    const updateDateTime = async (value: any) => {
      const { startTime, endTime } = value;
      dateTimeToBeSent.value = value;
      searchDateTimeRef.value.setAbsoluteTime(value.startTime, value.endTime);
    };
    const formatTime = (took) => {
      return `${took.toFixed(2)} sec`;
    };
    const calculateDuration = (startTime, endTime) => {
      const durationMicroseconds = endTime - startTime;
      const durationSeconds = durationMicroseconds / 1e6;

      // Store the raw duration in a separate property
      const rawDuration = durationSeconds;

      let result = "";

      if (durationSeconds < 60) {
        result = `${durationSeconds.toFixed(2)} seconds`;
      } else if (durationSeconds < 3600) {
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        result = `${minutes} minutes`;
        if (seconds > 0) {
          result += ` and ${seconds.toFixed(2)} seconds`;
        }
      } else if (durationSeconds < 86400) {
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        result = `${hours} hours`;
        if (minutes > 0) {
          result += ` and ${minutes} minutes`;
        }
      } else if (durationSeconds < 2592000) {
        const days = Math.floor(durationSeconds / 86400);
        const hours = Math.floor((durationSeconds % 86400) / 3600);
        result = `${days} days`;
        if (hours > 0) {
          result += ` and ${hours} hours`;
        }
      } else if (durationSeconds < 31536000) {
        const months = Math.floor(durationSeconds / 2592000);
        const days = Math.floor((durationSeconds % 2592000) / 86400);
        result = `${months} months`;
        if (days > 0) {
          result += ` and ${days} days`;
        }
      } else {
        const years = Math.floor(durationSeconds / 31536000);
        const months = Math.floor((durationSeconds % 31536000) / 2592000);
        result = `${years} years`;
        if (months > 0) {
          result += ` and ${months} months`;
        }
      }

      return { formatted: result, raw: rawDuration };
    };

    const onExpandedIdsChange = (ids: string[]) => {
      expandedIds.value = ids;
      const expandedId = ids[0];
      if (!expandedId) {
        moreDetailsToDisplay.value = "";
        return;
      }
      const row = dataToBeLoaded.value.find((r: any) => r.uuid === expandedId);
      if (row) {
        moreDetailsToDisplay.value = JSON.stringify(filterRow(row), null, 2);
      }
    };
    const goToLogs = (row) => {
      const duration_suffix = row.duration.split(" ")[1];
      // emit('closeSearchHistory');
      const stream: string = row.stream_name;
      const from = row.toBeStoredStartTime;
      const to = row.toBeStoredEndTime;
      const refresh = 0;

      const query = b64EncodeUnicode(row.sql);

      const queryObject = {
        stream_type: "logs",
        stream,
        period: "15m",
        refresh,
        sql_mode: "true",
        query,
        defined_schemas: "user_defined_schema",
        org_identifier: row.org_id,
        quick_mode: "false",
        show_histogram: "true",
        type: "search_history_re_apply",
      };
      //here if we have function then we are adding fn_editor flag as true because it will open the function editor by default
      //else we are adding fn_editor flag as false because it will close the function editor by default
      if (row.hasOwnProperty("function") && row.function) {
        const functionContent = b64EncodeUnicode(row.function);
        queryObject["functionContent"] = functionContent;
        queryObject["fn_editor"] = "true";
      } else {
        queryObject["fn_editor"] = "false";
      }

      router.push({
        path: "/logs",
        query: queryObject,
      });
    };

    const goToInspector = (row) => {
      const rawTraceId = row.trace_id as string;
      const trace_id = rawTraceId.includes("-")
        ? rawTraceId.split("-")[0]
        : rawTraceId;
      const queryObject = {
        trace_id,
        org_identifier: row.org_id,
      };

      router.push({
        path: "/logs/inspector",
        query: queryObject,
      });
    };
    watch(
      () => props.isClicked,
      (value) => {
        if (value == true && !isLoading.value) {
          fetchSearchHistory();
        }
      },
    );

    function filterRow(row) {
      const desiredColumns = [
        { key: "trace_id", label: "Trace ID" },
        { key: "start_time", label: "Start Time" },
        { key: "end_time", label: "End Time" },
        { key: "duration", label: "Duration" },
        { key: "took", label: "Took" },
        { key: "scan_size", label: "Scan Size" },
        { key: "scan_records", label: "Scan Records" },
        { key: "cached_ratio", label: "Cached Ratio" },
      ];
      return desiredColumns.reduce((filtered, column) => {
        if (row[column.key] !== undefined) {
          filtered[column.key] = row[column.key];
        }
        return filtered;
      }, {});
    }
    return {
      searchObj,
      store,
      generateColumns,
      fetchSearchHistory,
      dataToBeLoaded,
      columnsToBeRendered,
      t,
      route,
      isLoading,
      updateDateTime,
      searchDateTimeRef,
      expandedIds,
      goToLogs,
      goToInspector,
      onExpandedIdsChange,
      copyToClipboard,
      formatTime,
      delayMessage,
      resultTotal,
      pageSize,
      pageSizeOptions,
      activeTab,
      tabs,
      moreDetailsToDisplay,
      wrapText,
      config,
    };
    // Watch the searchObj for changes
  },
});
</script>
<style lang="scss" scoped>
@import "@/styles/logs/search-history.scss";
</style>
