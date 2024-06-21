<template>
  <div class="running-queries-page" v-if="isMetaOrg">
    <div class="text-h6 q-mx-md q-my-xs" data-test="log-stream-title-text">
      {{ t("queries.runningQueries") }}
    </div>

    <q-table
      data-test="running-queries-table"
      ref="qTable"
      :rows="rowsQuery"
      :columns="columns"
      row-key="trace_id"
      style="width: 100%"
      selection="multiple"
      v-model:selected="selectedRow"
    >
      <template #no-data>
        <div v-if="!loadingState" class="text-center full-width full-height">
          <NoData />
        </div>
        <div v-else class="text-center full-width full-height q-mt-lg">
          <q-spinner-hourglass color="primary" size="lg" />
        </div>
      </template>
      <template #header-selection="scope">
        <q-checkbox v-model="scope.selected" size="sm" color="secondary" />
      </template>
      <template #body-selection="scope">
        <q-checkbox v-model="scope.selected" size="sm" color="secondary" />
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            icon="list_alt"
            :title="t('queries.queryList')"
            class="q-ml-xs"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            @click="listSchema(props)"
            data-test="queryList-btn"
          />
          <q-btn
            :icon="outlinedCancel"
            :title="t('queries.cancelQuery')"
            class="q-ml-xs"
            padding="sm"
            unelevated
            size="sm"
            style="color: red"
            round
            flat
            @click="confirmDeleteAction(props)"
            data-test="cancelQuery-btn"
          />
        </q-td>
      </template>

      <template #top>
        <div class="flex justify-between items-center full-width">
          <q-btn
            data-test="qm-multiple-cancel-query-btn"
            class="text-bold"
            outline
            padding="sm lg"
            color="red"
            :disable="selectedRow.length === 0"
            @click="handleMultiQueryCancel"
            no-caps
            :label="t('queries.cancelQuery')"
          />
          <q-space />
          <div class="flex items-start">
            <div
              data-test="streams-search-stream-input"
              class="flex items-center"
            >
              <q-select
                v-model="selectedSearchField"
                dense
                map-options
                emit-value
                filled
                :options="searchFieldOptions"
                class="q-pa-none search-field-select"
                data-test="running-queries-search-fields-select"
                @update:model-value="filterQuery = ''"
              ></q-select>
              <q-input
                v-if="selectedSearchField == 'all'"
                v-model="filterQuery"
                borderless
                filled
                dense
                class="q-mb-xs no-border search-input q-pa-none search-running-query"
                :placeholder="t('queries.search')"
                data-test="running-queries-search-input"
              >
                <template #prepend>
                  <q-icon name="search" />
                </template>
              </q-input>
              <q-select
                v-else
                v-model="filterQuery"
                borderless
                map-options
                emit-value
                filled
                dense
                label="Select option"
                :options="otherFieldOptions"
                class="q-mb-xs no-border search-input q-pa-none search-running-query"
                :placeholder="t('queries.search')"
                data-test="running-queries-search-input"
              ></q-select>
              <q-btn
                data-test="running-queries-refresh-btn"
                class="q-ml-md q-mb-xs text-bold no-border"
                padding="sm lg"
                color="secondary"
                no-caps
                icon="refresh"
                :label="t(`queries.refreshQuery`)"
                @click="refreshData"
              />
            </div>
          </div>
        </div>
        <div class="label-container">
          <label class="q-my-sm text-bold"
            >Last Data Refresh Time: {{ lastRefreshed }}</label
          >
        </div>
      </template>

      <template #bottom="scope">
        <q-table-pagination
          data-test="query-stream-table-pagination"
          :scope="scope"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="bottom"
          @update:changeRecordPerPage="changePagination"
          v-model="filterQuery"
        />
      </template>
    </q-table>
    <confirm-dialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="handleDeleteQuery"
      @update:cancel="deleteDialog.show = false"
    />
    <q-dialog
      v-model="showListSchemaDialog"
      position="right"
      full-height
      maximized
      data-test="list-schema-dialog"
    >
      <QueryList :schemaData="schemaData" />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import SearchService from "@/services/search";
import {
  onBeforeMount,
  ref,
  type Ref,
  defineComponent,
  computed,
  toRaw,
  watch,
} from "vue";
import { useQuasar, type QTableProps, QTable } from "quasar";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import { useI18n } from "vue-i18n";
import { outlinedCancel } from "@quasar/extras/material-icons-outlined";
import NoData from "@/components/shared/grid/NoData.vue";
import { useStore } from "vuex";
import QueryList from "@/components/queries/QueryList.vue";

export default defineComponent({
  name: "RunningQueriesList",
  components: { QueryList, ConfirmDialog, QTablePagination, NoData },
  setup() {
    const store = useStore();
    const schemaData = ref({});
    const lastRefreshed = ref("");
    const { isMetaOrg } = useIsMetaOrg();
    const resultTotal = ref<number>(0);
    const selectedRow = ref([]);
    const deleteRowCount = ref(0);
    const searchFieldOptions = ref([
      { label: "All Fields", value: "all" },
      { label: "Exec. Duration", value: "exec_duration" },
      { label: "Query Range", value: "query_range" },
    ]);
    const selectedSearchField = ref(searchFieldOptions.value[0].value);

    const refreshData = () => {
      getRunningQueries();
      lastRefreshed.value = getCurrentTime();
    };

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

    const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
    const { t } = useI18n();
    const showListSchemaDialog = ref(false);

    const listSchema = (props: any) => {
      //pass whole props.row to schemaData
      schemaData.value = props.row;

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
      qTable.value?.setPagination(pagination.value);
    };
    const filterQuery = ref("");

    const q = useQuasar();

    const localTimeToMicroseconds = () => {
      // Create a Date object representing the current local time
      var date = new Date();

      // Get the timestamp in milliseconds
      var timestampMilliseconds = date.getTime();

      // Convert milliseconds to microseconds
      var timestampMicroseconds = timestampMilliseconds * 1000;

      return timestampMicroseconds;
    };
    const getDuration = (createdAt: number) => {
      const currentTime = localTimeToMicroseconds();

      const durationInSeconds = Math.floor((currentTime - createdAt) / 1000000);

      let formattedDuration;
      if (durationInSeconds < 0) {
        formattedDuration = "Invalid duration";
      } else if (durationInSeconds < 60) {
        formattedDuration = `${durationInSeconds}s`;
      } else if (durationInSeconds < 3600) {
        const minutes = Math.floor(durationInSeconds / 60);
        formattedDuration = `${minutes}m`;
      } else {
        const hours = Math.floor(durationInSeconds / 3600);
        formattedDuration = `${hours}h`;
      }

      return formattedDuration;
    };

    //different between start and end time to show in UI as queryRange
    const queryRange = (startTime: number, endTime: number) => {
      const queryDuration = Math.floor((endTime - startTime) / 1000000);
      let formattedDuration;
      if (queryDuration < 0) {
        formattedDuration = "Invalid duration";
      } else if (queryDuration < 60) {
        formattedDuration = `${queryDuration}s`;
      } else if (queryDuration < 3600) {
        const minutes = Math.floor(queryDuration / 60);
        formattedDuration = `${minutes}m`;
      } else {
        const hours = Math.floor(queryDuration / 3600);
        formattedDuration = `${hours}h`;
      }

      return formattedDuration;
    };

    const columns = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
      },
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

    const filteredRows = computed(() => {
      const newVal = filterQuery.value;
      if (selectedSearchField.value === "all") {
        if (!newVal) {
          return queries.value;
        } else {
          return queries.value.filter(
            (query: any) =>
              query.user_id.toLowerCase().includes(newVal.toLowerCase()) ||
              query.org_id.toLowerCase().includes(newVal.toLowerCase()) ||
              query.stream_type.toLowerCase().includes(newVal.toLowerCase()) ||
              query.status.toLowerCase().includes(newVal.toLowerCase()) ||
              query.trace_id.toLowerCase().includes(newVal.toLowerCase())
          );
        }
      } else {
        const currentTime = Date.now() * 1000; // Convert current time to microseconds

        const timeMap: any = {
          lt_1m: 1 * 60 * 1000000, // 1 minute
          lt_5m: 5 * 60 * 1000000, // 5 minutes
          lt_15m: 15 * 60 * 1000000, // 15 minutes
          lt_30m: 30 * 60 * 1000000, // 30 minutes
          lt_1h: 60 * 60 * 1000000, // 1 hour
          lt_5h: 5 * 60 * 60 * 1000000, // 5 hours
          lt_10h: 10 * 60 * 60 * 1000000, // 10 hours
          lt_1d: 24 * 60 * 60 * 1000000, // 1 day
          lt_1w: 7 * 24 * 60 * 60 * 1000000, // 1 week
          lt_1M: 30 * 24 * 60 * 60 * 1000000, // 1 month (approx.)
          gt_1d: 24 * 60 * 60 * 1000000, // greater than 1 day
          gt_1M: 30 * 24 * 60 * 60 * 1000000, // greater than 1 month (approx.)
        };

        return queries.value.filter((item: any) => {
          const timeDifference =
            selectedSearchField.value == "exec_duration"
              ? currentTime - item.created_at
              : item.query.end_time - item.query.start_time;

          if (newVal.startsWith("lt_")) {
            return timeDifference < timeMap[newVal];
          } else if (newVal.startsWith("gt_")) {
            return timeDifference > timeMap[newVal];
          } else {
            return true; // If the filter is not recognized, return all items
          }
        });
      }
    });

    const otherFieldOptions = computed(() => {
      filterQuery.value = "";
      if (selectedSearchField.value === "exec_duration") {
        return [
          { label: "< 1 minute", value: "lt_1m" },
          { label: "< 5 minutes", value: "lt_5m" },
          { label: "< 15 minutes", value: "lt_15m" },
          { label: "< 30 minutes", value: "lt_30m" },
          { label: "< 1 hour", value: "lt_1h" },
          { label: "< 5 hours", value: "lt_5h" },
          { label: "< 12 hours", value: "lt_12h" },
          { label: "< 1 day", value: "lt_1d" },
          { label: "> 1 day", value: "gt_1d" },
        ];
      } else if (selectedSearchField.value === "query_range") {
        return [
          { label: "< 1 hour", value: "lt_1h" },
          { label: "< 1 day", value: "lt_1d" },
          { label: "< 1 week", value: "lt_1w" },
          { label: "< 1 Month", value: "lt_1M" },
          { label: "> 1 Month", value: "gt_1M" },
        ];
      }
    });

    // Watcher to filter queries based on user_id
    watch(filterQuery, () => {
      // Update the result total based on the filtered array length
      resultTotal.value = filteredRows.value.length;
    });

    const getRunningQueries = () => {
      const dismiss = q.notify({
        message: "Fetching running queries...",
        color: "primary",
        position: "bottom",
        spinner: true,
      });
      SearchService.get_running_queries(store.state.zoConfig.meta_org)
        .then((response: any) => {
          // resultTotal.value = response?.data?.status?.length;
          queries.value = response?.data?.status;
          resultTotal.value = queries.value.length;
        })
        .catch((error: any) => {
          q.notify({
            message:
              error.response?.data?.message ||
              "Failed to fetch running queries",
            color: "negative",
            position: "bottom",
            timeout: 2500,
          });
        })
        .finally(() => {
          dismiss();
        });
    };

    const handleDeleteQuery = () => {
      // alert(JSON.parse(JSON.stringify(deleteDialog.value.data)))
      const data = deleteDialog.value.data.split(",");
      deleteRowCount.value = data.length;
      for (let traceID of data) {
        setTimeout(() => {
          deleteQuery(traceID);
        }, 100);
      }
    };

    const deleteQuery = (traceID: string) => {
      SearchService.delete_running_query(store.state.zoConfig.meta_org, traceID)
        .then(() => {
          deleteRowCount.value--;
          getRunningQueries();
          deleteDialog.value.show = false;
          if (deleteRowCount.value === 0) {
            q.notify({
              message: "Running query deleted successfully",
              color: "positive",
              position: "bottom",
              timeout: 1500,
            });
          }
        })
        .catch((error: any) => {
          deleteRowCount.value--;
          q.notify({
            message:
              error.response?.data?.message || "Failed to delete running query",
            color: "negative",
            position: "bottom",
            timeout: 1500,
          });
        });
    };

    const confirmDeleteAction = (props: any) => {
      deleteDialog.value.data = props.row.trace_id;
      deleteDialog.value.show = true;
    };

    const handleMultiQueryCancel = () => {
      const selectedRowsTraceID = selectedRow.value.map(
        (row: any) => row.trace_id
      );
      deleteDialog.value.data = selectedRowsTraceID.join(",");
      deleteDialog.value.show = true;
    };

    const rowsQuery = computed(function () {
      const rows = toRaw(filteredRows.value) ?? [];

      rows.sort((a: any, b: any) => b.created_at - a.created_at);

      return rows.map((row: any, index) => {
        return {
          "#": index < 9 ? `0${index + 1}` : index + 1,
          user_id: row?.user_id,
          org_id: row?.org_id,
          duration: getDuration(row?.created_at),
          queryRange: queryRange(row?.query?.start_time, row?.query?.end_time),
          status: row?.status,
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
        };
      });
    });
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
      outlinedCancel,
      schemaData,
      loadingState,
      refreshData,
      lastRefreshed,
      isMetaOrg,
      resultTotal,
      selectedPerPage,
      qTable,
      rowsQuery,
      filteredQueries,
      selectedRow,
      handleMultiQueryCancel,
      handleDeleteQuery,
      selectedSearchField,
      searchFieldOptions,
      otherFieldOptions,
    };
  },
});
</script>

<style scoped>
.label-container {
  display: flex;
  width: 100%;
  justify-content: flex-end;
}
</style>

<style lang="scss">
.running-queries-page {
  .search-input {
    width: 250px;
  }
}

.search-field-select {
  .q-field__control {
    padding-left: 12px;
    top: -1px;
    position: relative;
  }
}
</style>
