<template>
  <div class="w-full h-full flex flex-col min-h-0">
    <div v-if="!showSearchResults" class="h-full flex flex-col min-h-0">
      <AppPageHeader
        :title="t('search_scheduler_job.title')"
        icon="schedule"
        :back="{ onClick: closeSearchHistory }"
        class="shrink-0 px-4 border-b border-border-default"
      >
        <template #actions>
          <div class="flex items-center gap-1">
            <OTableColumnToggle
              :columns="columnsToBeRendered"
              :column-visibility="columnVisibility"
              @update:column-visibility="setColumnVisibility"
            />
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              class=""
              :loading="isLoading"
              data-test="search-scheduler-get-jobs-btn"
              @click="fetchSearchHistory"
            >
              <OTooltip side="bottom" :content="t('search_scheduler_job.get_jobs')" shortcut-id="searchSchedulersRefresh" />
            </OButton>
          </div>
        </template>
      </AppPageHeader>
      <div class="card-container flex-1 min-h-0 overflow-hidden">
          <OTable
            :frame="false"
            data-test="search-scheduler-table"
            :data="dataToBeLoaded"
            :columns="columnsToBeRendered"
            :column-visibility="columnVisibility"
            row-key="trace_id"
            :loading="isLoading"
            pagination="client"
            expansion="single"
            :expand-on-row-click="true"
            v-model:expanded-ids="expandedIds"
            @update:expanded-ids="onExpandedIdsChange"
            :show-global-filter="false"
            :default-columns="false"
          >
            <template #cell-user_id="{ row }">
              <OUserCell :value="row.user_id" />
            </template>
            <template #cell-created_at="{ row }">
              <OTimeCell
                :value="row.toBeCreatedAt"
                unit="us"
                :timezone="store.state.timezone"
              />
            </template>
            <template #cell-start_time="{ row }">
              <OTimeCell
                :value="row.toBeStoredStartTime"
                unit="us"
                :timezone="store.state.timezone"
              />
            </template>
            <template #cell-status="{ row }">
              <OTag type="queryStatus" :value="getStatusText(row.status)" />
            </template>
            <template #cell-actions="{ row }">
              <OButton
                data-test="search-scheduler-cancel-btn"
                data-row-action="pause"
                variant="ghost"
                size="icon-sm"
                icon-left="cancel"
                :title="t('search_scheduler_job.cancel')"
                :disabled="
                  row.status_code !== 0 &&
                  row.status_code !== 1
                "
                @click="confirmCancelJob(row)"
              />

              <OButton
                data-test="search-scheduler-delete-btn"
                data-row-action="delete"
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                :title="t('search_scheduler_job.delete')"
                @click="confirmDeleteJob(row)"
              />
              <OButton
                data-test="search-scheduler-restart-btn"
                data-row-action="resume"
                variant="ghost"
                size="icon-sm"
                icon-left="refresh"
                :title="t('search_scheduler_job.restart')"
                :disabled="
                  row.status_code !== 2 &&
                  row.status_code !== 3
                "
                @click="retrySearchJob(row)"
              />
              <OButton
                data-test="search-scheduler-explore-btn"
                data-row-action="view"
                variant="ghost"
                size="icon-sm"
                icon-left="search"
                :title="t('search_scheduler_job.explore')"
                :disabled="
                  row.status_code == 0 || row.status_code == 3
                "
                @click="fetchSearchResults(row)"
              />
            </template>
            <template #expansion="{ row }">
              <div class="app-tabs-schedule-list report-list-tabs">
                <app-tabs
                  data-test="expanded-list-tabs"
                  class="mr-3"
                  :tabs="tabs"
                  v-model:active-tab="activeTab"
                />
              </div>
              <div v-if="activeTab == 'query'">
                <div class="text-left px-2 mb-2 expanded-content">
                  <div class="flex items-center py-2">
                    <strong
                      >{{ t('search_scheduler_job.sql_query') }} :
                      <span>
                        <OButton
                          variant="ghost"
                          size="icon"
                          class="copy-btn-sql ml-2"
                          data-test="search-scheduler-copy-sql-btn"
                          @click.stop="copyToClipboard(row.sql, { successMessage: `${t('logs.searchSchedulersList.sqlQuery')} ${t('search_scheduler_job.copy_success')}`, timeout: 5000 })"
                        >
                          <OIcon name="content-copy" size="sm" />
                        </OButton></span
                    ></strong>
                    <OButton
                      variant="ghost-destructive"
                      size="sm"
                      class="copy-btn mx-2"
                      data-test="search-scheduler-go-to-logs-btn"
                      :disabled="
                        row.status_code == 0 ||
                        row.status_code == 3
                      "
                      @click.stop="fetchSearchResults(row)"
                      icon-left="search"
                    >
                      {{ t('search_scheduler_job.logs') }}
                    </OButton>
                  </div>
                  <div class="flex items-start justify-center">
                    <div class="scrollable-content expanded-sql">
                      <pre style="text-wrap: wrap">{{ row?.sql }}</pre>
                    </div>
                  </div>
                </div>
                <div
                  v-if="row?.function"
                  class="text-left mb-2 px-2 expanded-content"
                >
                  <div class="flex items-center py-2">
                    <strong
                      >{{ t('search_scheduler_job.function_definition') }} :
                      <span>
                        <OButton
                          variant="ghost"
                          size="icon"
                          class="copy-btn-function ml-2"
                          @click.stop="copyToClipboard(row.function, { successMessage: `${t('logs.searchSchedulersList.functionDefinationCopy')} ${t('search_scheduler_job.copy_success')}`, timeout: 5000 })"
                        >
                          <OIcon name="content-copy" size="sm" />
                        </OButton></span
                    ></strong>
                  </div>

                  <div class="flex items-start justify-center">
                    <div class="scrollable-content expanded-function">
                      <pre style="text-wrap: wrap">{{ row?.function }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <div class="py-3" v-else>
                <div
                  class="text-left px-2 mb-2 expanded-content flex flex-col"
                >
                  <query-editor
                    style="height: 130px"
                    :key="row.trace_id"
                    :ref="`QueryEditorRef${row.trace_id}`"
                    :editor-id="`alerts-query-editor${row.trace_id}`"
                    :debounceTime="300"
                    v-model:query="query"
                    language="json"
                    read-only
                  />
                </div>
              </div>
            </template>
            <template #bottom>
              <div class="flex items-center justify-between w-full h-[48px]">
                <div class="o2-table-footer-title flex items-center w-[100px] mr-md">
                  {{ resultTotal }} {{ t('search_scheduler_job.results') }}
                </div>
                <div class="ml-auto mr-2">{{ t('search_scheduler_job.max_limit') }} : <b>1000</b></div>
              </div>
            </template>
            <template #empty>
              <div v-if="!isLoading" class="flex w-full">
                <OEmptyState size="hero" preset="no-search-jobs" />
              </div>
            </template>
          </OTable>
        <ConfirmDialog
          :title="t('search_scheduler_job.delete_job_title')"
          :message="t('search_scheduler_job.delete_job_message')"
          @update:ok="deleteSearchJob"
          @update:cancel="confirmDelete = false"
          v-model="confirmDelete"
        />
        <ConfirmDialog
          :title="t('search_scheduler_job.cancel_job_title')"
          :message="t('search_scheduler_job.cancel_job_message')"
          @update:ok="cancelSearchJob"
          @update:cancel="confirmCancel = false"
          v-model="confirmCancel"
        />
      </div>
    </div>
  </div>

  <!-- Empty state is rendered via OEmptyState in the table #empty slot -->
</template>
<script lang="ts">

//@ts-nocheck
import {
  ref,
  watch,
  onMounted,
  nextTick,
  computed,
  onBeforeMount,
  onActivated,
} from "vue";
import {
  timestampToTimezoneDate,
  b64EncodeUnicode,
  b64DecodeUnicode,
  convertDateToTimestamp,
} from "@/utils/zincutils";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { defineAsyncComponent, defineComponent, reactive } from "vue";
import { searchState } from "@/composables/useLogs/searchState";
import TenstackTable from "../../plugins/logs/TenstackTable.vue";
import searchService from "@/services/search";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import DateTime from "@/components/DateTime.vue";
import { useI18n } from "vue-i18n";
import { convertUnixToDateFormat } from "@/utils/date";
import type { Ref } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AppTabs from "@/components/common/AppTabs.vue";

import JsonPreview from "./JsonPreview.vue";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import { useShortcuts, getManager } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "SearchSchedulersList",
  components: {
    DateTime,
    OEmptyState,
    OTable,
    OTableColumnToggle,
    OTimeCell,
    OUserCell,
    OTag,
    TenstackTable,
    ConfirmDialog,
    AppTabs,
    JsonPreview,
    OButton,
    OTooltip,
    OSpinner,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    OIcon,
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
    const confirmDelete = ref(false);
    const toBeDeletedJob = ref({});

    const searchDateTimeRef = ref(null);
    const { searchObj } = searchState();
    const dataToBeLoaded: any = ref([]);
    const dateTimeToBeSent = ref({
      valueType: "relative",
      relativeTimePeriod: "15m",
      startTime: 0,
      endTime: 0,
    });
    const columnsToBeRendered = ref<OTableColumnDef[]>([]);
    const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(
      "logs-search-schedulers-list",
    );
    const expandedIds = ref<string[]>([]);
    const isLoading = ref(false);
    const isDateTimeChanged = ref(false);
    const showSearchResults = ref(false);
    const toBeCancelled = ref({});
    const confirmCancel = ref(false);
    const activeTab = ref("query");
    const query = ref("");

    const pageSize = ref(100);
    const pageSizeOptions = [5, 10, 20, 50, 100];
    const tabs = reactive([
      {
        label: t('search_scheduler_job.query_function'),
        value: "query",
        icon: "code",
      },
      {
        label: t('search_scheduler_job.more_details'),
        value: "more_details",
        icon: "info",
      },
    ]);

    // onMounted(async ()=>{
    //   await fetchSearchHistory();
    // })

    const resultTotal = ref<number>(0);

    const generateColumns = (data: any): OTableColumnDef[] => {
      if (data && data.length === 0) return [];

      return [
        { id: "user_id", header: t('search_scheduler_job.user_id'), accessorKey: "user_id", sortable: true, hideable: true, size: COL.owner, meta: { align: "left", autoWidth: true } },
        { id: "created_at", header: t('search_scheduler_job.created_at'), accessorKey: "created_at", sortable: true, hideable: true, size: COL.createdAt, meta: { align: "left" } },
        { id: "start_time", header: t('search_scheduler_job.start_time'), accessorKey: "start_time", sortable: true, hideable: true, size: COL.date, meta: { align: "left" } },
        { id: "duration", header: t('search_scheduler_job.duration'), accessorKey: "duration", sortable: false, hideable: true, size: COL.duration, meta: { align: "left" } },
        { id: "status", header: t('search_scheduler_job.status'), accessorKey: "status", cell: " ", sortable: false, hideable: true, size: COL.status, meta: { align: "left" } },
        { id: "actions", header: t('search_scheduler_job.actions'), isAction: true, size: 120, meta: { align: "center", cellClass: "actions-column", actionCount: 4 } },
      ];
    };

    function filterRow(row) {
      const desiredColumns = [
        { key: "trace_id", label: "Trace ID" },
        { key: "start_time", label: "Start Time" },

        { key: "end_time", label: "End Time" },
        { key: "started_at", label: "Job Started At" },
        { key: "ended_at", label: "Job Ended At" },
      ];
      return desiredColumns.reduce((filtered, column) => {
        if (row[column.key] !== undefined) {
          filtered[column.key] = row[column.key];
        }
        return filtered;
      }, {});
    }

    const fetchSearchHistory = async () => {
      if (config.isEnterprise == "false") {
        return;
      }

      try {
        const { org_identifier } = router.currentRoute.value.query;
        // columnsToBeRendered.value = [];
        // dataToBeLoaded.value = [];
        expandedIds.value = [];
        query.value = "";
        isLoading.value = true;
        let responseToBeFetched = [];
        searchService
          .get_scheduled_search_list({
            org_identifier: store.state.selectedOrganization.identifier,
          })
          .then((res) => {
            responseToBeFetched = res.data;
            resultTotal.value = res.data.length;

            columnsToBeRendered.value = generateColumns(responseToBeFetched[0]);

            responseToBeFetched.forEach((element) => {
              const { formatted, raw } = calculateDuration(
                element.start_time,
                element.end_time,
              );

              element.rawDuration = raw;

              element["duration"] = formatted;
              element.toBeStoredStartTime = element.start_time;
              element.toBeStoredEndTime = element.end_time;
              element.toBeCreatedAt = element.created_at;
              element.start_time = convertUnixToDateFormat(
                element.start_time,
              );
              element.end_time = convertUnixToDateFormat(element.end_time);
              element.created_at = convertUnixToDateFormat(
                element.created_at,
              );
              element.started_at = convertUnixToDateFormat(
                element.started_at,
              );
              element.ended_at = convertUnixToDateFormat(element.ended_at);
              element.status_code = element.status;
              element["sql"] = JSON.parse(element.payload).query.sql;

              if (JSON.parse(element.payload).query.query_fn) {
                element["function"] = b64DecodeUnicode(
                  JSON.parse(element.payload).query.query_fn,
                );
              }
            });

            dataToBeLoaded.value = responseToBeFetched;
            isLoading.value = false;
          })
          .catch((e) => {
            if (e.response.status != 403) {
              toast({
                variant: "error",
                message: t('search_scheduler_job.fetch_failed'),
                timeout: 5000,
              });
            }
          })
          .finally(() => {
            isLoading.value = false;
          });
      } catch (error) {
        if (error.response.status != 403) {
          toast({
            variant: "error",
            message: t('search_scheduler_job.fetch_failed'),
            timeout: 5000,
          });
        }
        isLoading.value = false;
      }
    };
    //this method needs to revamped / can be made shorter
    const cancelSearchJob = () => {
      searchService
        .cancel_scheduled_search({
          org_identifier: store.state.selectedOrganization.identifier,
          jobId: toBeCancelled.value.id,
        })
        .then((res) => {
          toast({
            variant: "success",
            message: t('search_scheduler_job.job_cancelled_success'),
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_cancel_failed'),
            });
          }
        })
        .finally(() => {
          fetchSearchHistory();
        });
    };
    const retrySearchJob = (row) => {
      searchService
        .retry_scheduled_search({
          org_identifier: store.state.selectedOrganization.identifier,
          jobId: row.id,
        })
        .then((res) => {
          toast({
            variant: "success",
            message: t('search_scheduler_job.job_restarted_success'),
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_restart_failed'),
            });
          }
        })
        .finally(() => {
          fetchSearchHistory();
        });
    };
    const confirmDeleteJob = (row) => {
      confirmDelete.value = true;
      toBeDeletedJob.value = row;
    };
    const confirmCancelJob = (row) => {
      confirmCancel.value = true;
      toBeCancelled.value = row;
    };
    const deleteSearchJob = () => {
      searchService
        .delete_scheduled_search({
          org_identifier: store.state.selectedOrganization.identifier,
          jobId: toBeDeletedJob.value.id,
        })
        .then((res) => {
          fetchSearchHistory();
          toast({
            variant: "success",
            message: t('search_scheduler_job.job_deleted_success'),
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            toast({
              variant: "error",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_delete_failed'),
            });
          }
        })
        .finally(() => {
          fetchSearchHistory();
        });
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
        result = t('logs.searchSchedulersList.durationSeconds', { n: durationSeconds.toFixed(2) });
      } else if (durationSeconds < 3600) {
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        result = t('logs.searchSchedulersList.durationMinutes', { n: minutes });
        if (seconds > 0) {
          result += t('logs.searchSchedulersList.durationAndSeconds', { n: seconds.toFixed(2) });
        }
      } else if (durationSeconds < 86400) {
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        result = t('logs.searchSchedulersList.durationHours', { n: hours });
        if (minutes > 0) {
          result += t('logs.searchSchedulersList.durationAndMinutes', { n: minutes });
        }
      } else if (durationSeconds < 2592000) {
        const days = Math.floor(durationSeconds / 86400);
        const hours = Math.floor((durationSeconds % 86400) / 3600);
        result = t('logs.searchSchedulersList.durationDays', { n: days });
        if (hours > 0) {
          result += t('logs.searchSchedulersList.durationAndHours', { n: hours });
        }
      } else if (durationSeconds < 31536000) {
        const months = Math.floor(durationSeconds / 2592000);
        const days = Math.floor((durationSeconds % 2592000) / 86400);
        result = t('logs.searchSchedulersList.durationMonths', { n: months });
        if (days > 0) {
          result += t('logs.searchSchedulersList.durationAndDays', { n: days });
        }
      } else {
        const years = Math.floor(durationSeconds / 31536000);
        const months = Math.floor((durationSeconds % 31536000) / 2592000);
        result = t('logs.searchSchedulersList.durationYears', { n: years });
        if (months > 0) {
          result += t('logs.searchSchedulersList.durationAndMonths', { n: months });
        }
      }

      return { formatted: result, raw: rawDuration };
    };

    const onExpandedIdsChange = (ids: string[]) => {
      expandedIds.value = ids;
      const expandedId = ids[0];
      if (!expandedId) {
        query.value = "";
        return;
      }
      const row = dataToBeLoaded.value.find((r: any) => r.trace_id === expandedId);
      if (row) {
        query.value = JSON.stringify(filterRow(row), null, 2);
      }
    };
    const goToLogs = (row) => {
      const duration_suffix = row.duration.split(" ")[1];
      const from = row.toBeStoredStartTime;
      const to = row.toBeStoredEndTime;
      const refresh = 0;

      const query = b64EncodeUnicode(row.sql);
      const rawStreamNames = JSON.parse(row.stream_names);
      const stream_name =
        rawStreamNames.length > 1
          ? rawStreamNames.join(",")
          : rawStreamNames[0];
      const queryObject = {
        stream_type: row.stream_type ?? "logs",
        stream: stream_name,
        from: from,
        to: to,
        refresh,
        sql_mode: "true",
        query,
        defined_schemas: "user_defined_schema",
        org_identifier: row.org_id,
        quick_mode: "false",
        show_histogram: "false",
        type: "search_scheduler",
      };
      //here if we have function then we are adding fn_editor flag as true because it will open the function editor by default
      //else we are adding fn_editor flag as false because it will close the function editor by default
      if (row.hasOwnProperty("function") && row.function) {
        const functionContent = b64EncodeUnicode(row.function);
        queryObject["functionContent"] = functionContent;
        queryObject["fn_editor"] = "true";
      }
      else{
        queryObject["fn_editor"] = "false";
      }

      toast({
        variant: "success",
        message: t('search_scheduler_job.job_applied_success'),
      });

      router.push({
        path: "/logs",
        query: queryObject,
      });
    };
    watch(
      () => props.isClicked,
      (value) => {
        // v-show sub-view of the Logs page: own the keyboard scope only while visible.
        getManager()?.setScope(value ? "search-schedulers" : "logs");
        if (value && !isLoading.value) {
          fetchSearchHistory();
        }
      },
    );
    const getStatusText = (status) => {
      switch (status) {
        case 0:
          return t('search_scheduler_job.status_pending');
        case 1:
          return t('search_scheduler_job.status_running');
        case 2:
          return t('search_scheduler_job.status_finished');
        case 3:
          return t('search_scheduler_job.status_cancelled');
        default:
          return t('search_scheduler_job.status_unknown');
      }
    };

    const getStatusIcon = (status) => {
      switch (status) {
        case 0:
          return "hourglass-empty"; // Icon for pending
        case 1:
          return "pause"; // Icon for running (pause-circle isn't in OIcon registry)
        case 2:
          return "check-circle"; // Icon for finished
        case 3:
          return "cancel"; // Icon for cancelled
        default:
          return "help"; // Icon for unknown
      }
    };
    // OIcon doesn't accept a `color` prop; map status → Tailwind text-color class
    // applied via :class on the OIcon instead.
    const getStatusColorClass = (status) => {
      switch (status) {
        case 0:
          return "text-orange-500"; // Pending
        case 1:
          return "text-blue-500"; // Running
        case 2:
          return "text-green-500"; // Finished
        case 3:
          return "text-red-500"; // Cancelled
        default:
          return "text-gray-500"; // Unknown
      }
    };
    const getStatusColor = (status) => {
      switch (status) {
        case 0:
          return "orange"; // Pending color
        case 1:
          return "blue"; // Running color
        case 2:
          return "green"; // Finished color
        case 3:
          return "gray"; // Cancelled color
        default:
          return "gray"; // Unknown color
      }
    };

    const fetchSearchResults = (row) => {
      searchObj.meta.jobId = row.id;
      goToLogs(row);
    };
    useShortcuts([
      { id: "searchSchedulersRefresh", handler: () => { if (!isInputFocused()) fetchSearchHistory(); } },
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
      columnVisibility,
      setColumnVisibility,
      config,
      t,
      route,
      isLoading,
      updateDateTime,
      pageSize,
      pageSizeOptions,
      searchDateTimeRef,
      expandedIds,
      goToLogs,
      onExpandedIdsChange,
      copyToClipboard,
      formatTime,
      delayMessage,
      resultTotal,
      getStatusText,
      getStatusIcon,
      getStatusColor,
      getStatusColorClass,
      showSearchResults,
      fetchSearchResults,
      cancelSearchJob,
      retrySearchJob,
      deleteSearchJob,
      toBeDeletedJob,
      confirmDelete,
      confirmDeleteJob,
      tabs,
      activeTab,
      filterRow,
      query,
      confirmCancelJob,
      toBeCancelled,
      confirmCancel,
      calculateDuration,
      convertUnixToDateFormat,
      dateTimeToBeSent,
      isDateTimeChanged,
      router,
    };
    // Watch the searchObj for changes
  },
});
</script>
