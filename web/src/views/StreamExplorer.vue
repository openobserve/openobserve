<template>
  <div>
    <SearchBar
      ref="searchBarRef"
      :query-data="queryData"
      @searchdata="getQueryData"
      @update-query="updateQuery"
    ></SearchBar>
    <StreamDataTable
      class="stream-data-table"
      :rows="tableData.rows"
      :columns="tableData.columns"
      :is-loading="!!isLoading.length"
      @update:scroll="getDataOnScroll"
    />
  </div>
</template>

<script lang="ts">
import SearchBar from "@/components/logstream/explore/SearchBar.vue";
import stream from "@/services/stream";
import { defineComponent, onBeforeMount, onMounted, ref, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import StreamDataTable from "@/components/logstream/explore/StreamDataTable.vue";
import { useQuasar } from "quasar";
import search from "@/services/search";
import { logsErrorMessage } from "@/utils/common";
import { useI18n } from "vue-i18n";
import { getConsumableDateTime } from "@/utils/commons";
import { convertTimeFromMicroToMilli } from "@/utils/zincutils";
import { b64EncodeUnicode } from "@/utils/zincutils";

type SearchBarInstance = InstanceType<typeof SearchBar>;

export default defineComponent({
  name: "StreamExplorer",
  components: { SearchBar, StreamDataTable },
  setup() {
    const store = useStore();
    const router = useRouter();
    const streamData: any = ref(null);
    const isLoading: Ref<boolean[]> = ref([]);
    const { t } = useI18n();
    const searchBarRef = ref<SearchBarInstance | null>(null);
    const queryData = ref({
      query: "",
      errorMsg: "",
      errorCode: 0,
      dateTime: {
        tab: "relative",
        relative: {
          period: {
            label: "Minutes",
            value: "Minutes",
          },
          value: 15,
        },
        absolute: {
          date: {
            from: "",
            to: "",
          },
          startTime: "00:00",
          endTime: "23:59",
        },
      },
      pagination: {
        currentPage: 0,
        rowsPerPage: 150,
      },
      queryResults: {} as any,
      streamType: "",
    });
    const q = useQuasar();

    const tableData = ref({
      rows: [],
      columns: [],
    });
    onBeforeMount(() => {
      // From router decode the stream name and stream type
      // and call the schema api
      const params = router.currentRoute.value.query;

      queryData.value.query = 'SELECT * FROM "' + params.stream_name + '"';
      stream
        .schema(
          store.state.selectedOrganization.identifier,
          params.stream_name as string,
          params.stream_type as string
        )
        .then((res) => {
          queryData.value.streamType = res.data?.stream_type;
          streamData.value = res.data;
          tableData.value["columns"] = res.data.schema.map((field: any) => ({
            name: field.name,
            label: field.name,
            align: "left",
            field: (row: any) => JSON.stringify(row),
            prop: (row: any) => JSON.stringify(row),
            type: field.type,
          }));
          getQueryData();
        })
        .catch((err) => console.log(err));
    });

    onMounted(() => {
      if (searchBarRef.value != null) {
        searchBarRef.value.udpateQuery();
      }
    });

    function Notify() {
      return q.notify({
        type: "positive",
        message: "Waiting for response...",
        timeout: 10000,
        actions: [
          {
            icon: "cancel",
            color: "white",
            handler: () => {
              /* ... */
            },
          },
        ],
      });
    }

    function ErrorException(message: string) {
      isLoading.value.pop();
      // searchObj.data.errorMsg = message;
      q.notify({
        type: "negative",
        message: message,
        timeout: 10000,
        actions: [
          {
            icon: "cancel",
            color: "white",
            handler: () => {
              /* ... */
            },
          },
        ],
      });
    }

    function getQueryData() {
      try {
        isLoading.value.push(true);
        queryData.value.errorMsg = "";

        const dismiss = Notify();

        const queryReq = buildSearch();

        if (queryReq == null) {
          dismiss();
          return false;
        }

        queryData.value.errorCode = 0;
        search
          .search({
            org_identifier: store.state.selectedOrganization.identifier,
            query: queryReq,
            page_type: streamData.value?.stream_type || "logs",
          })
          .then((res) => {
            isLoading.value.pop();
            if (res.data.from > 0) {
              queryData.value.queryResults["from"] = res.data.from;
              queryData.value.queryResults.scan_size += res.data.scan_size;
              queryData.value.queryResults.took += res.data.took;
              queryData.value.queryResults.hits.push(...res.data.hits);
            } else {
              queryData.value.queryResults = res.data;
            }

            tableData.value.rows = queryData.value.queryResults.hits;

            dismiss();
          })
          .catch((err) => {
            isLoading.value.pop();
            dismiss();
            if (err.response != undefined) {
              queryData.value.errorMsg = err.response.data.error;
            } else {
              queryData.value.errorMsg = err.message;
            }
            const customMessage = logsErrorMessage(err.response.data.code);
            queryData.value.errorCode = err.response.data.code;
            if (customMessage != "") {
              queryData.value.errorMsg = t(customMessage);
            }

            // $q.notify({
            //   message: searchObj.data.errorMsg,
            //   color: "negative",
            // });
          });
      } catch (e) {
        console.error(e);
        // throw errorE("Request failed.");
      }
    }

    function buildSearch() {
      try {
        var req: any = {
          query: {
            sql: queryData.value.query,
            start_time: (new Date().getTime() - 900000) * 1000,
            end_time: new Date().getTime() * 1000,
            from:
              queryData.value.pagination.currentPage *
              queryData.value.pagination.rowsPerPage,
            size: parseInt(
              queryData.value.pagination.rowsPerPage.toString(),
              10
            ),
            sql_mode: "full",
          },
        };

        var timestamps: any = getConsumableDateTime(queryData.value.dateTime);
        if (streamData.value.stream_type === "enrichment_tables") {
          if (streamData.value.stats) {
            timestamps = {
              start_time: new Date(
                convertTimeFromMicroToMilli(
                  streamData.value.stats.doc_time_min - 300000000
                )
              ),
              end_time: new Date(
                convertTimeFromMicroToMilli(
                  streamData.value.stats.doc_time_max + 300000000
                )
              ),
            };
          }
        }

        if (
          timestamps.start_time != "Invalid Date" &&
          timestamps.end_time != "Invalid Date"
        ) {
          const startISOTimestamp: any =
            new Date(timestamps.start_time.toISOString()).getTime() * 1000;
          const endISOTimestamp: any =
            new Date(timestamps.end_time.toISOString()).getTime() * 1000;

          req.query.start_time = startISOTimestamp;
          req.query.end_time = endISOTimestamp;
        } else {
          return false;
        }

        if (store.state.zoConfig.sql_base64_enabled) {
          req["encoding"] = "base64";
          req.query.sql = b64EncodeUnicode(req.query.sql);
        }

        return req;
      } catch (e) {
        console.error(e);
        // throw new ErrorException(e.message);
      }
    }

    const updateQuery = (value: string) => {
      queryData.value.query = value;
    };

    const getDataOnScroll = () => {
      queryData.value.pagination.currentPage++;
      getQueryData();
    };

    return {
      tableData,
      queryData,
      getQueryData,
      searchBarRef,
      updateQuery,
      getDataOnScroll,
      isLoading,
    };
  },
});
</script>

<style scoped lang="scss">
.stream-data-table {
  height: calc(100vh - (140px + 57px));
}
</style>
