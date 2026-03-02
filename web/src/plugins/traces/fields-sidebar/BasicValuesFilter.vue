<template>
  <q-expansion-item
    class="field-expansion-item hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
    dense
    hide-expand-icon
    v-model="isExpanded"
    @before-show="(event: any) => openFilterCreator(event, row)"
    @before-hide="handleBeforeHide"
  >
    <template v-slot:header>
      <div class="flex content-center ellipsis full-width field-expansion-header" :title="row.name">
        <div
          class="field_label ellipsis tw:flex tw:items-center"
          style="width: calc(100% - 28px); font-size: 14px"
          :title="row.label || row.name"
        >
          <span v-if="row.dataType" class="field-type-container" :title="row.dataType">
            <FieldTypeBadge :dataType="row.dataType" />
            <q-icon
              class="field-expand-icon"
              :name="isExpanded ? 'expand_less' : 'expand_more'"
              size="1rem"
            />
          </span>
          {{ row.label || row.name }}
        </div>
        <div class="field_overlay">
          <q-btn
            :data-test="`log-search-index-list-filter-${row.name}-field-btn`"
            :icon="outlinedAdd"
            style="margin-right: 0.375rem"
            size="6px"
            class="q-mr-sm"
            @click.stop="addSearchTerm(`${row.name}=''`)"
            round
          />
        </div>
      </div>
    </template>
    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <FieldValuesPanel
          ref="fieldValuesPanelRef"
          :field-name="row.name"
          :field-values="fieldValuesState"
          :show-multi-select="true"
          :default-values-count="defaultValuesCount"
          :theme="store.state.theme"
          @add-search-term="handleAddSearchTerm"
          @add-multiple-search-terms="handleAddMultipleSearchTerms"
          @load-more-values="handleLoadMoreValues"
          @search-field-values="handleSearchFieldValues"
        />
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import useTraces from "@/composables/useTraces";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import FieldTypeBadge from "@/components/common/FieldTypeBadge.vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import useHttpStreaming from "@/composables/useStreamingSearch";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
});

const isExpanded = ref(false);
const fieldValuesPanelRef = ref();
const allFetchedValues = ref<{ key: string; count: number }[]>([]);
const currentFrom = ref(0);
const currentKeyword = ref("");
const activeTraceId = ref<string | null>(null);
const fieldValuesState = ref<{
  isLoading: boolean;
  values: { key: string; count: number }[];
  hasMore: boolean;
  errMsg: string;
}>({
  isLoading: false,
  values: [],
  hasMore: false,
  errMsg: "",
});

const store = useStore();
const $q = useQuasar();
const { searchObj } = useTraces();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();

const defaultValuesCount = computed(
  () => store.state.zoConfig?.query_values_default_num || 10,
);

const addSearchTerm = (term: string) => {
  searchObj.data.stream.addToFilter = term;
};

const buildSql = () => {
  let query = searchObj.data.editorValue;
  let parseQuery = query.split("|");
  let whereClause = "";
  if (parseQuery.length > 1) {
    whereClause = parseQuery[1].trim();
  } else {
    whereClause = parseQuery[0].trim();
  }

  let query_context =
    `SELECT * FROM "` +
    searchObj.data.stream.selectedStream.value +
    `" [WHERE_CLAUSE]`;

  if (whereClause.trim() !== "") {
    whereClause = whereClause
      .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
      .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
      .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

    whereClause = whereClause
      .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
      .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
      .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
      .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

    const parsedSQL = whereClause.split(" ");
    searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
      parsedSQL.forEach((node: any, index: any) => {
        if (node == field.name) {
          node = node.replaceAll('"', "");
          parsedSQL[index] = '"' + node + '"';
        }
      });
    });

    whereClause = parsedSQL.join(" ");
    query_context = query_context
      .split("[WHERE_CLAUSE]")
      .join(" WHERE " + whereClause);
  } else {
    query_context = query_context.replace("[WHERE_CLAUSE]", "");
  }

  return b64EncodeUnicode(query_context) || "";
};

const cancelActiveStream = () => {
  if (activeTraceId.value) {
    cancelStreamQueryBasedOnRequestId({ trace_id: activeTraceId.value });
    activeTraceId.value = null;
  }
};

const fetchValues = (from: number = 0, keyword: string = "") => {
  cancelActiveStream();

  const pageSize = defaultValuesCount.value;
  const { traceId } = generateTraceContext();

  const fetchPayload: any = {
    fields: [props.row.name],
    size: from + pageSize,
    from,
    no_count: false,
    start_time: searchObj.data.datetime.startTime,
    end_time: searchObj.data.datetime.endTime,
    stream_name: searchObj.data.stream.selectedStream.value,
    stream_type: "traces",
    sql: buildSql(),
    timeout: 30000,
    use_cache: (window as any).use_cache ?? true,
  };

  if (keyword) {
    fetchPayload.keyword = keyword;
  }

  const wsPayload = {
    queryReq: fetchPayload,
    type: "values" as const,
    traceId,
    org_id: store.state.selectedOrganization.identifier,
    meta: fetchPayload,
  };

  activeTraceId.value = traceId;
  fieldValuesState.value.isLoading = true;
  fieldValuesState.value.errMsg = "";

  fetchQueryDataWithHttpStream(wsPayload, {
    data: handleStreamResponse,
    error: handleStreamError,
    complete: handleStreamComplete,
    reset: handleStreamReset,
  });
};

const handleStreamResponse = (payload: any, response: any) => {
  if (response.type !== "search_response_hits") return;

  const isAppend = (payload.queryReq.from ?? 0) > 0;
  const pageSize = defaultValuesCount.value;

  try {
    const newValues: { key: string; count: number }[] = [];

    if (response.content?.results?.hits?.length) {
      response.content.results.hits.forEach((item: any) => {
        item.values?.forEach((subItem: any) => {
          newValues.push({
            key: subItem.zo_sql_key ? subItem.zo_sql_key : "null",
            count: parseInt(subItem.zo_sql_num),
          });
        });
      });
    }

    if (isAppend) {
      allFetchedValues.value = [...allFetchedValues.value, ...newValues];
    } else {
      allFetchedValues.value = newValues;
    }

    fieldValuesState.value.values = [...allFetchedValues.value];
    fieldValuesState.value.hasMore = newValues.length >= pageSize;
    fieldValuesState.value.isLoading = false;
  } catch (err) {
    console.error("Failed to process field values response:", err);
    fieldValuesState.value.errMsg = "Failed to fetch field values";
    fieldValuesState.value.isLoading = false;
  }
};

const handleStreamError = (payload: any, _err: any) => {
  fieldValuesState.value.isLoading = false;
  fieldValuesState.value.errMsg = "Failed to fetch field values";
  if (payload.traceId === activeTraceId.value) {
    activeTraceId.value = null;
  }
  $q.notify({
    type: "negative",
    message: `Error while fetching values for ${props.row.name}`,
  });
};

const handleStreamComplete = (payload: any, _traceId: string) => {
  fieldValuesState.value.isLoading = false;
  if (payload.traceId === activeTraceId.value) {
    activeTraceId.value = null;
  }
};

const handleStreamReset = (payload: any, _response: any) => {
  allFetchedValues.value = [];
  fieldValuesState.value = { isLoading: true, values: [], hasMore: false, errMsg: "" };
  fetchValues(currentFrom.value, currentKeyword.value);
};

const openFilterCreator = (event: any, { ftsKey }: any) => {
  if (ftsKey) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  allFetchedValues.value = [];
  currentFrom.value = 0;
  currentKeyword.value = "";
  fieldValuesState.value = { isLoading: true, values: [], hasMore: false, errMsg: "" };

  fetchValues(0, "");
};

const handleSearchFieldValues = (_fieldName: string, term: string) => {
  currentKeyword.value = term;
  currentFrom.value = 0;
  allFetchedValues.value = [];
  fetchValues(0, term);
};

const handleLoadMoreValues = (_fieldName: string) => {
  currentFrom.value += defaultValuesCount.value;
  fetchValues(currentFrom.value, currentKeyword.value);
};

const handleAddSearchTerm = (
  fieldName: string,
  value: string,
  action: string,
) => {
  if (action === "include") {
    addSearchTerm(
      fieldName === "duration"
        ? `${fieldName}>=${value}`
        : `${fieldName}='${value}'`,
    );
  } else {
    addSearchTerm(
      fieldName === "duration"
        ? `${fieldName}<=${value}`
        : `${fieldName}!='${value}'`,
    );
  }
};

const handleAddMultipleSearchTerms = (
  fieldName: string,
  values: string[],
  action: string,
) => {
  const terms = values
    .map((v) =>
      action === "include" ? `${fieldName}='${v}'` : `${fieldName}!='${v}'`,
    )
    .join(action === "include" ? " or " : " and ");
  addSearchTerm(terms);
};

const handleBeforeHide = () => {
  cancelActiveStream();
  fieldValuesPanelRef.value?.reset();
  allFetchedValues.value = [];
  currentFrom.value = 0;
  currentKeyword.value = "";
  fieldValuesState.value = { isLoading: false, values: [], hasMore: false, errMsg: "" };
};
</script>

<style lang="scss">
.field-type-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-right: 0.3rem;
  margin-left: 0.2rem;
  flex-shrink: 0;
  vertical-align: middle;
}

.field-expand-icon {
  position: absolute;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.field-expansion-header:hover .field-type-badge {
  opacity: 0;
}

.field-expansion-header:hover .field-expand-icon {
  opacity: 1;
}

.q-expansion-item {
  .field_overlay {
    visibility: hidden;

    .q-icon {
      opacity: 0;
    }
  }

  .q-item {
    display: flex;
    align-items: center;
    padding: 0;
    height: 32px !important;
    min-height: 32px !important;
  }
  .q-item__section--avatar {
    min-width: 12px;
    max-width: 12px;
    margin-right: 8px;
  }

  .filter-values-container {
    .q-item {
      padding-left: 4px;

      .q-focus-helper {
        background: none !important;
      }
    }
  }
  .q-item-type {
    &:hover {
      .field_overlay {
        visibility: visible;

        .q-icon {
          opacity: 1;
        }
      }
    }
  }
  .field-expansion-icon {
    margin-right: 4px !important;
    .q-icon {
      font-size: 18px;
      color: #808080;
    }
  }
}
</style>
