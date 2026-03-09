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
        <template v-if="row.name === 'duration'">
          <!-- Percentile stats -->
          <div
            v-if="durationPercentilesLoading"
            class="tw:flex tw:justify-center tw:py-[0.5rem]"
          >
            <q-spinner size="1rem" color="primary" />
          </div>
          <template v-else-if="hasPercentiles">
            <div
              v-for="p in PERCENTILE_LABELS"
              :key="p.key"
              class="tw:flex tw:items-center tw:justify-between tw:py-[0.15rem]"
            >
              <span
                class="tw:text-[0.7rem] tw:text-[var(--o2-text-secondary)] tw:w-[2rem] tw:shrink-0"
                >{{ p.label }}</span
              >
              <span
                class="tw:text-[0.75rem] tw:flex-1 tw:text-right tw:pr-[0.25rem]"
              >
                {{ formatDuration(percentiles[p.key]) }}
              </span>
              <div class="tw:flex tw:gap-[0.15rem]">
                <q-btn
                  :data-test="`log-search-subfield-list-equal-${row.name}-field-btn`"
                  size="0.25rem"
                  round
                  :title="`duration >= ${formatDuration(percentiles[p.key])}`"
                  @click.stop="
                    addSearchTerm(
                      `duration>='${formatTimeWithSuffix(percentiles[p.key])}'`,
                    )
                  "
                  class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                >
                  <q-icon
                    :name="outlinedArrowForwardIos"
                    class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                  />
                </q-btn>
                <q-btn
                  :data-test="`log-search-subfield-list-not-equal-${row.name}-field-btn`"
                  size="0.25rem"
                  round
                  :title="`duration <= ${formatDuration(percentiles[p.key])}`"
                  @click.stop="
                    addSearchTerm(
                      `duration<='${formatTimeWithSuffix(percentiles[p.key])}'`,
                    )
                  "
                  class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                >
                  <q-icon
                    :name="outlinedArrowBackIos"
                    class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                  />
                </q-btn>
              </div>
            </div>
          </template>
        </template>
        <FieldValuesPanel
          v-else
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
import { computed, onMounted, ref } from "vue";
import useTraces from "@/composables/useTraces";
import { b64EncodeUnicode, formatTimeWithSuffix } from "@/utils/zincutils";
import { useStore } from "vuex";
import FieldTypeBadge from "@/components/common/FieldTypeBadge.vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import {
  removeFieldFromWhereAST,
  logsUtils,
} from "@/composables/useLogs/logsUtils";
import useDurationPercentiles, {
  parseDurationWhereClause,
} from "@/composables/useDurationPercentiles";
import useParser from "@/composables/useParser";
import {
  outlinedArrowBackIos,
  outlinedArrowForwardIos,
} from "@quasar/extras/material-icons-outlined";

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
const sqlParser = ref<any>(null);

onMounted(async () => {
  const { sqlParser: loadSqlParser } = useParser();
  sqlParser.value = await loadSqlParser();
});

const PERCENTILE_LABELS = [
  { key: "p25", label: "P25" },
  { key: "p50", label: "P50" },
  { key: "p75", label: "P75" },
  { key: "p95", label: "P95" },
  { key: "p99", label: "P99" },
] as const;

const {
  percentiles,
  isLoading: durationPercentilesLoading,
  fetchPercentiles,
  cancelFetch: cancelPercentileFetch,
} = useDurationPercentiles();

const hasPercentiles = computed(() =>
  PERCENTILE_LABELS.some((p) => percentiles.value[p.key] !== null),
);

/**
 * Formats a raw microsecond value into a human-readable string with a dynamic
 * unit: µs for sub-millisecond, ms up to 1 s, s above that.
 */
const formatDuration = (us: number | null): string => {
  if (us === null) return "—";
  if (us < 1_000) return `${Math.round(us)} µs`;
  if (us < 1_000_000) {
    const ms = us / 1_000;
    return `${Number.isInteger(ms) ? ms : ms.toFixed(2)} ms`;
  }
  const s = us / 1_000_000;
  return `${Number.isInteger(s) ? s : s.toFixed(2)} s`;
};

const store = useStore();
const { searchObj } = useTraces();
const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
  useFieldValuesStream();

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

  whereClause = parseDurationWhereClause(
    whereClause,
    sqlParser.value,
    searchObj.data.stream.selectedStream.value,
  );

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

const extractWhereClause = (): string => {
  const query = searchObj.data.editorValue ?? "";
  const parts = query.split("|");
  return parts.length > 1 ? parts[1].trim() : parts[0].trim();
};

const openFilterCreator = (event: any, { ftsKey }: any) => {
  if (ftsKey) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  if (props.row.name === "duration") {
    fetchPercentiles({
      streamName: searchObj.data.stream.selectedStream.value,
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      whereClause: extractWhereClause(),
    });
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
  if (props.row.name === "duration") {
    cancelPercentileFetch();
    return;
  }
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
