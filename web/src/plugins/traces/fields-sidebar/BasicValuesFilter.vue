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
          class="field_label tw:ellipsis! tw:flex tw:items-center tw:w-full"
          style="font-size: 14px"
          :title="row.label || row.name"
        >
          <span v-if="row.dataType" class="field-type-container">
            <q-icon
              class="field-expand-icon"
              :name="isExpanded ? 'expand_less' : 'expand_more'"
              size="1rem"
            />
          </span>
          {{ row.label || row.name }}
        </div>
        <div
          class="field_overlay tw:bg-[var(--o2-hover-accent)] tw:absolute tw:right-0! tw:h-full tw:top-0 tw:flex! tw:items-center! tw:rounded"
        >
          <q-btn
            :data-test="`log-search-index-list-filter-${row.name}-field-btn`"
            :icon="outlinedAdd"
            size="0.4rem"
            class="tw:mx-[0.375rem]!"
            @click.stop="addSearchTerm(`${row.name}=''`)"
            round
          />
          <q-icon
            :data-test="`log-search-index-list-add-${row.name}-field-btn`"
            v-if="showVisibilityToggle && !isFieldSelected"
            :name="outlinedVisibility"
            size="1.1rem"
            title="Add field to table"
            class="tw:cursor-pointer! tw:mr-[0.375rem]!"
            @click.stop="$emit('toggle-field', row)"
          />
          <q-icon
            :data-test="`log-search-index-list-remove-${row.name}-field-btn`"
            v-if="showVisibilityToggle && isFieldSelected"
            :name="outlinedVisibilityOff"
            size="1.1rem"
            title="Remove field from table"
            class="tw:cursor-pointer! tw:mr-[0.375rem]!"
            @click.stop="$emit('toggle-field', row)"
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
              class="tw:flex tw:items-center tw:justify-between tw:py-[0.15rem] tw:pl-[0.5rem]"
            >
              <span class="tw:text-[0.75rem] tw:w-[2rem] tw:shrink-0">{{
                p.label
              }}</span>
              <span
                class="tw:text-[0.75rem] tw:flex-1 tw:text-right tw:pr-[0.25rem]"
              >
                {{ formatDuration(percentiles[p.key]) }}
              </span>
              <div class="tw:flex">
                <q-btn
                  :data-test="`log-search-subfield-list-equal-${row.name}-field-btn`"
                  size="0.3rem"
                  round
                  :title="`duration >= ${formatDuration(percentiles[p.key])}`"
                  @click.stop="
                    addSearchTerm(
                      `duration>='${formatTimeWithSuffix(percentiles[p.key])}'`,
                    )
                  "
                  class="o2-custom-button-hover tw:ml-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                >
                  <q-icon
                    :name="outlinedArrowForwardIos"
                    class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                  />
                </q-btn>
                <q-btn
                  :data-test="`log-search-subfield-list-not-equal-${row.name}-field-btn`"
                  size="0.3rem"
                  round
                  :title="`duration <= ${formatDuration(percentiles[p.key])}`"
                  @click.stop="
                    addSearchTerm(
                      `duration<='${formatTimeWithSuffix(percentiles[p.key])}'`,
                    )
                  "
                  class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.625rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                >
                  <q-icon
                    :name="outlinedArrowBackIos"
                    class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                  />
                </q-btn>
              </div>
            </div>
          </template>
          <!-- No values found -->
          <div
            v-else-if="!hasPercentiles"
            class="q-pl-md q-py-xs text-subtitle2"
          >
            {{ percentileErrMsg || "No values found" }}
          </div>
        </template>
        <FieldValuesPanel
          v-else
          ref="fieldValuesPanelRef"
          :field-name="row.name"
          :field-values="
            mappedFieldValues || {
              isLoading: false,
              values: [],
              hasMore: false,
              errMsg: '',
            }
          "
          :show-multi-select="true"
          :default-values-count="defaultValuesCount"
          :theme="store.state.theme"
          :active-include-values="activeIncludeValues"
          :active-exclude-values="activeExcludeValues"
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
import { computed, onMounted, ref, unref } from "vue";
import useTraces from "@/composables/useTraces";
import {
  b64EncodeUnicode,
  b64DecodeUnicode,
  formatTimeWithSuffix,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
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
import { SPAN_KIND_MAP } from "@/utils/traces/constants";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
  activeIncludeValues: {
    type: Array as () => string[],
    default: () => [],
  },
  activeExcludeValues: {
    type: Array as () => string[],
    default: () => [],
  },
  selectedFields: {
    type: Array as () => string[],
    default: () => [],
  },
  showVisibilityToggle: {
    type: Boolean,
    default: true,
  },
});

defineEmits<{
  "toggle-field": [field: any];
}>();

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.row?.name),
);

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
  errMsg: percentileErrMsg,
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

const EMPTY_FIELD_VALUES = {
  isLoading: false,
  values: [],
  hasMore: false,
  errMsg: "",
};

const mappedFieldValues = computed(() => {
  const entry = unref(fieldValues)[props.row?.name] ?? EMPTY_FIELD_VALUES;
  if (props.row?.name !== "span_kind") return entry;
  return {
    ...entry,
    values: entry.values.map((v: { key: string; count: number }) => ({
      ...v,
      label:
        v.key === null || v.key === undefined || v.key === ""
          ? "Unspecified"
          : (SPAN_KIND_MAP[v.key] ?? v.key),
    })),
  };
});
const { fnParsedSQL, fnUnparsedSQL } = logsUtils();

const defaultValuesCount = computed(
  () => store.state.zoConfig?.query_values_default_num || 10,
);

const showFtsFieldValues = computed(
  () => store.state.zoConfig?.show_fts_field_values ?? false,
);

const addSearchTerm = (term: string) => {
  searchObj.data.stream.addToFilter = term;
};

/**
 * Remove conditions referencing `fieldName` from a flat AND-chained WHERE
 * string.  Returns an empty string when all conditions are removed.
 */
const removeFieldFromWhere = (
  whereClause: string,
  fieldName: string,
): string => {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Single condition: field='val', field!='val', field>=val, etc.
  const fieldPattern = new RegExp(`^"?${escaped}"?\\s*[=!<>]`, "i");
  // Parenthesized multi-value group: (field='x' or field='y')
  const multiPattern = new RegExp(`^\\(\\s*"?${escaped}"?\\s*[=!<>]`, "i");
  const remaining = whereClause.split(/\s+AND\s+/i).filter((cond) => {
    const trimmed = cond.trim();
    return !fieldPattern.test(trimmed) && !multiPattern.test(trimmed);
  });
  return remaining.join(" AND ");
};

/**
 * Build base64-encoded SQL for field-value queries with the expanded field's
 * own filter excluded from the WHERE clause so value counts are unbiased.
 */
const buildSql = (): string => {
  const fieldName = props.row.name;
  const query = searchObj.data.editorValue;
  const parts = query.split("|");
  let whereClause = (parts.length > 1 ? parts[1] : parts[0]).trim();

  const durationParseResult = parseDurationWhereClause(
    whereClause,
    sqlParser.value,
    searchObj.data.stream.selectedStream.value,
  );
  if (typeof durationParseResult === "string") {
    whereClause = durationParseResult;
  }

  const streamName = searchObj.data.stream.selectedStream.value;
  let sql = `SELECT * FROM "${streamName}"`;

  if (whereClause !== "") {
    const filteredWhere = removeFieldFromWhere(whereClause, fieldName);
    if (filteredWhere.trim() !== "") {
      sql += ` WHERE ${filteredWhere}`;
    }
  }

  return b64EncodeUnicode(sql) || "";
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
  if (ftsKey && !showFtsFieldValues.value) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  if (props.row.name === "duration") {
    const decodedSql = b64DecodeUnicode(buildSql());
    const whereMatch = decodedSql.match(/\bWHERE\b\s+([\s\S]+)$/i);
    fetchPercentiles({
      streamName: searchObj.data.stream.selectedStream.value,
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      whereClause: whereMatch ? whereMatch[1].trim() : "",
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

defineExpose({ buildSql, openFilterCreator });
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
