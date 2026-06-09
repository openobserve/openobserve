<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="tw:flex tw:flex-col index-menu default-index-menu tw:h-full!">
    <div class="index-table logs-index-menu tw:h-full!">
      <OFieldList
        ref="fieldListRef"
        :fields="fieldListItems"
        row-key="name"
        :search-placeholder="t('search.searchField')"
        :page-size="50"
        :current-page="currentPage"
        :page-size-options="[50]"
        :expanded-ids="expandedIds"
        :loading="loading"
        @update:current-page="currentPage = $event"
        @update:expanded-ids="onExpandedIdsChange"
        @row-click="onRowClick"
      >
        <!-- Field row: render field name with expand chevron + actions inside OFieldRow -->
        <template #field-row="{ row }">
          <OFieldRow :highlight="!!expandedRows[row.name]">
            <span class="field-type-container">
              <OIcon
                class="field-expand-icon"
                :name="expandedRows[row.name] ? 'expand-more' : 'chevron-right'"
                size="sm"
              />
            </span>
            <OFieldLabel :field="row" />
            <template #actions>
              <OButton
                v-if="!hideAddSearchTerm"
                variant="ghost-neutral"
                size="icon"
                :data-test="`log-search-index-list-filter-${row.name}-field-btn`"
                @click.stop="addSearchTerm(`${row.name}=''`)"
              >
                <OIcon name="add" size="sm" />
              </OButton>
              <OButton
                v-if="!hideCopyValue && isExpandable(row)"
                variant="ghost-neutral"
                size="icon"
                :data-test="`log-search-index-list-filter-${row.name}-copy-btn`"
                @click.stop="copyContentValue(row.name)"
              >
                <OIcon name="content-copy" size="sm" />
              </OButton>
            </template>
          </OFieldRow>
        </template>

        <!-- Expansion: FieldValuesPanel -->
        <template #expansion="{ row }">
          <div class="tw:pl-2 tw:pr-1 tw:py-1">
            <FieldValuesPanel
              :field-name="row.name"
              :field-values="fieldValues[row.name]"
              :show-multi-select="!hideIncludeExlcude"
              :default-values-count="defaultValuesCount"
              :theme="store.state.theme"
              :active-include-values="activeIncludeFilterValues[row.name] ?? []"
              :active-exclude-values="activeExcludeFilterValues[row.name] ?? []"
              @add-search-term="handleAddSearchTerm"
              @add-multiple-search-terms="handleAddMultipleSearchTerms"
              @remove-field-filter="handleRemoveFieldFilter"
              @load-more-values="handleLoadMoreValues"
              @search-field-values="handleSearchFieldValues"
            />
          </div>
        </template>

        <!-- Loading skeleton -->
        <template #loading>
          <div
            data-test="search-fieldlist-loading-skeleton"
            class="tw:w-full tw:flex tw:flex-col"
          >
            <!-- Group 1 header -->
            <div class="tw:h-7 tw:flex tw:items-center tw:justify-between tw:px-2">
              <OSkeleton type="rect" class="tw:h-3 tw:w-24 tw:rounded-sm" />
              <OSkeleton type="rect" class="tw:h-3 tw:w-3 tw:rounded-sm" />
            </div>
            <!-- Group 1 fields -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:flex-1" />
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:w-3/4" />
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:flex-1" />
            </div>
            <!-- Group 2 header -->
            <div class="tw:h-7 tw:flex tw:items-center tw:justify-between tw:px-2 tw:mt-2">
              <OSkeleton type="rect" class="tw:h-3 tw:w-16 tw:rounded-sm" />
              <OSkeleton type="rect" class="tw:h-3 tw:w-3 tw:rounded-sm" />
            </div>
            <!-- Group 2 fields -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:w-4/5" />
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:w-2/3" />
            </div>
            <!-- Group 3 header -->
            <div class="tw:h-7 tw:flex tw:items-center tw:justify-between tw:px-2 tw:mt-2">
              <OSkeleton type="rect" class="tw:h-3 tw:w-32 tw:rounded-sm" />
              <OSkeleton type="rect" class="tw:h-3 tw:w-3 tw:rounded-sm" />
            </div>
            <!-- Group 3 fields -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:flex-1" />
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:w-3/4" />
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-[0.375rem]">
              <OSkeleton type="rect" class="tw:w-[0.875rem] tw:h-[0.875rem] tw:rounded-sm tw:shrink-0" />
              <OSkeleton type="text" class="tw:flex-1" />
            </div>
          </div>
        </template>

        <!-- After list: pagination -->
        <template #after-list="bottomProps">
          <div v-if="bottomProps.totalPages > 1" class="field-list-pagination">
            <OTooltip
              side="left"
              align="center"
              max-width="18.75rem"
              :content="`Total Fields: ${bottomProps.totalRows}`"
            />
            <OButton
              variant="ghost-primary"
              size="icon-panel"
              :disabled="bottomProps.isFirstPage"
              @click="bottomProps.firstPage"
              class="pagination-nav-btn"
            >
              <OIcon name="fast-rewind" size="sm" />
            </OButton>
            <template
              v-for="page in visiblePagesForTotal(bottomProps)"
              :key="page"
            >
              <OButton
                :variant="
                  bottomProps.currentPage === page ? 'primary' : 'ghost'
                "
                size="icon-panel"
                class="pagination-page-btn"
                @click="setPage(page)"
                >{{ page }}</OButton
              >
            </template>
            <OButton
              variant="ghost-primary"
              size="icon-panel"
              :disabled="bottomProps.isLastPage"
              @click="bottomProps.lastPage"
              class="pagination-nav-btn"
            >
              <OIcon name="fast-forward" size="sm" />
            </OButton>
          </div>
        </template>
      </OFieldList>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { copyToClipboard } from "@/utils/clipboard";
import { logsUtils } from "@/composables/useLogs/logsUtils";

const props = defineProps({
  fields: {
    type: Array,
    default: () => [],
  },
  streamName: {
    type: String,
    default: "",
  },
  timeStamp: {
    type: Object,
    default: () => ({ endTime: "", startTime: "" }),
  },
  streamType: {
    type: String,
    default: "logs",
  },
  hideIncludeExlcude: {
    type: Boolean,
    default: false,
  },
  hideCopyValue: {
    type: Boolean,
    default: true,
  },
  hideAddSearchTerm: {
    type: Boolean,
    default: false,
  },
  query: {
    type: String,
    default: "",
  },
  showCount: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  "event-emitted": [event: string, payload?: any];
}>();

const store = useStore();
const { t } = useI18n();

const expandedRows: Ref<Record<string, boolean>> = ref({});
const expandedIds = ref<string[]>([]);
const currentPage = ref(1);
const fieldListRef = ref<InstanceType<typeof OFieldList> | null>(null);

const defaultValuesCount = computed(
  () => store.state.zoConfig?.query_values_default_num || 10,
);

const showFtsFieldValues = computed(
  () => store.state.zoConfig?.showFtsFieldValues ?? false,
);

// ─── Derive currently-filtered values from the active query ──────────
// Mirrors logs IndexList.vue's activeIncludeFilterValues/activeExcludeFilterValues
// so previously selected checkboxes stay ticked when a field is re-expanded.
// The query here is a non-SQL flat WHERE string (e.g. `a='x' and b!='y'`); we
// wrap it as `select * from stream where ${query}` and reuse the SQL AST walker
// from useLogs so paren'd OR groups (built by handleAddMultipleSearchTerms) are
// handled correctly.

const { fnParsedSQL } = logsUtils();

const extractColName = (col: any): string | null => {
  if (typeof col === "string") return col.replace(/^"|"$/g, "");
  if (col?.expr?.value != null) return String(col.expr.value);
  return null;
};

function walkFilters(
  query: string,
): { include: Record<string, string[]>; exclude: Record<string, string[]> } {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  if (!query?.trim()) return { include, exclude };

  try {
    const parsed = fnParsedSQL(`select * from stream where ${query}`);
    if (!parsed?.where) return { include, exclude };

    const push = (
      target: Record<string, string[]>,
      field: string,
      value: string,
    ) => {
      if (!target[field]) target[field] = [];
      if (!target[field].includes(value)) target[field].push(value);
    };

    const walk = (node: any) => {
      if (!node) return;
      const op = node.operator?.toUpperCase();
      if (op === "AND" || op === "OR") {
        walk(node.left);
        walk(node.right);
      } else if (op === "=") {
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col && node.right?.value != null) {
            push(include, col, String(node.right.value));
          }
        }
      } else if (op === "!=" || op === "<>") {
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col && node.right?.value != null) {
            push(exclude, col, String(node.right.value));
          }
        }
      } else if (op === "IS") {
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col) push(include, col, "");
        }
      } else if (op === "IS NOT") {
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col) push(exclude, col, "");
        }
      }
    };
    walk(parsed.where);
  } catch {
    // ignore parse errors — partial/invalid queries just produce empty filters
  }
  return { include, exclude };
}

const parsedFilters = computed(() => walkFilters((props as any).query));
const activeIncludeFilterValues = computed(() => parsedFilters.value.include);
const activeExcludeFilterValues = computed(() => parsedFilters.value.exclude);

// Build field items — pass all fields, rendering handles expandable vs non
const fieldListItems = computed(() => props.fields as any[]);

// ─── Field value streaming ──────────────────────────────────────────

const {
  fieldValues,
  fieldValuesFinalizedValues,
  fieldValuesCurrentSize,
  fetchFieldValues,
  cancelFieldStream,
  resetFieldValues,
} = useFieldValuesStream();

const currentSizePerField: Ref<Record<string, number>> = ref({});
const currentKeyword: Ref<Record<string, string>> = ref({});
const fieldValuesTimeRange: Ref<
  Record<string, { start_time: number; end_time: number }>
> = ref({});

// ─── SQL helper ──────────────────────────────────────────────────────

const buildSql = (streamName: string, whereClause?: string) =>
  b64EncodeUnicode(
    `SELECT * FROM "${streamName}"${whereClause ? ` WHERE ${whereClause}` : ""}`,
  ) || "";

// ─── Expansion handling ──────────────────────────────────────────────

function isExpandable(row: any) {
  if (row.ftsKey && !showFtsFieldValues.value) return false;
  if (!row.showValues) return false;
  return true;
}

function onRowClick(row: any) {
  if (!isExpandable(row)) return;
  // Toggle expansion on row click
  const currentlyExpanded = expandedRows.value[row.name];
  if (currentlyExpanded) {
    closeField(row.name);
  } else {
    openFilterCreator(row);
  }
}

function onExpandedIdsChange(ids: string[]) {
  const prevIds = new Set(expandedIds.value);
  const newIds = new Set(ids);

  // Collapse rows that were removed
  for (const id of prevIds) {
    if (!newIds.has(id)) {
      closeField(id);
    }
  }

  // Expand rows that were added — fetch field values
  for (const id of newIds) {
    if (!prevIds.has(id)) {
      const row = (props.fields as any[]).find((f: any) => f.name === id);
      if (row && isExpandable(row)) {
        openFilterCreator(row);
      }
    }
  }
}

function openFilterCreator({ name, ftsKey, stream_name }: any) {
  if (ftsKey && !showFtsFieldValues.value) return;

  cancelFieldStream(name);
  currentSizePerField.value[name] = defaultValuesCount.value;
  currentKeyword.value[name] = "";
  fieldValuesTimeRange.value[name] = {
    start_time: (props.timeStamp as any).startTime,
    end_time: (props.timeStamp as any).endTime,
  };
  resetFieldValues(name, true);

  const resolvedStream = stream_name || props.streamName;
  fieldValuesCurrentSize.value[name] = defaultValuesCount.value;
  expandedRows.value[name] = true;
  if (!expandedIds.value.includes(name)) {
    expandedIds.value = [...expandedIds.value, name];
  }

  fetchFieldValues({
    fields: [name],
    size: defaultValuesCount.value,
    no_count: false,
    start_time: (props.timeStamp as any).startTime,
    end_time: (props.timeStamp as any).endTime,
    stream_name: resolvedStream,
    stream_type: props.streamType,
    sql: buildSql(resolvedStream, (props as any).query || undefined),
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
}

function closeField(fieldName: string) {
  cancelFieldStream(fieldName);
  expandedRows.value[fieldName] = false;
  currentSizePerField.value[fieldName] = 0;
  currentKeyword.value[fieldName] = "";
  delete fieldValuesTimeRange.value[fieldName];
  resetFieldValues(fieldName);
  expandedIds.value = expandedIds.value.filter((id) => id !== fieldName);
}

// ─── Pagination ──────────────────────────────────────────────────────

function visiblePagesForTotal(bottomProps: any) {
  const pages: number[] = [];
  const page = bottomProps.currentPage;
  const total = Math.max(1, bottomProps.totalPages);
  if (total <= 3) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    let start = Math.max(1, page - 1);
    let end = Math.min(total, start + 2);
    if (end === total) start = Math.max(1, end - 2);
    for (let i = start; i <= end; i++) pages.push(i);
  }
  return pages;
}

function setPage(page: number) {
  currentPage.value = page;
}

// ─── FieldValuesPanel event handlers ─────────────────────────────────

const handleSearchFieldValues = (fieldName: string, term: string) => {
  const row: any = (props.fields as any[]).find(
    (f: any) => f.name === fieldName,
  );
  const resolvedStream = row?.stream_name || props.streamName;
  currentKeyword.value[fieldName] = term;
  currentSizePerField.value[fieldName] = defaultValuesCount.value;
  fieldValuesCurrentSize.value[fieldName] = defaultValuesCount.value;
  delete fieldValuesFinalizedValues.value[fieldName];
  cancelFieldStream(fieldName);
  resetFieldValues(fieldName, true);

  const pinnedTime = fieldValuesTimeRange.value[fieldName];
  fetchFieldValues({
    fields: [fieldName],
    size: defaultValuesCount.value,
    no_count: false,
    start_time: pinnedTime?.start_time ?? (props.timeStamp as any).startTime,
    end_time: pinnedTime?.end_time ?? (props.timeStamp as any).endTime,
    stream_name: resolvedStream,
    stream_type: props.streamType,
    sql: buildSql(resolvedStream, (props as any).query || undefined),
    keyword: term || undefined,
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
};

const handleLoadMoreValues = (fieldName: string) => {
  const row: any = (props.fields as any[]).find(
    (f: any) => f.name === fieldName,
  );
  const resolvedStream = row?.stream_name || props.streamName;
  const newSize =
    (currentSizePerField.value[fieldName] ?? defaultValuesCount.value) +
    defaultValuesCount.value;
  currentSizePerField.value[fieldName] = newSize;
  fieldValuesCurrentSize.value[fieldName] = newSize;
  fieldValuesFinalizedValues.value[fieldName] = [
    ...(fieldValues.value[fieldName]?.values || []),
  ];

  const pinnedTime = fieldValuesTimeRange.value[fieldName];
  fetchFieldValues({
    fields: [fieldName],
    size: newSize,
    no_count: false,
    start_time: pinnedTime?.start_time ?? (props.timeStamp as any).startTime,
    end_time: pinnedTime?.end_time ?? (props.timeStamp as any).endTime,
    stream_name: resolvedStream,
    stream_type: props.streamType,
    sql: buildSql(resolvedStream, (props as any).query || undefined),
    keyword: currentKeyword.value[fieldName] || undefined,
    timeout: 30000,
    use_cache: (globalThis as any).use_cache ?? true,
  });
};

const isNullValue = (v: string) =>
  v === null || v === undefined || v === "" || v.toLowerCase() === "null";

const buildExpression = (fieldName: string, v: string, action: string) =>
  isNullValue(v)
    ? action === "include"
      ? `${fieldName} IS NULL`
      : `${fieldName} IS NOT NULL`
    : action === "include"
      ? `${fieldName}='${v}'`
      : `${fieldName}!='${v}'`;

const handleAddSearchTerm = (
  fieldName: string,
  value: string,
  action: string,
) => {
  addSearchTerm(buildExpression(fieldName, value, action));
};

const handleAddMultipleSearchTerms = (
  fieldName: string,
  values: string[],
  action: string,
) => {
  const joinOp = action === "include" ? " or " : " and ";
  const expressions = values.map((v) => buildExpression(fieldName, v, action));
  addSearchTerm(
    expressions.length > 1 ? `(${expressions.join(joinOp)})` : expressions[0],
  );
};

const handleRemoveFieldFilter = (fieldName: string) => {
  emit("event-emitted", "remove-field", fieldName);
};

const addSearchTerm = (term: string) => {
  emit("event-emitted", "add-field", term);
};

const copyContentValue = (value: string) => {
  copyToClipboard(value, { successMessage: "Value copied to clipboard" });
};
</script>

<style lang="scss" scoped>
.field-list-pagination {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.pagination-nav-btn {
  padding: 0.375rem 0.25rem !important;
  margin: 0 !important;
  min-width: 1.5rem !important;
  width: 1.5rem !important;
  min-height: 1.375rem !important;
  height: 1.375rem !important;
  border-radius: 0.25rem !important;
  overflow: visible !important;
}

.pagination-page-btn {
  padding: 0.375rem 0.25rem !important;
  margin: 0 !important;
  min-width: 1.5rem !important;
  width: 1.5rem !important;
  min-height: 1.375rem !important;
  height: 1.375rem !important;
  font-size: 0.75rem !important;
  font-weight: 500;
  line-height: 1;
  color: var(--o2-text-primary) !important;
  border-radius: 0.25rem !important;
  overflow: visible !important;
}

.index-menu {
  width: 100%;

  .index-table {
    width: 100%;
  }

  .field-type-container {
    width: 0.55rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .field-expand-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1rem;
    color: var(--o2-text-muted);
  }
}
</style>
