<template>
  <OPageLayout
    :title="t('search_history.title')"
    icon="history"
    :back="{ onClick: closeSearchHistory }"
    bleed
  >
      <template #actions>
          <OButton
            data-test="search-history-wrap-content-btn"
            variant="ghost"
            size="icon"
            class="h-6! min-h-6! w-[1.45rem]! p-0! m-0 border-[0.0626rem]! border-solid! border-card-glass-border! rounded-default! [transition:all_0.2s_ease] backdrop-blur-[0.625rem]! flex! items-center! justify-center!"
            :class="
              wrapText
                ? 'bg-theme-accent! text-white hover:opacity-85'
                : 'bg-white/10! hover:bg-white/15!'
            "
            @click="wrapText = !wrapText"
          >
            <OIcon name="wrap-text" size="sm" />
            <OTooltip :content="t('search.messageWrapContent')" />
          </OButton>
          <div
            class="text-status-warning-text border border-status-warning-text flex items-center px-2 h-9 rounded-default"
          >
            <OIcon name="info" class="mr-1" size="sm" />
            <div>
              {{ t("search_history.delayMessage") }} <b>{{ delayMessage }}</b>
            </div>
          </div>
          <div class="[&_#date-time-button]:h-9!">
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
              variant="outline"
              size="icon-sm"
              class="h-9! w-9!"
              icon-left="refresh"
              :loading="isLoading"
              data-test="search-history-get-history-btn"
              @click="fetchSearchHistory"
            >
              <OTooltip side="bottom" :content="t('search_history.get_history')" shortcut-id="searchHistoryRefresh" />
            </OButton>
          </div>
      </template>
    <div class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
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
            <template #cell-executed_time="{ row }">
              <OTimeCell
                :value="row.rawExecutedTime"
                unit="us"
                mode="absolute"
                :timezone="store.state.timezone"
              />
            </template>

            <template #cell-sql="{ row }">
              <span class="text-text-body">{{ row.sql }}</span>
            </template>

            <template #expansion="{ row }">
              <!-- px-4 matches the SQL/Function/More-Details blocks below so the
                   tabs line up with the query content instead of sitting flush
                   to the cell edge (same inset the scheduler list uses). -->
              <div class="app-tabs-container w-fit my-1 px-4">
                <app-tabs
                  data-test="expanded-list-tabs"
                  class="tabs-selection-container"
                  :tabs="tabs"
                  v-model:active-tab="activeTab"
                />
              </div>
              <div v-show="activeTab === 'query'">
                <div class="text-left mb-2 px-4 py-0 w-[calc(95vw-2.5rem)] min-w-[calc(90vw-1.25rem)] max-h-screen overflow-hidden">
                  <div class="flex items-center py-2 gap-2">
                    <strong
                      >{{ t('logs.searchHistory.sqlQueryLabel') }}
                      <span>
                        <!-- Copy is a neutral action in both sections; the SQL/VRL
                             accent lives on the block's left border, which marks
                             which language you're looking at. -->
                        <OButton
                          data-test="search-history-copy-sql-btn"
                          variant="outline"
                          size="icon-chip"
                          class="ml-2"
                          @click.stop="
                            copyToClipboard(row.sql, { successMessage: t('logs.searchHistory.sqlQueryCopied'), timeout: 5000 })
                          "
                        >
                          <OIcon name="content-copy" size="xs" /> </OButton></span
                    ></strong>
                    <!-- Logs and Inspect are both navigations, so they share one
                         variant and size. -->
                    <!-- No mx-2: the row is already `gap-2`, so a margin here
                         stacked on top of it and doubled the spacing to 16px. -->
                    <OButton
                      data-test="search-history-go-to-logs-btn"
                      variant="outline"
                      size="chip"
                      @click.stop="goToLogs(row)"
                    >
                      <template #icon-left
                        ><OIcon name="search" size="xs"
                      /></template>
                      {{ t('logs.searchHistory.logs') }}
                    </OButton>
                    <OButton
                      v-if="
                        config.isEnterprise == 'true' &&
                        config.isCloud == 'false' &&
                        store.state.zoConfig.search_inspector_enabled
                      "
                      data-test="search-history-inspect-btn"
                      variant="outline"
                      size="chip"
                      @click.stop="goToInspector(row)"
                    >
                      <template #icon-left
                        ><OIcon name="analytics" size="xs"
                      /></template>
                      {{ t('logs.searchHistory.inspect') }}
                    </OButton>
                  </div>
                  <div class="flex items-start justify-center">
                    <div
                      class="w-full overflow-y-auto p-2.5 h-full max-h-50 border border-border-default border-l-3 border-l-sql-accent bg-surface-subtle text-text-body o2-colorized-query"
                    >
                      <!-- Monaco-colorized SQL (sanitized in colorizeRow), same
                           as the dashboard Query Inspector. Falls back to plain
                           text for the frame before colorize resolves, and if
                           Monaco throws (colorizeQuery escapes on failure). -->
                      <pre
                        v-if="colorizedSql[row.uuid]"
                        class="font-mono text-compact leading-[1.6] m-0 whitespace-pre-wrap break-words"
                        data-test="search-history-sql-colorized"
                        v-html="colorizedSql[row.uuid]"
                      ></pre>
                      <pre v-else class="font-mono text-compact leading-[1.6] m-0 whitespace-pre-wrap break-words">{{ row?.sql }}</pre>
                    </div>
                  </div>
                </div>
                <div
                  v-if="row?.function"
                  class="text-left mb-2 px-4 py-0 w-[calc(95vw-2.5rem)] min-w-[calc(90vw-1.25rem)] max-h-screen overflow-hidden"
                >
                  <div class="flex items-center py-2">
                    <strong
                      >{{ t('logs.searchHistory.functionDefinitionLabel') }}
                      <span>
                        <!-- Same neutral copy affordance as the SQL block above. -->
                        <OButton
                          data-test="search-history-copy-function-btn"
                          variant="outline"
                          size="icon-chip"
                          class="ml-2"
                          @click.stop="
                            copyToClipboard(
                              row.function,
                              { successMessage: t('logs.searchHistory.functionDefinitionCopied'), timeout: 5000 },
                            )
                          "
                        >
                          <OIcon name="content-copy" size="xs" /> </OButton></span
                    ></strong>
                  </div>

                  <div class="flex items-start justify-center">
                    <div
                      class="w-full overflow-y-auto p-2.5 h-full max-h-50 border border-border-default border-l-3 border-l-function-accent bg-surface-subtle text-text-body o2-colorized-query"
                    >
                      <pre
                        v-if="colorizedFunction[row.uuid]"
                        class="font-mono text-compact leading-[1.6] m-0 whitespace-pre-wrap break-words"
                        data-test="search-history-function-colorized"
                        v-html="colorizedFunction[row.uuid]"
                      ></pre>
                      <pre v-else class="font-mono text-compact leading-[1.6] m-0 whitespace-pre-wrap break-words">{{ row?.function }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <!-- px-4 keeps the More Details editor aligned with the tabs and
                   the query blocks above. -->
              <div v-show="activeTab === 'more_details'" class="px-4">
                <query-editor
                  style="height: 200px"
                  :ref="`QueryEditorRef${row.trace_id + row.sql}`"
                  :editor-id="`search-query-editor${row.trace_id + row.sql}`"
                  :debounceTime="600"
                  v-model:query="moreDetailsToDisplay"
                  language="json"
                  read-only
                />
              </div>
            </template>

            <template #empty>
              <div v-if="!isLoading" class="flex w-full">
                <OEmptyState size="hero" preset="no-search-history" />
              </div>
            </template>

            <template #bottom>
              <div
                class="flex items-center justify-between w-full h-12"
              >
                <div
                  class="text-xs font-normal flex items-center w-25 mr-md"
                >
                  {{ resultTotal }} {{ t("search_history.results") }}
                </div>
                <div class="ml-auto mr-2">{{ t('logs.searchHistory.maxLimit') }} <b>1000</b></div>
              </div>
            </template>
          </OTable>
    </div>
  </OPageLayout>

  <!-- Show NoData component if there's no data to display -->
</template>
<script lang="ts">
//@ts-nocheck
import { ref, watch, onMounted, computed, onUnmounted } from "vue";
import {
  timestampToTimezoneDate,
  b64EncodeUnicode,
  getUUID,
} from "@/utils/zincutils";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { defineAsyncComponent, defineComponent } from "vue";
import { searchState } from "@/composables/useLogs/searchState";
import searchService from "@/services/search";
import DOMPurify from "dompurify";
import { colorizeQuery } from "@/utils/query/colorizeQuery";
import NoData from "@/components/shared/grid/NoData.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import DateTime from "@/components/DateTime.vue";
import { useI18n } from "vue-i18n";
import AppTabs from "@/components/common/AppTabs.vue";

import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useShortcuts, getManager } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

import { logsUtils } from "@/composables/useLogs/logsUtils";
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
    AppTabs,
    QueryEditor,
    OButton,
    OIcon,
    OTooltip,
    OTable,
    OTimeCell,
    OPageLayout,
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
  setup(props) {
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
    const moreDetailsToDisplay = ref("");

    const { extractTimestamps } = logsUtils();

    const activeTab = ref("query");
    const tabs = ref([
      {
        label: t("logs.searchHistory.queryFunctionTab"),
        value: "query",
        icon: "code",
      },
      {
        label: t("logs.searchHistory.moreDetailsTab"),
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
          size: COL.dateAbsolute,
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
            message: t("logs.searchHistory.invalidStartTime"),
            timeout: 5000,
          });
          isLoading.value = false;
          return;
        }
        if (!endTime) {
          toast({
            variant: "error",
            message: t("logs.searchHistory.invalidEndTime"),
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
          hit.rawScanSize = hit.scan_size;
          hit.scan_size = hit.scan_size + hit.unit;
          hit.rawCachedRatio = hit.cached_ratio;
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
          message: t("logs.searchHistory.fetchFailed"),
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
        return t("logs.searchHistory.sixtySeconds");
      } else {
        const minutes = Math.floor(delay / 60);
        return t("logs.searchHistory.minutes", { minutes });
      }
    });

    const updateDateTime = async (value: any) => {
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

    /* Monaco-colorized SQL / VRL for the expanded row, keyed by row uuid — the
       same treatment the dashboard Query Inspector gives its queries. Colorizing
       is async and only the expanded row is ever visible, so it runs on expand
       rather than up-front for every row. */
    const colorizedSql = ref<Record<string, string>>({});
    const colorizedFunction = ref<Record<string, string>>({});

    const colorizeRow = async (row: any) => {
      if (!row?.uuid) return;
      if (row.sql && colorizedSql.value[row.uuid] === undefined) {
        colorizedSql.value[row.uuid] = DOMPurify.sanitize(
          await colorizeQuery(row.sql, "sql"),
        );
      }
      if (row.function && colorizedFunction.value[row.uuid] === undefined) {
        colorizedFunction.value[row.uuid] = DOMPurify.sanitize(
          await colorizeQuery(row.function, "vrl"),
        );
      }
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
        colorizeRow(row);
      }
    };
    const goToLogs = (row) => {
      // emit('closeSearchHistory');
      const stream: string = row.stream_name;
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
      if (
        Object.prototype.hasOwnProperty.call(row, "function") &&
        row.function
      ) {
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
        // This is a v-show sub-view of the Logs page: only own the keyboard
        // scope while actually visible, otherwise hand it back to the logs page.
        getManager()?.setScope(value ? "search-history" : "logs");
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
    useShortcuts([
      { id: "searchHistoryRefresh", handler: () => { if (!isInputFocused()) fetchSearchHistory(); } },
    ]);
    // useShortcuts activates this sub-view's scope on mount, but it mounts while
    // hidden inside the Logs page — restore the logs scope until it's shown.
    onMounted(() => {
      if (!props.isClicked) getManager()?.setScope("logs");
    });
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
      colorizedSql,
      colorizedFunction,
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

<style scoped>
/* keep(generated-content): Monaco's colorize() injects .mtkN token spans via
   v-html, so these can't be template utilities. Every colour but .mtk1 comes
   from Monaco's own global stylesheet; .mtk1 is its default-text token, which
   we point back at the block's own colour so the query inherits our theme
   instead of Monaco's. Mirrors dashboards/QueryInspector.vue. */
.o2-colorized-query :deep(.mtk1) {
  color: inherit;
}
</style>
