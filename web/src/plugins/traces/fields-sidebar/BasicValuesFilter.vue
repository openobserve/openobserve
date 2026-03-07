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
      <div
        class="flex content-center ellipsis full-width field-expansion-header"
        :title="row.name"
      >
        <div
          class="field_label ellipsis tw:flex tw:items-center"
          style="width: calc(100% - 28px); font-size: 14px"
          :title="row.label || row.name"
        >
          <span
            v-if="row.dataType"
            class="field-type-container"
            :title="row.dataType"
          >
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
          :field-values="
            fieldValues[row.name] || {
              isLoading: false,
              values: [],
              hasMore: false,
              errMsg: '',
            }
          "
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
import { b64EncodeUnicode } from "@/utils/zincutils";
import { useStore } from "vuex";
import FieldTypeBadge from "@/components/common/FieldTypeBadge.vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import { removeFieldFromWhereAST, logsUtils } from "@/composables/useLogs/logsUtils";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
});

const isExpanded = ref(false);
const fieldValuesPanelRef = ref();
const currentFrom = ref(0);
const currentKeyword = ref("");

const store = useStore();
const { searchObj } = useTraces();
const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
  useFieldValuesStream();
const { fnParsedSQL, fnUnparsedSQL } = logsUtils();

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

  // Remove the expanded field's own filter so value counts are not constrained
  // by the condition the user is exploring.
  let sqlForValues = query_context;
  try {
    const parsedForValues = fnParsedSQL(query_context);
    if (parsedForValues?.from?.length > 0) {
      const modifiedWhere = removeFieldFromWhereAST(
        parsedForValues.where,
        props.row.name,
      );
      const modifiedSQL = fnUnparsedSQL({
        ...parsedForValues,
        where: modifiedWhere,
      }).replace(/`/g, '"');
      if (modifiedSQL) {
        sqlForValues = modifiedSQL;
      }
    }
  } catch {
    // Fall back to original SQL if AST manipulation fails
  }

  return b64EncodeUnicode(sqlForValues) || "";
};

const fetchValues = (from: number = 0, keyword: string = "") => {
  const fetchPayload: any = {
    fields: [props.row.name],
    size: from + defaultValuesCount.value,
    from,
    no_count: false,
    start_time: searchObj.data.datetime.startTime,
    end_time: searchObj.data.datetime.endTime,
    stream_name: searchObj.data.stream.selectedStream.value,
    stream_type: "traces",
    sql: buildSql(),
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  };

  if (keyword) {
    fetchPayload.keyword = keyword;
  }

  fetchFieldValues(fetchPayload);
};

const openFilterCreator = (event: any, { ftsKey }: any) => {
  if (ftsKey) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  currentFrom.value = 0;
  currentKeyword.value = "";
  cancelFieldStream(props.row.name);
  resetFieldValues(props.row.name, true);
  fetchValues(0, "");
};

const handleSearchFieldValues = (_fieldName: string, term: string) => {
  currentKeyword.value = term;
  currentFrom.value = 0;
  cancelFieldStream(props.row.name);
  resetFieldValues(props.row.name, true);
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
  const joinOp = action === "include" ? " or " : " and ";
  const expressions = values.map((v) =>
    action === "include" ? `${fieldName}='${v}'` : `${fieldName}!='${v}'`,
  );
  const combined =
    expressions.length > 1 ? `(${expressions.join(joinOp)})` : expressions[0];
  addSearchTerm(combined);
};

const handleBeforeHide = () => {
  cancelFieldStream(props.row.name);
  fieldValuesPanelRef.value?.reset();
  currentFrom.value = 0;
  currentKeyword.value = "";
  resetFieldValues(props.row.name);
};
</script>

<style lang="scss">
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
