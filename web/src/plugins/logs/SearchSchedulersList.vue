<template>
  <div
   class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs"
  >
    <div v-if="!showSearchResults" class="tw:h-full">
       <div class="flex tw:justify-between tw:items-center tw:h-[68px] card-container tw:mb-[0.625rem]">
        <div class="flex items-center q-py-sm q-pl-md">
          <div
            data-test="search-scheduler-back-btn"
            class="flex justify-center items-center q-mr-md cursor-pointer"
            style="
              border: 1.5px solid;
              border-radius: 50%;
              width: 22px;
              height: 22px;
            "
            title="Go Back"
            @click="closeSearchHistory"
          >
            <q-icon name="arrow_back_ios_new" size="14px" />
          </div>
          <div class="text-h6 tw:font-[600]" data-test="search-scheduler-title">
            {{ t('search_scheduler_job.title') }}
          </div>
        </div>
        <div class="flex items-center q-py-sm q-pr-md">
          <div>
            <q-btn
              :label="t('search_scheduler_job.get_jobs')"
              @click="fetchSearchHistory"
              class="q-ml-md o2-primary-button tw:h-[36px] tw:rounded-md"
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
              no-caps
              flat
              dense
              :disable="isLoading"
            />
          </div>
        </div>
      </div>

   <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
      <div class=" tw:h-[calc(100vh-128px)] card-container">
          <q-table
            data-test="search-scheduler-table"
            ref="qTableSchedule"
            dense
            :rows="dataToBeLoaded"
            :columns="columnsToBeRendered"
            :pagination="pagination"
            row-key="trace_id"
            :rows-per-page-options="[]"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            :style="dataToBeLoaded.length > 0 ? 'height: calc(100vh - 128px); overflow-y: auto;' : 'height: 0px'"
            :sort-method="sortMethod"
          >
            <template v-slot:body="props">
              <q-tr
                :data-test="`search-scheduler-table-${props.row.trace_id}-row`"
                :props="props"
                style="cursor: pointer"
                @click="triggerExpand(props)"
              >
                <q-td>
                  <q-btn
                    data-test="search-scheduler-expand-btn"
                    dense
                    flat
                    size="xs"
                    :icon="
                      expandedRow != props.row.trace_id
                        ? 'expand_more'
                        : 'expand_less'
                    "
                  />
                </q-td>

                <q-td
                  v-for="(col, index) in columnsToBeRendered.slice(1)"
                  :key="col.name"
                  :props="props"
                >
                  <!-- Render the content for all but the last item -->
                  <template
                    v-if="
                      index < columnsToBeRendered.slice(1).length - 1 &&
                      col.field != 'status'
                    "
                  >
                    {{ props.row[col.field] }}
                  </template>
                  <template v-else-if="col.field === 'status'">
                    <div class="status-cell">
                      <q-icon
                        :name="getStatusIcon(props.row[col.field])"
                        size="xs"
                        class="q-mr-xs"
                        :color="getStatusColor(props.row[col.field])"
                      />
                      {{ getStatusText(props.row[col.field]) }}
                    </div>
                  </template>
                  <template v-else>
                    <q-btn
                      data-test="search-scheduler-cancel-btn"
                      icon="cancel"
                      :title="t('search_scheduler_job.cancel')"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      flat
                      :disable="
                        props.row.status_code !== 0 &&
                        props.row.status_code !== 1
                      "
                      color="gray"
                      @click="confirmCancelJob(props.row)"
                    ></q-btn>

                    <q-btn
                      data-test="search-scheduler-delete-btn"
                      icon="delete"
                      :title="t('search_scheduler_job.delete')"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      color="red"
                      flat
                      @click="confirmDeleteJob(props.row)"
                    ></q-btn>
                    <q-btn
                      data-test="search-scheduler-restart-btn"
                      icon="refresh"
                      :title="t('search_scheduler_job.restart')"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      color="orange"
                      flat
                      :disable="
                        props.row.status_code !== 2 &&
                        props.row.status_code !== 3
                      "
                      @click="retrySearchJob(props.row)"
                    ></q-btn>
                    <q-btn
                      data-test="search-scheduler-explore-btn"
                      icon="search"
                      :title="t('search_scheduler_job.explore')"
                      class="q-ml-xs"
                      padding="sm"
                      unelevated
                      size="sm"
                      round
                      :disable="
                        props.row.status_code == 0 || props.row.status_code == 3
                      "
                      flat
                      color="green"
                      @click="fetchSearchResults(props.row)"
                    ></q-btn>
                  </template>
                </q-td>
              </q-tr>

              <q-tr v-show="expandedRow === props.row.trace_id" :props="props">
                <q-td colspan="100%">
                  <div class="app-tabs-schedule-list report-list-tabs">
                    <app-tabs
                      data-test="expanded-list-tabs"
                      class="q-mr-md"
                      :tabs="tabs"
                      v-model:active-tab="activeTab"
                    />
                  </div>
                  <div v-if="activeTab == 'query'">
                    <div class="text-left tw:px-2 q-mb-sm expanded-content">
                      <div class="tw:flex tw:items-center q-py-sm">
                        <strong
                          >{{ t('search_scheduler_job.sql_query') }} :
                          <span>
                            <q-btn
                              @click.stop="
                                copyToClipboard(props.row.sql, 'SQL Query')
                              "
                              data-test="search-scheduler-copy-sql-btn"
                              size="xs"
                              dense
                              flat
                              icon="content_copy"
                              class="copy-btn-sql tw:ml-2 tw:py-2 tw:px-2" /></span
                        ></strong>
                        <q-btn
                          @click.stop="fetchSearchResults(props.row)"
                          data-test="search-scheduler-go-to-logs-btn"
                          size="xs"
                          :label="t('search_scheduler_job.logs')"
                          dense
                          class="copy-btn tw:py-2 tw:mx-2 tw:px-2"
                          icon="search"
                          flat
                          style="
                            color: #f2452f;
                            border: #f2452f 1px solid;
                            font-weight: bolder;
                          "
                          :disable="
                            props.row.status_code == 0 ||
                            props.row.status_code == 3
                          "
                        />
                      </div>
                      <div class="tw:flex tw:items-start tw:justify-center">
                        <div class="scrollable-content expanded-sql">
                          <pre style="text-wrap: wrap">{{
                            props.row?.sql
                          }}</pre>
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="props.row?.function"
                      class="text-left q-mb-sm tw:px-2 expanded-content"
                    >
                      <div class="tw:flex tw:items-center q-py-sm">
                        <strong
                          >{{ t('search_scheduler_job.function_definition') }} :
                          <span>
                            <q-btn
                              @click.stop="
                                copyToClipboard(
                                  props.row.function,
                                  'Function Defination',
                                )
                              "
                              size="xs"
                              dense
                              flat
                              icon="content_copy"
                              class="copy-btn-function tw:ml-2 tw:py-2 tw:px-2" /></span
                        ></strong>
                      </div>

                      <div class="tw:flex tw:items-start tw:justify-center">
                        <div class="scrollable-content expanded-function">
                          <pre style="text-wrap: wrap">{{
                            props.row?.function
                          }}</pre>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="q-py-md" v-else>
                    <div
                      class="text-left tw:px-2 q-mb-sm expanded-content flex tw:flex-col"
                    >
                      <query-editor
                        style="height: 130px"
                        :key="props.row.trace_id"
                        :ref="`QueryEditorRef${props.row.trace_id}`"
                        :editor-id="`alerts-query-editor${props.row.trace_id}`"
                        class="monaco-editor"
                        :debounceTime="300"
                        v-model:query="query"
                        language="json"
                        read-only
                      />
                    </div>
                  </div>
                </q-td>
              </q-tr>
            </template>
            <template #bottom="scope">
            <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[150px] tw:mr-md">
              {{ resultTotal }} {{ t('search_scheduler_job.results') }}
            </div>
            <div class="tw:ml-auto tw:mr-2">{{ t('search_scheduler_job.max_limit') }} : <b>1000</b></div>
            <q-separator
              style="height: 1.5rem; margin: auto 0"
              vertical
              inset
              class="q-mr-md"
            />

            <div class="q-pl-md">
              <QTablePagination
                :scope="scope"
                :position="'bottom'"
                :resultTotal="resultTotal"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
            </div>
          </div>
          </template>
            <template #no-data>
              <div v-if="!isLoading" class="tw:flex tw:mx-auto">
                <NoData />
              </div>
              <div
                v-if="isLoading"
                class="text-center full-width full-height q-mt-lg tw:flex tw:justify-center"
              >
                <q-spinner-hourglass color="primary" size="lg" />
              </div>
            </template>
            <template v-slot:header="props">
            <q-tr :props="props">
              <!-- Rendering the of the columns -->
               <!-- here we can add the classes class so that the head will be sticky -->
              <q-th
                v-for="col in props.cols"
                :key="col.name"
                :props="props"
                :class="col.classes"
                :style="col.style"
              >
                {{ col.label }}
              </q-th>
            </q-tr>
          </template>
          </q-table>
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
  </div>

  <!-- Show NoData component if there's no data to display -->
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
import NoData from "@/components/shared/grid/NoData.vue";
import DateTime from "@/components/DateTime.vue";
import { useI18n } from "vue-i18n";
import { date, qTable, useQuasar } from "quasar";
import type { Ref } from "vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import JsonPreview from "./JsonPreview.vue";
import config from "@/aws-exports";

export default defineComponent({
  name: "SearchSchedulersList",
  components: {
    DateTime,
    NoData,
    QTablePagination,
    TenstackTable,
    ConfirmDialog,
    AppTabs,
    JsonPreview,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
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
    const $q = useQuasar();
    const route = useRoute();
    const store = useStore();
    const { t } = useI18n();
    const confirmDelete = ref(false);
    const toBeDeletedJob = ref({});

    const qTableSchedule: Ref<InstanceType<typeof qTable> | null> = ref(null);
    const qTableRef: Ref<InstanceType<typeof qTableSchedule> | null> =
      ref(null);
    const searchDateTimeRef = ref(null);
    const { searchObj } = searchState();
    const dataToBeLoaded: any = ref([]);
    const dateTimeToBeSent = ref({
      valueType: "relative",
      relativeTimePeriod: "15m",
      startTime: 0,
      endTime: 0,
    });
    const columnsToBeRendered = ref([]);
    const expandedColumns = ref([]);
    const expandedRow = ref([]); // Array to track expanded rows
    const isLoading = ref(false);
    const isDateTimeChanged = ref(false);
    const showSearchResults = ref(false);
    const toBeCancelled = ref({});
    const confirmCancel = ref(false);
    const activeTab = ref("query");
    const query = ref("");

    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
    const tabs = reactive([
      {
        label: t('search_scheduler_job.query_function'),
        value: "query",
      },
      {
        label: t('search_scheduler_job.more_details'),
        value: "more_details",
      },
    ]);

    // onMounted(async ()=>{
    //   await fetchSearchHistory();
    // })

    const resultTotal = ref<number>(0);

    const pagination = ref({
      page: 1,
      rowsPerPage: 100,
    });
    const selectedPerPage = ref(pagination.value.rowsPerPage);

    const generateColumns = (data: any) => {
      if (data && data.length === 0) return [];

      // Define the desired column order and names
      const desiredColumns = [
        { key: "#", label: "#", align: "center", sortable: false },
        { key: "user_id", label: t('search_scheduler_job.user_id') },
        { key: "created_at", label: t('search_scheduler_job.created_at') },
        { key: "start_time", label: t('search_scheduler_job.start_time') },
        { key: "duration", label: t('search_scheduler_job.duration') },
        { key: "status", label: t('search_scheduler_job.status') },
        { key: "Actions", label: t('search_scheduler_job.actions') },
      ];

      return desiredColumns.map(({ key, label }) => {
        let columnWidth = 150;
        let classes = '';

        let align = "center";
        let sortable = true;
        if (key === "user_id") {
          columnWidth = 200;
          align = "center";
          sortable = true;
        }
        if (key === "Actions") {
          columnWidth = 150;
          align = "left";
          sortable = false;
          classes = 'actions-column';
        }
        if (key == "trace_id") {
          columnWidth = 250;
          sortable = false;
        }
        if (key == "duration") {
          align = "left";
          columnWidth = 100;
          sortable = true;
        }
        if (
          key == "start_time" ||
          key == "end_time" ||
          key == "created_at" ||
          key == "started_at" ||
          key == "ended_at"
        ) {
          columnWidth = 200;
          sortable = true;
        }
        if (key == "sql") {
          columnWidth = 300;
          sortable = false;
        }
        if (key == "status") {
          align = "left";
          columnWidth = 200;
          sortable = false;
        }
        if (key == "#") {
          columnWidth = 67;
          sortable = false;
          align = "left";
        }


        // Custom width for each column
        return {
          name: key, // Field name
          label: label, // Column label
          field: key, // Field accessor
          align: align,
          sortable: sortable,
          classes: classes,
          style: `max-width: ${columnWidth}px; width: ${columnWidth}px;`,
        };
      });
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
        expandedRow.value = [];
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
              element.start_time = convertUnixToQuasarFormat(
                element.start_time,
              );
              element.end_time = convertUnixToQuasarFormat(element.end_time);
              element.created_at = convertUnixToQuasarFormat(
                element.created_at,
              );
              element.started_at = convertUnixToQuasarFormat(
                element.started_at,
              );
              element.ended_at = convertUnixToQuasarFormat(element.ended_at);
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
              $q.notify({
                type: "negative",
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
          $q.notify({
            type: "negative",
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
          $q.notify({
            type: "positive",
            message: t('search_scheduler_job.job_cancelled_success'),
            timeout: 2000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            $q.notify({
              type: "negative",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_cancel_failed'),
              timeout: 2000,
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
          $q.notify({
            type: "positive",
            message: t('search_scheduler_job.job_restarted_success'),
            timeout: 2000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            $q.notify({
              type: "negative",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_restart_failed'),
              timeout: 2000,
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
          $q.notify({
            type: "positive",
            message: t('search_scheduler_job.job_deleted_success'),
            timeout: 2000,
          });
        })
        .catch((e) => {
          if (e.response.status != 403) {
            $q.notify({
              type: "negative",
              message:
                e.response?.data?.message || t('search_scheduler_job.job_delete_failed'),
              timeout: 2000,
            });
          }
        })
        .finally(() => {
          fetchSearchHistory();
        });
    };
    const sortMethod = (rows, sortBy, descending) => {
      const data = [...rows];
      if (sortBy === "user_id") {
        if (descending) {
          return data.sort((a, b) => b.user_id.localeCompare(a.user_id));
        }
        return data.sort((a, b) => a.user_id.localeCompare(b.user_id));
      }
      if (sortBy === "duration") {
        if (descending) {
          return data.sort((a, b) => b.rawDuration - a.rawDuration);
        }
        return data.sort((a, b) => a.rawDuration - b.rawDuration);
      }
      if (sortBy == "start_time") {
        if (descending) {
          return data.sort(
            (a, b) => b.toBeStoredStartTime - a.toBeStoredStartTime,
          );
        }
        return data.sort(
          (a, b) => a.toBeStoredStartTime - b.toBeStoredStartTime,
        );
      }
      if (sortBy == "created_at") {
        if (descending) {
          return data.sort((a, b) => b.toBeCreatedAt - a.toBeCreatedAt);
        }
        return data.sort((a, b) => a.toBeCreatedAt - b.toBeCreatedAt);
      }
      // if(sortBy == "status"){
      //   if (descending) {
      //     return data.sort((a, b) => b.status - a.status);
      //   }
      //   return data.sort((a, b) => a.status - b.status);
      // }

      // return a.rawDuration - b.rawDuration;
    };
    const copyToClipboard = (text, type) => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          $q.notify({
            type: "positive",
            message: `${type} ${t('search_scheduler_job.copy_success')}`,
            timeout: 5000,
          });
        })
        .catch(() => {
          $q.notify({
            type: "negative",
            message: t('search_scheduler_job.copy_error'),
            timeout: 5000,
          });
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

    const triggerExpand = (props) => {
      query.value = JSON.stringify(filterRow(props.row), null, 2);
      if (expandedRow.value === props.row.trace_id) {
        expandedRow.value = null;
      } else {
        // Otherwise, expand the clicked row and collapse any other row
        expandedRow.value = props.row.trace_id;
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

      $q.notify({
        type: "positive",
        message: t('search_scheduler_job.job_applied_success'),
        timeout: 2000,
      });

      router.push({
        path: "/logs",
        query: queryObject,
      });
    };
    const changePagination = (val: { label: string; value: any }) => {
      if (val.label == "All") {
        val.value = dataToBeLoaded.value.length;
        val.label = "All";
      }
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTableSchedule.value.setPagination(pagination.value);

      // pagination.value.page = 1;
    };

    watch(
      () => props.isClicked,
      (value) => {
        if (value == true && !isLoading.value) {
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
          return "hourglass_empty"; // Icon for pending
        case 1:
          return "pause_circle"; // Icon for running
        case 2:
          return "check_circle"; // Icon for finished
        case 3:
          return "cancel"; // Icon for cancelled
        default:
          return "help"; // Icon for unknown
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

    function convertUnixToQuasarFormat(unixMicroseconds: any) {
      if (!unixMicroseconds) return "";
      const unixSeconds = unixMicroseconds / 1e6;
      const dateToFormat = new Date(unixSeconds * 1000);
      const formattedDate = dateToFormat.toISOString();
      return date.formatDate(formattedDate, "YYYY-MM-DDTHH:mm:ssZ");
    }
    const fetchSearchResults = (row) => {
      searchObj.meta.jobId = row.id;
      goToLogs(row);
    };
    return {
      searchObj,
      store,
      generateColumns,
      fetchSearchHistory,
      dataToBeLoaded,
      columnsToBeRendered,
      expandedColumns,
      config,
      t,
      route,
      isLoading,
      qTableSchedule,
      updateDateTime,
      pagination,
      searchDateTimeRef,
      expandedRow,
      goToLogs,
      triggerExpand,
      copyToClipboard,
      formatTime,
      delayMessage,
      sortMethod,
      resultTotal,
      perPageOptions,
      changePagination,
      selectedPerPage,
      getStatusText,
      getStatusIcon,
      getStatusColor,
      showSearchResults,
      fetchSearchResults,
      qTableRef,
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
      convertUnixToQuasarFormat,
      dateTimeToBeSent,
      isDateTimeChanged,
      router,
    };
    // Watch the searchObj for changes
  },
});
</script>
<style lang="scss" scoped>
@import "@/styles/logs/search-schedulerlist.scss";
</style>
