<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex flex-col w-full index-menu default-index-menu h-full!">
    <div class="index-table h-full! w-full">
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
        @update:search="searchTerm = $event"
        @row-click="onRowClick"
      >
        <!-- Group header (only rendered for grouped/label rows) -->
        <template #group-header="{ row, groupName }">
          <div
            class="field-group-header h-full w-[calc(100%+2*var(--spacing-page-edge))] shrink-0 -ml-page-edge px-page-edge flex justify-between items-center font-semibold text-xs leading-7 cursor-pointer bg-surface-subtle text-field-list-group-text"
            :data-test="`search-field-list-group-${row.group}-header`"
            @click="toggleGroup(row.group)"
          >
            <div class="flex-1 min-w-0 truncate">
              {{ groupName }} ({{ groupFieldCount[row.group] ?? 0 }})
            </div>
            <OButton
              v-if="(groupFieldCount[row.group] ?? 0) > 0"
              variant="ghost"
              size="icon"
              class="flex-shrink-0"
            >
              <OIcon
                :name="expandGroupRows[row.group] !== false ? 'expand-more' : 'chevron-right'"
                size="sm"
              />
            </OButton>
          </div>
        </template>

        <!-- Field row: render field name with expand chevron + actions inside OFieldRow -->
        <template #field-row="{ row }">
          <OFieldRow>
            <span class="field-type-container relative w-[0.55rem] h-4 mr-[0.3rem] ml-[0.2rem] shrink-0 flex items-center justify-center">
              <OIcon
                class="field-expand-icon absolute inline-flex items-center justify-center shrink-0 w-4 text-text-muted"
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
          <div class="pl-2 pr-1 py-1">
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
            class="w-full flex flex-col"
          >
            <!-- Group 1 header -->
            <div class="h-7 flex items-center justify-between px-2">
              <OSkeleton type="rect" class="h-3 w-24 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 1 fields -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-3/4" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <!-- Group 2 header -->
            <div class="h-7 flex items-center justify-between px-2 mt-2">
              <OSkeleton type="rect" class="h-3 w-16 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 2 fields -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-4/5" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-2/3" />
            </div>
            <!-- Group 3 header -->
            <div class="h-7 flex items-center justify-between px-2 mt-2">
              <OSkeleton type="rect" class="h-3 w-32 rounded-default" />
              <OSkeleton type="rect" class="h-3 w-3 rounded-default" />
            </div>
            <!-- Group 3 fields -->
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="w-3/4" />
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5">
              <OSkeleton type="rect" class="w-3.5 h-3.5 rounded-default shrink-0" />
              <OSkeleton type="text" class="flex-1" />
            </div>
          </div>
        </template>

        <!-- After list: pagination -->
        <template #after-list="bottomProps">
          <div v-if="bottomProps.totalPages > 1" class="flex items-center gap-1 ml-auto">
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
              class="py-1.5 px-1! m-0! min-w-6! w-6! min-h-5.5! h-5.5! rounded-default! overflow-visible!"
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
                class="py-1.5 px-1! m-0! min-w-6! w-6! min-h-5.5! h-5.5! text-xs! font-medium leading-none text-text-body! rounded-default! overflow-visible!"
                @click="setPage(page)"
                >{{ page }}</OButton
              >
            </template>
            <OButton
              variant="ghost-primary"
              size="icon-panel"
              :disabled="bottomProps.isLastPage"
              @click="bottomProps.lastPage"
              class="py-1.5 px-1! m-0! min-w-6! w-6! min-h-5.5! h-5.5! rounded-default! overflow-visible!"
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
import { computed, ref, watch, onMounted, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useFieldValuesStream from "@/composables/useFieldValuesStream";
import useFieldGrouping from "@/composables/useFieldGrouping";
import { applyCollapseFilter, type FieldObj } from "@/utils/fieldCategories";
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
  // Opt-in semantic field grouping (same mechanism as the logs field sidebar).
  // Off by default so existing flat consumers are unaffected.
  enableGrouping: {
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
        // IS NULL maps to the synthetic "null" key used by the value list so
        // the null row's checkbox round-trips (matches value.key === "null").
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col) push(include, col, "null");
        }
      } else if (op === "IS NOT") {
        if (node.left?.type === "column_ref") {
          const col = extractColName(node.left.column);
          if (col) push(exclude, col, "null");
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

// ─── Semantic field grouping (opt-in) ────────────────────────────────
// Reuses the exact mechanism the logs field sidebar uses: load the org's
// semantic groups / key fields / grouping config, bucket fields under label
// header rows, and collapse/expand groups. When grouping is disabled or no
// semantic index is configured, fields fall back to a flat list unchanged.

const { semanticIndex, loadGroupingContext, groupFields } = useFieldGrouping();
const searchTerm = ref("");
const expandGroupRows = ref<Record<string, boolean>>({});

onMounted(() => {
  if (props.enableGrouping) {
    loadGroupingContext(props.streamType).catch(() => {
      // grouping is best-effort — on failure the list stays flat
    });
  }
});

const groupingActive = computed(
  () => props.enableGrouping && semanticIndex.value !== null,
);

// Map raw schema fields → FieldObj, bucket them, and annotate label rows so
// OFieldList renders group headers (isGroup) vs field rows.
const groupedFields = computed<any[]>(() => {
  if (!groupingActive.value) return props.fields as any[];

  const fieldObjs: FieldObj[] = (props.fields as any[]).map((f) => ({
    ...f,
    name: f.name,
    dataType: f.dataType ?? f.type ?? "",
    ftsKey: !!f.ftsKey,
    isSchemaField: true,
    showValues: !!f.showValues,
    isInterestingField: false,
    group: "",
    streams: [],
  }));

  return groupFields(fieldObjs).map((row: any) => ({
    ...row,
    isGroup: !!row.label,
    groupName: row.label ? row.name : undefined,
  }));
});

// Count of non-group fields per group key — shown in the group header.
const groupFieldCount = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  if (!groupingActive.value) return counts;
  for (const row of groupedFields.value) {
    if (!row.isGroup && row.group) {
      counts[row.group] = (counts[row.group] ?? 0) + 1;
    }
  }
  return counts;
});

// Seed expand state to "expanded" for any newly seen group.
watch(
  groupedFields,
  (list) => {
    for (const row of list) {
      if (row.isGroup && row.group && !(row.group in expandGroupRows.value)) {
        expandGroupRows.value[row.group] = true;
      }
    }
  },
  { immediate: true },
);

function toggleGroup(group: string) {
  expandGroupRows.value[group] = expandGroupRows.value[group] === false;
}

// Build field items — flat passthrough, or grouped + collapse-filtered.
// applyCollapseFilter bypasses collapse while a search term is active so
// matches inside collapsed groups remain findable.
const fieldListItems = computed(() => {
  if (!groupingActive.value) return props.fields as any[];
  return applyCollapseFilter(
    groupedFields.value as FieldObj[],
    expandGroupRows.value,
    searchTerm.value,
  );
});

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
/* keep(lib-override:o2-field-list): reaches into OFieldList/FieldValuesPanel internals
   via :deep() — those elements are owned by the child component, so no utility on this
   template can reach them. */

// Expanded field values should read as inline content, not a selected card —
// drop the bordered/rounded panel treatment so no border or background lingers
// once the row is expanded and the pointer moves away.
:deep(.o-field-list__expansion) {
  border: none;
  border-radius: 0;
  margin-bottom: 0;
}

// Tighten the gap between expanded field values. FieldValuesPanel stacks
// padding on both the <li> and its inner <label> (py-1 on each), which
// reads as too much vertical space in the dense RUM sidebar. Drop the <li>
// padding here (RUM-scoped) and keep the label padding as the click target.
:deep(.o-field-list__expansion [data-test="field-values-panel-values-list"] > li) {
  padding-top: 0;
  padding-bottom: 0;
}

</style>
