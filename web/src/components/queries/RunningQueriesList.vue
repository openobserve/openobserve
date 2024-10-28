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
  <div class="running-queries-page" v-if="isMetaOrg">
    <q-table
      data-test="running-queries-table"
      ref="qTable"
      :rows="rows"
      :columns="columns"
      :pagination="pagination"
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
        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
      </template>
      <template #body-selection="scope">
        <q-checkbox v-model="scope.selected" size="xs" color="secondary" />
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

      <template #bottom="scope">
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
        <div style="width: auto">
          <q-table-pagination
            data-test="query-stream-table-pagination"
            :scope="scope"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            position="bottom"
            @update:changeRecordPerPage="changePagination"
            v-model="filterQuery"
            class="fit"
          />
        </div>
      </template>
    </q-table>
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
import { durationFormatter } from "@/utils/zincutils";

export default defineComponent({
  name: "RunningQueriesList",
  components: { QueryList, ConfirmDialog, QTablePagination, NoData },
  props: {
    rows: {
      type: Array,
      required: true,
    },
    selectedRows: {
      type: Array,
      required: false,
    },
  },
  emits: ["update:selectedRows", "delete:queries", "delete:query"],
  setup(props, { emit }) {
    const store = useStore();
    const schemaData = ref({});
    const lastRefreshed = ref("");
    const { isMetaOrg } = useIsMetaOrg();
    const resultTotal = ref<number>(0);
    const deleteRowCount = ref(0);
    const searchFieldOptions = ref([
      { label: "All Fields", value: "all" },
      { label: "Exec. Duration", value: "exec_duration" },
      { label: "Query Range", value: "query_range" },
    ]);

    const selectedQueryTypeTab = ref("summary");

    const runningQueries = [
      {
        trace_id: "2f85ab21ba4c49cca4990de1e3332926-0",
        status: "waiting",
        created_at: 1729838872552707,
        started_at: 0,
        work_group: "Long",
        user_id: "omkar1@openobserve.ai",
        org_id: "otlp-production",
        stream_type: "logs",
        query: {
          sql: 'SELECT histogram(_timestamp,\'43200 seconds\') AS "x_axis_1", COUNT("k8s_container_name") AS "y_axis_1", "k8s_node_name" AS "breakdown_1" FROM "default" GROUP BY "x_axis_1", "breakdown_1" ORDER BY "x_axis_1" ASC',
          start_time: 1729814400000000,
          end_time: 1729838871510000,
        },
        scan_stats: null,
      },
      {
        trace_id: "0de0b2a1b1b2451488c86652e562c40c-0",
        status: "processing",
        created_at: 1729838872353327,
        started_at: 1729838873022841,
        work_group: "Long",
        user_id: "omkar1@openobserve.ai",
        org_id: "otlp-production",
        stream_type: "logs",
        query: {
          sql: 'SELECT count(k8s_pod_start_time) as "y_axis_1"  FROM "default" ',
          start_time: 1726210071510000,
          end_time: 1729838871510000,
        },
        scan_stats: {
          files: 2640,
          records: 603459598,
          original_size: 813496,
          compressed_size: 25986,
          querier_files: 0,
          querier_memory_cached_files: 0,
          querier_disk_cached_files: 0,
          idx_scan_size: 0,
          idx_took: 0,
        },
      },
      {
        trace_id: "13491c0c0d1f41998cc8584608d72312-0",
        status: "waiting",
        created_at: 1729838873302399,
        started_at: 0,
        work_group: "Long",
        user_id: "omkar1@openobserve.ai",
        org_id: "otlp-production",
        stream_type: "logs",
        query: {
          sql: 'SELECT histogram(_timestamp,\'43200 seconds\') AS "x_axis_1", COUNT("k8s_app_instance") AS "y_axis_1", "k8s_pod_name" AS "breakdown_1" FROM "default" GROUP BY "x_axis_1", "breakdown_1" ORDER BY "x_axis_1" ASC',
          start_time: 1729771200000000,
          end_time: 1729814400000000,
        },
        scan_stats: null,
      },
    ];

    const runningQueryTypes = [
      { label: "User Summary", value: "summary" },
      { label: "All Queries", value: "all" },
    ];
    const selectedSearchField = ref(searchFieldOptions.value[0].value);

    const refreshData = () => {
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

      return durationFormatter(durationInSeconds);
    };

    //different between start and end time to show in UI as queryRange
    const queryRange = (startTime: number, endTime: number) => {
      const queryDuration = Math.floor((endTime - startTime) / 1000000);

      return durationFormatter(queryDuration);
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

    // Watcher to filter queries based on user_id
    const filteredQueries = ref([]);

    const filteredRows = computed(() => {
      const newVal = filterQuery.value;
      if (selectedSearchField.value === "all") {
        if (!newVal) {
          return props.rows;
        } else {
          return props.rows.filter(
            (query: any) =>
              query.user_id.toLowerCase().includes(newVal.toLowerCase()) ||
              query.org_id.toLowerCase().includes(newVal.toLowerCase()) ||
              query.stream_type.toLowerCase().includes(newVal.toLowerCase()) ||
              query.status.toLowerCase().includes(newVal.toLowerCase()) ||
              query.trace_id.toLowerCase().includes(newVal.toLowerCase()) ||
              query.work_group.toLowerCase().includes(newVal.toLowerCase()),
          );
        }
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

        return props.rows.filter((item: any) => {
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
          { label: "> 1 Month", value: "gt_1M" },
        ];
      }
    });

    // Watcher to filter queries based on user_id
    watch(filterQuery, () => {
      // Update the result total based on the filtered array length
      resultTotal.value = filteredRows.value.length;
    });

    const selectedRow = computed({
      get: () => props.selectedRows,
      set: (value) => {
        emit("update:selectedRows", value);
      },
    });

    const confirmDeleteAction = (props: any) => {
      emit("delete:query", props.row);
    };

    const handleMultiQueryCancel = () => {
      emit("delete:queries");
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
        };
      });
    });

    const onChangeQueryTab = (tab: string) => {
      selectedQueryTypeTab.value = tab;
    };

    return {
      t,
      store,
      columns,
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
      selectedSearchField,
      searchFieldOptions,
      otherFieldOptions,
      pagination,
      runningQueryTypes,
      selectedQueryTypeTab,
      onChangeQueryTab,
    };
  },
});
</script>

<style lang="scss" scoped>
.query-management-tabs {
  ::v-deep .q-btn:before {
    border: none !important;
  }
}

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
