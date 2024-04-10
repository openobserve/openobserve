<template>
  <div class="running-queries-page" v-if="isMetaOrg">
    <q-table
      data-test="running-queries-table"
      ref="qTable"
      :rows="queries"
      :columns="columns"
      row-key="session_id"
      style="width: 100%"
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
          />
        </q-td>
      </template>

      <template #top>
        <div class="flex justify-between items-center full-width">
          <div class="q-table__title" data-test="log-stream-title-text">
            {{ t("queries.runningQueries") }}
          </div>
          <div class="flex items-start">
            <!-- <div class="flex justify-between items-end q-px-md">
              <div
                style="
                  border: 1px solid #cacaca;
                  padding: 4px;
                  border-radius: 2px;
                "
              >
                <template
                  v-for="visual in streamFilterValues"
                  :key="visual.value"
                >
                  <q-btn
                    :color="
                      visual.value === selectedStreamType ? 'primary' : ''
                    "
                    :flat="visual.value === selectedStreamType ? false : true"
                    dense
                    emit-value
                    no-caps
                    class="visual-selection-btn"
                    style="height: 30px; padding: 4px 12px"
                    @click="onChangeStreamFilter(visual.value)"
                  >
                    {{ visual.label }}</q-btn
                  >
                </template>
              </div>
            </div> -->
            <div
              data-test="streams-search-stream-input"
              class="flex items-center"
            >
              <q-input
                v-model="filterQuery"
                borderless
                filled
                dense
                class="q-ml-auto q-mb-xs no-border search-input"
                :placeholder="t('queries.search')"
              >
                <template #prepend>
                  <q-icon name="search" />
                </template>
              </q-input>
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
        <q-table-pagination
          data-test="log-stream-table-pagination"
          :scope="scope"
          :pageTitle="t('logStream.header')"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="top"
          @update:changeRecordPerPage="changePagination"
        />
      </template>

      <template #bottom="scope">
        <q-table-pagination
          data-test="log-stream-table-pagination"
          :scope="scope"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="bottom"
          @update:changeRecordPerPage="changePagination"
        />
      </template>
    </q-table>
    <confirm-dialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @confirm="deleteQuery"
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
import useIsMetaOrg from "@/composables/useIsMetaOrg.ts";
// import SearchService from "@/services/search";
import {
  onBeforeMount,
  ref,
  type Ref,
  defineComponent,
  defineAsyncComponent,
} from "vue";
// import { useQuasar, type QTableProps } from "quasar";
// import QTablePagination from "@/components/shared/grid/Pagination.vue";
import { useI18n } from "vue-i18n";
import { outlinedCancel } from "@quasar/extras/material-icons-outlined";
import NoData from "@/components/shared/grid/NoData.vue";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import QueryList from "@/components/queries/QueryList.vue";

export default defineComponent({
  name: "RunningQueriesList",
  components: { QueryList, ConfirmDialog },
  setup() {
    const store = useStore();
    const schemaData = ref({});
    const lastRefreshed = ref("");
    // console.log("meta org", isMetaOrg());
    const { isMetaOrg } = useIsMetaOrg();

    const refreshData = () => {
      console.log("refreshing data");
      // getRunningQueries();
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
    const queries = ref([
      {
        "#": 1,
        session_id: "2el7tMu7v6eH6pZX9hCBe3VG1Jb",
        status: "processing",
        created_at: 1712467524505545,
        started_at: 1712467524517149,
        user_id: "root@example.com",
        org_id: "default",
        stream_type: "logs",
        query: {
          sql: "select * from 'default'",
          start_time: 1706429989000000,
          end_time: 2706685707000000,
        },
        scan_stats: {
          files: 2,
          records: 23376,
          original_size: 50,
          compressed_size: 0,
        },
      },
      {
        "#": 2,
        session_id: "2el7tMu7v6eH6pZX9hCBe3VG2NK",
        status: "processing",
        created_at: 1712467524505545,
        started_at: 1712467524517149,
        user_id: "root@example.com",
        org_id: "default",
        stream_type: "logs",
        query: {
          sql: "select * from 'default'",
          start_time: 1712672758000000,
          end_time: 1712676358000000,
        },
        scan_stats: {
          files: 2,
          records: 23376,
          original_size: 50,
          compressed_size: 0,
        },
      },
    ]);
    console.log(queries.value, "queries.value");

    const deleteDialog = ref({
      show: false,
      title: "Delete Running Query",
      message: "Are you sure you want to delete this running query?",
      data: null,
    });
    // const qTable: any = ref(null);
    const { t } = useI18n();
    const showListSchemaDialog = ref(false);

    const listSchema = (props: any) => {
      console.log("listSchema");

      console.log(props, "props.row");

      //pass whole props.row to schemaData
      schemaData.value = props.row;

      showListSchemaDialog.value = true;
      console.log(
        schemaData.value,
        "schemaData.value",
        "showListSchemaDialog.value",
        showListSchemaDialog.value
      );
      console.log("schemaData.value", schemaData.value);
    };

    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];
    const maxRecordToReturn = ref(100);
    const selectedPerPage = ref(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    const filterQuery = ref("");

    // const q = useQuasar();

    const localTimeToMicroseconds = () => {
      // Create a Date object representing the current local time
      var date = new Date();

      // Get the timestamp in milliseconds
      var timestampMilliseconds = date.getTime();

      // Convert milliseconds to microseconds
      var timestampMicroseconds = timestampMilliseconds * 1000;

      console.log(timestampMicroseconds, "------------");
      return timestampMicroseconds;
    };

    // Test the function

    const getDuration = (createdAt: number) => {
      const currentTime = localTimeToMicroseconds();
      console.log(currentTime, "currentTime", createdAt, "createdAt");

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
        field: (row: any) => getDuration(row.created_at),
        prop: (row: any) => getDuration(row.created_at),
      },
      {
        name: "queryRange",
        label: t("queries.queryRange"),
        align: "left",
        sortable: true,
        field: (row: any) =>
          queryRange(row.query.start_time, row.query.end_time),
        prop: (row: any) =>
          queryRange(row.query.start_time, row.query.end_time),
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
      // getRunningQueries();
      lastRefreshed.value = getCurrentTime();
    });

    const getRunningQueries = () => {
      const dismiss = q.notify({
        message: "Fetching running queries...",
        color: "primary",
        position: "bottom",
        spinner: true,
      });
      SearchService.get_running_queries()
        .then((response: any) => {
          console.log("response", response);

          queries.value = response.data;
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

    const deleteQuery = () => {
      SearchService.delete_running_query(deleteDialog.value.data.id)
        .then(() => {
          getRunningQueries();
          deleteDialog.value.show = false;
          q.notify({
            message: "Running query deleted successfully",
            color: "positive",
            position: "bottom",
            timeout: 2500,
          });
        })
        .catch((error: any) => {
          q.notify({
            message:
              error.response?.data?.message || "Failed to delete running query",
            color: "negative",
            position: "bottom",
            timeout: 2500,
          });
        });
    };

    const filterData = (rows: any, terms: any) => {
      return queries.value;
      // var filtered = [];
      // terms = terms.toLowerCase();

      // for (var i = 0; i < duplicateStreamList.value.length; i++) {
      //   if (
      //     (selectedStreamType.value ===
      //       duplicateStreamList.value[i]["stream_type"] ||
      //       selectedStreamType.value === "all") &&
      //     (duplicateStreamList.value[i]["name"].toLowerCase().includes(terms) ||
      //       duplicateStreamList.value[i]["stream_type"]
      //         .toLowerCase()
      //         .includes(terms))
      //   ) {
      //     filtered.push(duplicateStreamList.value[i]);
      //   }
      // }
      // return filtered;
    };

    const confirmDeleteAction = (props: any) => {
      console.log(props);
      deleteDialog.value.data = props.row.session_id;
      deleteDialog.value.show = true;
    };
    return {
      t,
      store,
      queries,
      columns,
      getRunningQueries,
      deleteQuery,
      filterData,
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
    width: 400px;
  }
}
</style>
