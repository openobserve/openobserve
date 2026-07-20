<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="rounded-md">
    <SearchBar
      ref="searchBarRef"
      :query-data="queryData"
      @searchdata="getQueryData"
      @update-query="updateQuery"
      :is-loading="isLoading"
      @change:date-time="updateDateTime"
    />
    <div class="h-[calc(100vh-197px)]">
      <OTable
        data-test="stream-explorer-results-table"
        class="h-full"
        :data="rows"
        :columns="tableColumns"
        row-key="_rowKey"
        pagination="server"
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total-count="totalCount"
        :loading="isLoading"
        :page-size-options="pageSizeOptions"
        :show-global-filter="false"
        sticky-header
        bordered
        dense
        @pagination-change="onPaginationChange"
      >
        <template #empty>
          <no-data />
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeMount, onMounted, ref, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "lodash-es";

import SearchBar from "@/components/logstream/explore/SearchBar.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import NoData from "@/components/shared/grid/NoData.vue";
import stream from "@/services/stream";
import search from "@/services/search";
import { logsErrorMessage } from "@/utils/common";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import type { IDateTime } from "@/ts/interfaces";
import { toast } from "@/lib/feedback/Toast/useToast";

type SearchBarInstance = InstanceType<typeof SearchBar>;

const store = useStore();
const router = useRouter();
const { t } = useI18n();

const streamData = ref<any>(null);
const searchBarRef = ref<SearchBarInstance | null>(null);

const queryData = ref({
  query: "",
  errorMsg: "",
  errorCode: 0,
  dateTime: {
    startTime: 0,
    endTime: 0,
    relativeTimePeriod: "15m",
    type: "relative",
  } as IDateTime,
  queryResults: {} as any,
  streamType: "",
});

const rows = ref<any[]>([]);
const tableColumns = ref<OTableColumnDef[]>([]);
const currentPage = ref(1);
const pageSize = ref(150);
const totalCount = ref(0);
const pageSizeOptions = [50, 100, 150, 250, 500];
const isLoading = ref(false);

onBeforeMount(() => {
  const params = router.currentRoute.value.query;

  queryData.value.query = 'SELECT * FROM "' + params.stream_name + '"';
  stream
    .schema(
      store.state.selectedOrganization.identifier,
      params.stream_name as string,
      params.stream_type as string,
    )
    .then((res) => {
      queryData.value.streamType = res.data?.stream_type;
      streamData.value = res.data;
      tableColumns.value = res.data.schema.map((field: any) => ({
        id: field.name,
        header: field.name,
        accessorKey: field.name,
        meta: { align: "left" as const },
      }));
      getQueryData();
    })
    .catch((err) => console.log(err));
});

onMounted(() => {
  searchBarRef.value?.updateQuery();
});

function onPaginationChange(params: { page: number; size: number }) {
  currentPage.value = params.page;
  pageSize.value = params.size;
  getQueryData();
}

function ErrorException(message: string) {
  isLoading.value = false;
  toast({
    variant: "error",
    message,
    timeout: 10000,
  });
}

function getQueryData() {
  try {
    isLoading.value = true;
    queryData.value.errorMsg = "";

    const queryReq = buildSearch();

    if (queryReq == null) {
      isLoading.value = false;
      return;
    }

    queryData.value.errorCode = 0;
    search
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: queryReq,
          page_type: streamData.value?.stream_type || "logs",
        },
        "ui",
      )
      .then((res) => {
        isLoading.value = false;

        queryData.value.queryResults = res.data;
        rows.value = (res.data.hits || []).map((hit: any, index: number) => ({
          ...hit,
          _rowKey: `row_${(currentPage.value - 1) * pageSize.value + index}`,
        }));
        totalCount.value = res.data.total || 0;
      })
      .catch((err) => {
        isLoading.value = false;
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
      });
  } catch (e) {
    // Request failed
  }
}

function buildSearch() {
  try {
    var req: any = {
      query: {
        sql: queryData.value.query,
        start_time: (new Date().getTime() - 900000) * 1000,
        end_time: new Date().getTime() * 1000,
        from: (currentPage.value - 1) * pageSize.value,
        size: pageSize.value,
      },
    };

    var timestamps:
      | {
          startTime: number;
          endTime: number;
        }
      | null =
      queryData.value.dateTime.type === "relative"
        ? getConsumableRelativeTime(queryData.value.dateTime.relativeTimePeriod) ||
          null
        : cloneDeep(queryData.value.dateTime);

    if (streamData?.value?.stream_type === "enrichment_tables") {
      if (streamData.value.stats) {
        timestamps = {
          startTime: streamData.value.stats.created_at - 300000000,
          endTime: streamData.value.stats.created_at + 300000000,
        };
      }
    }

    if (timestamps?.startTime && timestamps?.endTime) {
      req.query.start_time = timestamps.startTime;
      req.query.end_time = timestamps.endTime;
    } else {
      return false;
    }

    if (store.state.zoConfig.sql_base64_enabled) {
      req["encoding"] = "base64";
      req.query.sql = b64EncodeUnicode(req.query.sql);
    }

    return req;
  } catch (e) {
    // throw new ErrorException(e.message);
  }
}

const updateQuery = (value: string) => {
  queryData.value.query = value;
};

const updateDateTime = (value: IDateTime) => {
  queryData.value.dateTime = value;
  if (streamData.value && value.valueType === "relative") {
    currentPage.value = 1;
    getQueryData();
  }
};
</script>
