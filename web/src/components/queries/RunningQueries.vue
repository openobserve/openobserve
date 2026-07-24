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
  <OPageLayout
    v-if="isMetaOrg"
    :title="t('queries.runningQueries')"
    icon="query-stats"
    :subtitle="t('settings.queryManagementDesc')"
    bleed
  >
    <!-- Filters live in the sub-nav band directly above the table. -->
    <template #subnav>
      <div
        data-test="running-queries-filter-container"
        class="px-page-edge flex items-center justify-start gap-3 py-2"
      >
        <OToggleGroup
          :model-value="selectedQueryTypeTab"
          @update:model-value="onChangeQueryTab($event as 'summary' | 'all')"
          data-test="running-queries-query-type-tabs"
        >
          <OToggleGroupItem
            v-for="visual in runningQueryTypes"
            :key="visual.value"
            :value="visual.value"
            size="sm"
          >
            {{ visual.label }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="o2-select-input o2-input">
          <OSelect
            v-model="selectedSearchField"
            :options="searchFieldOptions"
            labelKey="label"
            valueKey="value"
            class="w-35 p-0"
            data-test="running-queries-search-fields-select"
            @update:model-value="filterQuery = ''"
          />
        </div>
        <OSearchInput
          v-if="selectedSearchField == 'all'"
          v-model="filterQuery"
          class="no-border o2-search-input"
          :placeholder="t('queries.search')"
          data-test="running-queries-search-input"
        />
        <div v-else class="o2-select-input o2-input w-62.5">
          <OSelect
            v-model="filterQuery"
            :placeholder="t('queries.selectOption')"
            :options="otherFieldOptions"
            labelKey="label"
            valueKey="value"
            class="no-border search-input w-62.5"
            data-test="running-queries-search-input"
          />
        </div>
      </div>
    </template>

    <div class="min-h-0 flex-1">
      <div class="h-full w-full">
        <div class="bg-card-glass-bg h-full">
          <div
            v-show="selectedQueryTypeTab === 'all'"
            class="h-full"
            data-test="running-queries-all-queries-list"
          >
            <RunningQueriesList
              :rows="rowsQuery"
              :filtered="!!filterQuery"
              :last-refreshed="lastRefreshed"
              :search-type="selectedSearchType"
              :search-types="searchTypes"
              :search-type-labels="searchTypeLabels"
              @update:search-type="onChangeSearchType"
              v-model:selectedRows="selectedRow['all']"
              @delete:query="confirmDeleteAction"
              @delete:queries="handleMultiQueryCancel"
              @show:schema="listSchema"
              @clear:filters="filterQuery = ''"
              @refresh="refreshData"
            />
          </div>
          <div
            v-show="selectedQueryTypeTab === 'summary'"
            class="h-full"
            data-test="running-queries-summary-list"
          >
            <SummaryList
              :rows="summaryRows"
              :filtered="!!filterQuery"
              :last-refreshed="lastRefreshed"
              v-model:selectedRows="selectedRow['summary']"
              @filter:queries="filterUserQueries"
              @delete:queries="handleMultiQueryCancel"
              @clear:filters="filterQuery = ''"
              @refresh="refreshData"
            />
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteQuery"
      @update:cancel="deleteDialog.show = false"
    />
    <ODrawer
      bleed
      v-model:open="showListSchemaDialog"
      size="xl"
      :show-close="false"
      data-test="list-schema-dialog"
      @close="showListSchemaDialog = false"
    >
      <QueryList :schemaData="schemaData" @close="showListSchemaDialog = false" />
    </ODrawer>
  </OPageLayout>
</template>

<script lang="ts">
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import SearchService from "@/services/search";
import { onBeforeMount, ref, defineComponent, computed, toRaw, watch } from "vue";

import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import QueryList from "@/components/queries/QueryList.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { durationFormatter } from "@/utils/zincutils";
import RunningQueriesList from "./RunningQueriesList.vue";
import SummaryList from "./SummaryList.vue";
import { getDuration } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

export default defineComponent({
  name: "RunningQueries",
  components: {
    OPageLayout,
    QueryList,
    ConfirmDialog,
    RunningQueriesList,
    SummaryList,
    OToggleGroup,
    OToggleGroupItem,
    ODrawer,
    OSelect,
    OSearchInput,
  },
  setup() {
    const store = useStore();
    const schemaData = ref({});
    const lastRefreshed = ref("");
    const { isMetaOrg } = useIsMetaOrg();
    const resultTotal = ref<number>(0);
    const selectedRow = ref<{
      all: any[];
      summary: any[];
    }>({
      all: [],
      summary: [],
    });

    const searchFieldOptions = ref([
      { label: "All Fields", value: "all" },
      { label: "Exec. Duration", value: "exec_duration" },
      { label: "Query Range", value: "query_range" },
    ]);

    const selectedQueryTypeTab = ref<"summary" | "all">("summary");

    const selectedSearchType = ref("dashboards");
    const searchTypes = ["dashboards", "ui", "Others"]; // UI, Dashboards, Reports, Alerts, Values, Other, RUM, DerivedStream,
    const searchTypeLabels: Record<string, string> = {
      dashboards: "Dashboards",
      ui: "UI",
      Others: "Others",
    };

    const runningQueryTypes = [
      { label: "User Summary", value: "summary" },
      { label: "All Queries", value: "all" },
    ];
    const selectedSearchField = ref(searchFieldOptions.value[0].value);

    const refreshData = () => {
      getRunningQueries();
      lastRefreshed.value = getCurrentTime();
    };

    /**
     * Function to calculate the total number of queries, total duration, and total time range
     */
    const getRunningQueriesSummary = () => {
      try {
        const result = queries.value.reduce((acc: { [key: string]: any }, query: any) => {
          const {
            trace_id,
            user_id,
            search_type,
            search_type_label,
            created_at,
            query: { start_time, end_time },
          } = query;

          const key = `${user_id}-${search_type_label}`;

          if (!acc[key]) {
            acc[key] = {
              row_id: key,
              user_id: user_id,
              numOfQueries: 0,
              duration: 0,
              queryRange: 0,
              search_type,
              search_type_label: search_type_label,
              trace_ids: [],
              created_at,
              query: { end_time, start_time },
            };
          }

          if (acc[key].created_at > created_at) {
            acc[key].created_at = created_at;
          }

          if (acc[key].query.start_time > start_time) {
            acc[key].query.start_time = start_time;
          }

          if (acc[key].query.end_time < end_time) {
            acc[key].query.end_time = end_time;
          }

          acc[key].trace_ids.push(trace_id);

          acc[key].numOfQueries += 1;

          if (created_at) {
            acc[key].duration += getDuration(created_at).durationInSeconds;
          }

          acc[key].queryRange += queryRange(start_time, end_time).queryRangeInSeconds;

          return acc;
        }, {});

        return Object.values(result).map((user: any) => ({
          ...user,
          duration: user.duration,
          queryRange: user.queryRange,
        }));
      } catch (error) {
        console.error("Error in getRunningQueriesSummary", error);
        return [];
      }
    };

    // Convert result object to array
    // Function to get current time in a desired format
    const getCurrentTime = () => {
      const now = new Date();
      const year = now.getFullYear().toString().padStart(4, "0");
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const day = now.getDate().toString().padStart(2, "0");
      const hours = now.getHours().toString().padStart(2, "0");
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const seconds = now.getSeconds().toString().padStart(2, "0");
      const timezone = store.state.timezone;

      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timezone}`;
    };

    const loadingState = ref(false);
    const queries = ref([]);

    const deleteDialog = ref({
      show: false,
      title: "Delete Running Query",
      message: "Are you sure you want to delete this running query?",
      data: null as any,
    });

    const { t } = useI18n();
    const showListSchemaDialog = ref(false);

    const listSchema = (row: any) => {
      //pass whole props.row to schemaData
      schemaData.value = row;

      showListSchemaDialog.value = true;
    };

    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];
    const selectedPerPage = ref(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
    };
    const filterQuery = ref("");

    const localTimeToMicroseconds = () => {
      // Create a Date object representing the current local time
      var date = new Date();

      // Get the timestamp in milliseconds
      var timestampMilliseconds = date.getTime();

      // Convert milliseconds to microseconds
      var timestampMicroseconds = timestampMilliseconds * 1000;

      return timestampMicroseconds;
    };

    //different between start and end time to show in UI as queryRange
    const queryRange = (startTime: number, endTime: number) => {
      const queryDuration = Math.floor((endTime - startTime) / 1000000);

      return {
        queryRangeInSeconds: queryDuration,
        duration: durationFormatter(queryDuration),
      };
    };

    const getDurationInSeconds = (queries: Array<{ createdAt: number }>) => {
      const currentTime = localTimeToMicroseconds();
      const totalDurationInSeconds = queries.reduce((acc, query) => {
        const duration = Math.floor((currentTime - query.createdAt) / 1000000);
        return acc + duration;
      }, 0);

      const averageDuration = totalDurationInSeconds / queries.length;

      return durationFormatter(averageDuration); // You can also return the total if needed
    };

    const getGroupedQueryRange = (queries: Array<{ startTime: number; endTime: number }>) => {
      const totalQueryDuration = queries.reduce((acc, query) => {
        const queryDuration = Math.floor((query.endTime - query.startTime) / 1000000);
        return acc + queryDuration;
      }, 0);

      const averageQueryDuration = totalQueryDuration / queries.length;

      return durationFormatter(averageQueryDuration); // You can also return the total if needed
    };

    const columns = ref<
      { name: string; label: string; field: string; align?: string; sortable?: boolean }[]
    >([
      {
        name: "user_id",
        field: "user_id",
        label: t("user.email"),
        align: "left",
        sortable: true,
      },
      {
        name: "org_id",
        field: "org_id",
        label: t("organization.id"),
        align: "left",
        sortable: true,
      },
      {
        name: "duration",
        label: t("queries.duration"),
        align: "left",
        sortable: true,
        field: "duration",
      },
      {
        name: "queryRange",
        label: t("queries.queryRange"),
        align: "left",
        sortable: true,
        field: "queryRange",
      },
      {
        name: "work_group",
        label: t("queries.queryType"),
        align: "left",
        sortable: true,
        field: "work_group",
      },
      {
        name: "status",
        field: "status",
        label: t("queries.status"),
        align: "left",
        sortable: true,
      },
      {
        name: "stream_type",
        field: "stream_type",
        label: t("alerts.streamType"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("common.actions"),
        align: "center",
      },
    ]);

    onBeforeMount(() => {
      getRunningQueries();
      lastRefreshed.value = getCurrentTime();
    });

    // Watcher to filter queries based on user_id
    const filteredQueries = ref([]);

    const runningQueriesSummary = ref<any[]>([]);

    const baseFilteredQueries = computed(() =>
      selectedQueryTypeTab.value === "all" ? queries.value : runningQueriesSummary.value,
    );

    const searchTypeFiltered = computed(() =>
      baseFilteredQueries.value.filter(
        (query) =>
          (selectedQueryTypeTab.value === "all" && filterQueryBySearchTypeTab(query)) ||
          selectedQueryTypeTab.value === "summary",
      ),
    );

    const fieldFiltered = computed(() => {
      if (!filterQuery.value) return searchTypeFiltered.value;
      return searchTypeFiltered.value.filter((query) =>
        Object.values(filterQueryCriteria).some((criteria) => criteria(query, filterQuery.value)),
      );
    });

    const filteredRows = computed(() => {
      if (selectedSearchField.value === "all") {
        return fieldFiltered.value;
      } else {
        const currentTime = Date.now() * 1000; // Convert current time to microseconds

        const timeMap: any = {
          gt_1s: 1 * 1000000, // greater than 1 second
          gt_5s: 5 * 1000000, // greater than 5 seconds
          gt_15s: 15 * 1000000, // greater than 15 seconds
          gt_30s: 30 * 1000000, // greater than 30 seconds
          gt_1m: 1 * 60 * 1000000, // 1 minute
          gt_5m: 5 * 60 * 1000000, // 5 minutes
          gt_10m: 10 * 60 * 1000000, // 10 minutes
          gt_15m: 15 * 60 * 1000000, // 15 minutes
          gt_30m: 30 * 60 * 1000000, // 30 minutes
          gt_1h: 60 * 60 * 1000000, // 1 hour
          gt_5h: 5 * 60 * 60 * 1000000, // 5 hours
          gt_10h: 10 * 60 * 60 * 1000000, // 10 hours
          gt_1d: 24 * 60 * 60 * 1000000, // 1 day
          gt_1w: 7 * 24 * 60 * 60 * 1000000, // 1 week
          gt_1M: 30 * 24 * 60 * 60 * 1000000, // 1 month (approx.)
        };

        return baseFilteredQueries.value.filter((item: any) => {
          const timeDifference =
            selectedSearchField.value == "exec_duration"
              ? currentTime - item.created_at
              : item.query.end_time - item.query.start_time;

          if (filterQuery.value.startsWith("lt_")) {
            return timeDifference < timeMap[filterQuery.value];
          } else if (filterQuery.value.startsWith("gt_")) {
            return timeDifference > timeMap[filterQuery.value];
          } else {
            return true; // If the filter is not recognized, return all items
          }
        });
      }
    });

    const filterQueryBySearchTypeTab = (query: any) => {
      return (
        query?.search_type?.toLowerCase().includes(selectedSearchType.value.toLowerCase()) ||
        query?.search_type_label?.toLowerCase().includes(selectedSearchType.value.toLowerCase())
      );
    };

    const filterQueryCriteria = {
      user_id: (query: any, value: string) =>
        query?.user_id?.toLowerCase().includes(value.toLowerCase()),
      org_id: (query: any, value: string) =>
        query?.org_id?.toLowerCase().includes(value.toLowerCase()),
      stream_type: (query: any, value: string) =>
        query?.stream_type?.toLowerCase().includes(value.toLowerCase()),
      status: (query: any, value: string) =>
        query?.status?.toLowerCase().includes(value.toLowerCase()),
      trace_id: (query: any, value: string) =>
        query?.trace_id?.toLowerCase().includes(value.toLowerCase()),
      work_group: (query: any, value: string) =>
        query?.work_group?.toLowerCase().includes(value.toLowerCase()),
      search_type: (query: any, value: string) =>
        query?.search_type?.toLowerCase().includes(value.toLowerCase()),
      search_type_label: (query: any, value: string) =>
        query?.search_type_label?.toLowerCase().includes(value.toLowerCase()),
    };

    watch(
      () => selectedSearchField.value,
      () => {
        filterQuery.value = "";
      },
    );

    const otherFieldOptions = computed(() => {
      if (selectedSearchField.value === "exec_duration") {
        return [
          { label: "> 1 second", value: "gt_1s" },
          { label: "> 5 seconds", value: "gt_5s" },
          { label: "> 15 seconds", value: "gt_15s" },
          { label: "> 30 seconds", value: "gt_30s" },
          { label: "> 1 minute", value: "gt_1m" },
          { label: "> 5 minutes", value: "gt_5m" },
          { label: "> 10 minutes", value: "gt_10m" },
        ];
      } else if (selectedSearchField.value === "query_range") {
        return [
          { label: "> 5 minutes", value: "gt_5m" },
          { label: "> 10 minutes", value: "gt_10m" },
          { label: "> 15 minutes", value: "gt_15m" },
          { label: "> 1 hour", value: "gt_1h" },
          { label: "> 1 day", value: "gt_1d" },
          { label: "> 1 week", value: "gt_1w" },
          { label: "> 1 Month", value: "gt_1M" },
        ];
      }

      return [];
    });

    // Watcher to filter queries based on user_id
    watch(filterQuery, () => {
      // Update the result total based on the filtered array length
      resultTotal.value = filteredRows.value.length;
    });

    const getRunningQueries = () => {
      const dismiss = toast({
        message: "Fetching running queries...",
        variant: "loading",
        timeout: 0,
      });
      SearchService.get_running_queries(store.state.zoConfig.meta_org)
        .then((response: any) => {
          queries.value = response?.data?.status.map((query: any) => {
            // we add search_type_label as there are 6 search types defined in the backend, but we only show 3 in the UI
            // Dashboards, UI and Others
            return {
              ...query,
              search_type_label:
                query.search_type === "dashboards" || query.search_type === "ui"
                  ? query.search_type
                  : "Others",
            };
          });

          resultTotal.value = queries.value.length;

          runningQueriesSummary.value = getRunningQueriesSummary();
        })
        .catch((error: any) => {
          toast({
            message: error.response?.data?.message || "Failed to fetch running queries",
            variant: "error",
          });
        })
        .finally(() => {
          dismiss();
        });
    };

    const deleteQuery = () => {
      SearchService.delete_running_queries(store.state.zoConfig.meta_org, deleteDialog.value.data)
        .then(() => {
          selectedRow.value[selectedQueryTypeTab.value] = [];

          getRunningQueries();

          toast({
            message: "Query cancelled",
            variant: "info",
          });
        })
        .catch((error: any) => {
          toast({
            message: error.response?.data?.message || "Failed to cancel query",
            variant: "error",
          });
        })
        .finally(() => {
          deleteDialog.value.show = false;
          deleteDialog.value.data = [];
        });
    };

    const confirmDeleteAction = (row: any) => {
      deleteDialog.value.data = [row.trace_id];
      deleteDialog.value.show = true;
    };

    const handleMultiQueryCancel = (traceIds: string[] | null = null) => {
      if (!traceIds) {
        deleteDialog.value.data = selectedRow.value[selectedQueryTypeTab.value].reduce(
          (acc: any, row: any) => {
            if (row.trace_id) {
              acc.push(row.trace_id);
            } else {
              // If query tab is "Summary", then add all trace_ids ( we store trace_id of all queries in trace_ids key )
              acc.push(...row.trace_ids);
            }
            return acc;
          },
          [],
        );
      } else {
        deleteDialog.value.data = traceIds;
      }

      deleteDialog.value.show = true;
    };

    const summaryRows = computed(function () {
      const rows = toRaw(filteredRows.value) ?? [];

      rows.sort((a: any, b: any) => b.created_at - a.created_at);

      return rows.map((row: any) => {
        return {
          ...row,
        };
      });
    });

    const rowsQuery = computed(function () {
      const rows = toRaw(filteredRows.value) ?? [];

      rows.sort((a: any, b: any) => b.created_at - a.created_at);

      return rows.map((row: any) => {
        const search_type = row?.search_type;
        var query_source = "-unknown-";

        if (search_type === "dashboards") {
          query_source =
            row?.search_event_context?.folder_name +
            "/" +
            row?.search_event_context?.dashboard_name;
        } else if (search_type == "alerts") {
          query_source =
            row?.search_event_context?.alert_name +
            "(" +
            row?.search_event_context?.alert_key +
            ")";
        }

        return {
          user_id: row?.user_id,
          org_id: row?.org_id,
          duration: getDuration(row.created_at).durationInSeconds,
          queryRange: queryRange(row?.query?.start_time, row?.query?.end_time).queryRangeInSeconds,
          status: row?.status,
          work_group: row?.work_group,
          stream_type: row?.stream_type,
          actions: "true",
          trace_id: row?.trace_id,
          created_at: row?.created_at,
          started_at: row?.started_at,
          sql: row?.query?.sql,
          start_time: row?.query?.start_time,
          end_time: row?.query?.end_time,
          files: row?.scan_stats?.files,
          records: row?.scan_stats?.records,
          original_size: row?.scan_stats?.original_size,
          compressed_size: row?.scan_stats?.compressed_size,
          search_type: row?.search_type,
          search_type_label: row?.search_type_label,
          query_source: query_source,
        };
      });
    });

    const onChangeQueryTab = (tab: "summary" | "all") => {
      selectedQueryTypeTab.value = tab;
    };

    const onChangeSearchType = (value: string) => {
      selectedSearchType.value = value;
    };

    const filterUserQueries = (row: any) => {
      selectedQueryTypeTab.value = "all";
      selectedSearchField.value = "all";
      selectedSearchType.value = row.search_type_label;
      filterQuery.value = row.user_id;
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "runningQueriesRefresh",
        handler: () => {
          if (!isInputFocused()) refreshData();
        },
      },
      {
        id: "runningQueriesFocusSearch",
        handler: () => {
          focusSearchInput("running-queries-search-input");
        },
      },
    ]);

    return {
      t,
      store,
      queries,
      columns,
      getRunningQueries,
      deleteQuery,
      confirmDeleteAction,
      deleteDialog,
      perPageOptions,
      listSchema,
      showListSchemaDialog,
      filterQuery,
      changePagination,
      cancel: "cancel",
      schemaData,
      loadingState,
      refreshData,
      lastRefreshed,
      isMetaOrg,
      resultTotal,
      selectedPerPage,
      rowsQuery,
      filteredQueries,
      selectedRow,
      handleMultiQueryCancel,
      selectedSearchField,
      searchFieldOptions,
      otherFieldOptions,
      pagination,
      runningQueryTypes,
      selectedQueryTypeTab,
      onChangeQueryTab,
      runningQueriesSummary,
      onChangeSearchType,
      searchTypes,
      searchTypeLabels,
      selectedSearchType,
      filterUserQueries,
      summaryRows,
      // Additional functions for testing
      getRunningQueriesSummary,
      getCurrentTime,
      localTimeToMicroseconds,
      getDuration,
      queryRange,
      getDurationInSeconds,
      getGroupedQueryRange,
      baseFilteredQueries,
      searchTypeFiltered,
      fieldFiltered,
      filteredRows,
      filterQueryBySearchTypeTab,
      filterQueryCriteria,
    };
  },
});
</script>
