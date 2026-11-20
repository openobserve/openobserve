<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex h-full min-h-0 w-full flex-col" data-test="stream-field-panel">
    <StreamPicker
      v-if="capabilities.streamPicker !== 'none'"
      :mode="capabilities.streamPicker"
      :stream-type="capabilities.streamType"
      :streams="streams"
      :selected="selectedStreams"
      :type="streamType"
      :loading="streamsLoading"
      :announcement="source.picker?.announcement?.value"
      :search-debounce="source.picker?.searchDebounce ?? 0"
      :close-signal="source.picker?.closeSignal?.value ?? 0"
      :types="source.picker?.streamTypes?.value"
      :locked="source.picker?.locked?.value ?? false"
      :option-tooltip="source.picker?.optionTooltip ?? false"
      :stream-test-id="streamTestId"
      :type-test-id="streamTypeTestId"
      @update:selected="source.selectStreams"
      @update:type="source.changeStreamType"
      @open="onPickerOpen"
      @close="source.picker?.onClose?.()"
      @search="(term: string) => source.picker?.onSearch?.(term)"
      @header-action="(option: StreamOption) => source.picker?.onHeaderAction?.(option)"
    >
      <template v-if="$slots['picker-before']" #before>
        <slot name="picker-before" />
      </template>
      <template v-if="$slots['picker-before-options']" #before-options>
        <slot name="picker-before-options" />
      </template>
      <template v-if="$slots['picker-after-options']" #after-options>
        <slot name="picker-after-options" />
      </template>
    </StreamPicker>

    <div
      v-if="noStream"
      class="flex min-h-0 flex-1 flex-col"
      data-test="stream-field-panel-no-stream"
    >
      <slot name="no-stream">
        <div
          class="text-field-list-empty-text flex flex-1 items-center justify-center gap-1.5 p-4 text-center text-xs"
        >
          <OIcon name="info" size="xs" />
          <span>{{ emptyTexts.noStream ?? t("emptyState.noStreamSelected.title") }}</span>
        </div>
      </slot>
    </div>

    <GroupedFieldList
      v-else
      :fields="fields"
      :search="search"
      :loading="loading"
      :current-page="currentPage"
      :page-size="PAGE_SIZE"
      :show-pagination="true"
      :row-key="rowKey"
      :keyboard="true"
      :draggable="capabilities.drag"
      :drag-enabled-fn="isDragEnabled"
      :expanded-ids="expandedFields"
      :expandable-fn="isExpandable"
      :collapsed-groups="collapsedGroups"
      @update:search="onSearch"
      @update:current-page="currentPage = $event"
      @update:expanded-ids="onExpandedIdsChange"
      @update:collapsed-groups="onCollapsedChange"
      @drag-start="
        (row: FieldItem, event: DragEvent) => source.dragStart?.(asPanelField(row), event)
      "
      @drag-end="(row: FieldItem, event: DragEvent) => source.dragEnd?.(asPanelField(row), event)"
    >
      <template #field-row="{ row, isDragEnabled, armDrag }">
        <FieldPanelRow
          :field="asPanelField(row)"
          :actions="capabilities.actions"
          :timestamp-column="timestampColumn"
          :expandable="isExpandable(row)"
          :expanded="expandedSet.has(keyOf(row))"
          :drag="capabilities.drag"
          :drag-enabled="isDragEnabled"
          :arm-drag="armDrag"
          :highlight="capabilities.highlightColumns && isColumn(row)"
          :is-column="isColumn(row)"
          :chips="chipsFor(row)"
          @add-filter="source.addFilter"
          @toggle-column="(field: PanelField) => source.toggleColumn?.(field)"
          @toggle-interesting="(field: PanelField) => source.toggleInteresting?.(field)"
          @chip="(field: PanelField, target: string) => source.chip?.(field, target)"
        />
      </template>

      <template #expansion="{ row }">
        <component
          :is="overrideFor(row)"
          v-if="overrideFor(row)"
          :field="asPanelField(row)"
          :request="source.valuesRequest(asPanelField(row))"
          @add-filter="source.addFilter"
        />
        <div v-else class="ps-2 pe-1">
          <div
            v-if="captionFor(row)"
            class="text-text-secondary py-1 text-xs"
            :data-test="captionFor(row)?.testId"
          >
            {{ captionFor(row)?.text }}
          </div>
          <FieldValuesPanel
            :field-name="row.name"
            :field-values="valuesFor(row)"
            :show-multi-select="capabilities.valueFilters !== false && canMultiSelect(row)"
            :active-include-values="activeIncludeValues[keyOf(row)] ?? []"
            :active-exclude-values="activeExcludeValues[keyOf(row)] ?? []"
            @set-value-filters="
              (_name: string, include: string[], exclude: string[]) =>
                source.addValueFilters(keyOf(row), include, exclude)
            "
            @remove-field-filter="source.removeFieldFilter(keyOf(row))"
            @load-more-values="source.loadMoreValues(keyOf(row))"
            @search-field-values="
              (_name: string, term: string) => source.searchValues(keyOf(row), term)
            "
          />
        </div>
      </template>

      <template #loading>
        <div :data-test="skeletonTestId" class="flex w-full flex-col" aria-busy="true">
          <template v-for="(group, groupIndex) in SKELETON_GROUPS" :key="groupIndex">
            <div
              class="flex h-7 items-center justify-between px-2"
              :class="groupIndex > 0 ? 'mt-2' : ''"
            >
              <OSkeleton type="rect" class="rounded-default h-3" :class="group.header" />
              <OSkeleton type="rect" class="rounded-default h-3 w-3" />
            </div>
            <div
              v-for="(width, rowIndex) in group.rows"
              :key="rowIndex"
              class="flex items-center gap-2 px-3 py-1.5"
            >
              <OSkeleton type="rect" class="rounded-default h-3.5 w-3.5 shrink-0" />
              <OSkeleton type="text" :class="width" />
            </div>
          </template>
        </div>
      </template>

      <template #empty>
        <div class="flex items-center justify-center py-3 text-center" :data-test="emptyTestId">
          <OIcon name="info" size="xs" />
          <span class="ps-1.5">{{ listEmptyText }}</span>
        </div>
      </template>

      <template v-if="$slots['before-list']" #after-search>
        <slot name="before-list" />
      </template>

      <template #after-list="pager">
        <FieldListPagination
          v-if="showFooter(pager.allRows ?? pager.totalRows)"
          :data-test-prefix="testIdPrefix"
          :show-schema-toggle="footerToggles.includes('schema')"
          :show-quick-mode="footerToggles.includes('interesting')"
          :show-reset="showReset"
          :use-user-defined-schemas="schemaTab"
          :show-only-interesting-fields="source.footerInterestingOnly?.value ?? false"
          :schema-toggle-options="schemaToggleOptions"
          :interesting-fields-toggle-options="INTERESTING_TOGGLE_OPTIONS"
          :current-page="pager.currentPage"
          :pages-number="pager.totalPages"
          :is-first-page="pager.isFirstPage"
          :is-last-page="pager.isLastPage"
          :total-fields-count="pager.allRows ?? pager.totalRows"
          :shown-fields-count="pager.totalRows"
          :page-size="pager.pageSize"
          @first-page="pager.firstPage()"
          @last-page="pager.lastPage()"
          @set-page="currentPage = $event"
          @toggle-schema="onSchemaToggle"
          @toggle-interesting-fields="
            (value: boolean) => source.footerToggle?.('interesting', value)
          "
          @reset-fields="source.resetColumns?.()"
        />
      </template>
    </GroupedFieldList>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import FieldListPagination from "@/components/common/FieldListPagination.vue";
import FieldPanelRow from "./FieldPanelRow.vue";
import StreamPicker from "./StreamPicker.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import type {
  FieldPanelCapabilities,
  FieldPanelEmptyTexts,
  FieldPanelSource,
  FooterToggle,
  PanelField,
  StreamOption,
} from "./fieldPanel.types";

const props = withDefaults(
  defineProps<{
    capabilities: FieldPanelCapabilities;
    source: FieldPanelSource;
    /** Footer control ids are prefixed per page so the existing e2e suites keep their selectors. */
    testIdPrefix?: string;
    skeletonTestId?: string;
    emptyTestId?: string;
    emptyText?: I18nText;
    streamTestId?: string;
    streamTypeTestId?: string;
  }>(),
  {
    testIdPrefix: "logs-page",
    skeletonTestId: "stream-field-panel-skeleton",
    emptyTestId: "stream-field-panel-empty",
    emptyText: undefined,
    streamTestId: undefined,
    streamTypeTestId: undefined,
  },
);

const { t } = useI18nTyped();
const store = useStore();

const PAGE_SIZE = 50;

const SKELETON_GROUPS = [
  { header: "w-24", rows: ["flex-1", "w-3/4", "flex-1", "w-4/5"] },
  { header: "w-16", rows: ["w-2/3", "flex-1"] },
  { header: "w-32", rows: ["flex-1", "w-3/4", "flex-1", "w-4/5"] },
] as const;

const INTERESTING_TOGGLE_OPTIONS = [
  { label: "", value: false, slot: "all_fields_slot" },
  { label: "", value: true, slot: "interesting_fields_slot" },
];

const SCHEMA_TAB = "user_defined_schema";

const currentPage = ref(1);

const streams = computed(() => props.source.streams.value);
const streamsLoading = computed(() => props.source.streamsLoading?.value ?? false);
const selectedStreams = computed(() => props.source.selectedStreams.value);
const streamType = computed(() => props.source.streamType.value);
const timestampColumn = computed<string>(() => store.state.zoConfig?.timestamp_column ?? "");

// Logs drives its own schema tab; any other page with a defined schema gets the same tab, owned here.
const ownSchemaTab = computed<boolean>(
  () =>
    !props.source.footerSchemaTab &&
    store.state.zoConfig?.user_defined_schemas_enabled === true &&
    (props.source.definedSchemaFields?.value?.length ?? 0) > 0,
);
const localSchemaTab = ref(SCHEMA_TAB);
const schemaTab = computed<string>(() =>
  ownSchemaTab.value ? localSchemaTab.value : (props.source.footerSchemaTab?.value ?? ""),
);

const footerToggles = computed<FooterToggle[]>(() => {
  const own = props.capabilities.footerToggles;
  return ownSchemaTab.value && !own.includes("schema") ? ["schema", ...own] : own;
});

function inDefinedSchema(row: PanelField, defined: Set<string>): boolean {
  if (row.columnLocked) return true;
  if (row.name === timestampColumn.value) return true;
  if (row.name === store.state.zoConfig?.all_fields_name) return true;
  return props.source.isDefinedSchemaField?.(row) ?? defined.has(row.name);
}

// Group headers are kept only while a field of their group is left.
function onlyDefinedSchema(rows: PanelField[]): PanelField[] {
  const defined = new Set(props.source.definedSchemaFields?.value ?? []);
  const kept = rows.filter((row) => row.isGroup || inDefinedSchema(row, defined));
  const groups = new Set(kept.filter((row) => !row.isGroup).map((row) => row.group));
  return kept.filter((row) => !row.isGroup || groups.has(row.group));
}

const fields = computed<PanelField[]>(() => {
  const rows =
    ownSchemaTab.value && localSchemaTab.value === SCHEMA_TAB
      ? onlyDefinedSchema(props.source.fields.value)
      : props.source.fields.value;
  const groupFn = props.source.groupFn;
  if (props.source.groupingMode !== "custom" || !groupFn) return rows;
  return groupFn(rows).flatMap((group) =>
    group.fields.length
      ? [
          {
            name: `__group_${group.key}`,
            dataType: "",
            ftsKey: false,
            isSchemaField: false,
            showValues: false,
            isGroup: true,
            groupName: group.label,
            group: group.key,
          },
          ...group.fields.map((field) => ({ ...field, group: group.key })),
        ]
      : [],
  );
});
const loading = computed(() => props.source.loading.value);
const search = computed(() => props.source.search.value);
const collapsedGroups = computed(() => props.source.collapsedGroups.value);
const expandedFields = computed(() => props.source.expandedFields.value);
const expandedSet = computed(() => new Set(expandedFields.value));
const activeIncludeValues = computed(() => props.source.activeIncludeValues.value);
const activeExcludeValues = computed(() => props.source.activeExcludeValues.value);
const tableColumns = computed(() => props.source.tableColumns?.value ?? []);
const rowKey = computed(() => props.source.rowKey ?? "name");

const showFtsFieldValues = computed<boolean>(
  () => store.state.zoConfig?.show_fts_field_values ?? false,
);

// The interesting tab joins the schema toggle only while the page offers interesting fields.
const schemaToggleOptions = computed(() => [
  { label: "", value: "user_defined_schema", slot: "user_defined_slot" },
  { label: "", value: "all_fields", slot: "all_fields_slot" },
  ...(props.capabilities.footerToggles.includes("interesting")
    ? [{ label: "", value: "interesting_fields", slot: "interesting_fields_slot" }]
    : []),
]);

const emptyTexts = computed<FieldPanelEmptyTexts>(() => props.source.emptyState?.value ?? {});

const listEmptyText = computed<I18nText>(() => {
  const own = emptyTexts.value;
  if (selectedStreams.value.length === 0 && own.noStream) return own.noStream;
  const text = search.value.trim() ? own.noMatch : own.noFields;
  return text ?? props.emptyText ?? t("search.noFieldFound");
});

// The skeleton wins over the no-stream state: a page still loading its streams may yet pick one.
const noStream = computed(
  () =>
    props.capabilities.streamPicker !== "none" &&
    selectedStreams.value.length === 0 &&
    !loading.value,
);

// The list slots hand back the generic row shape; the source only ever supplies panel fields.
const asPanelField = (row: FieldItem) => row as PanelField;

const keyOf = (row: FieldItem) => String(row[rowKey.value] ?? row.name);

function isExpandable(row: FieldItem): boolean {
  if (!props.capabilities.values || row.isGroup) return false;
  return (
    row.isSchemaField === true &&
    row.showValues === true &&
    !(row.ftsKey === true && !showFtsFieldValues.value)
  );
}

function isDragEnabled(row: FieldItem): boolean {
  return props.source.dragEnabled?.(asPanelField(row)) ?? true;
}

function isColumn(row: FieldItem): boolean {
  return tableColumns.value.includes(row.name);
}

function chipsFor(row: FieldItem) {
  if (!props.capabilities.actions.includes("chips")) return [];
  return props.source.chips?.(asPanelField(row)) ?? [];
}

function overrideFor(row: FieldItem) {
  return props.source.expansionOverride?.(asPanelField(row)) ?? null;
}

function captionFor(row: FieldItem) {
  return props.source.valuesCaption?.(asPanelField(row)) ?? null;
}

function valuesFor(row: FieldItem) {
  const state = props.source.fieldValues.value[keyOf(row)];
  if (!state || !props.source.valueMapper) return state;
  return { ...state, values: props.source.valueMapper(asPanelField(row), state.values) };
}

// Multi-select writes one filter for every selected stream, so with several selected the field must exist in all.
function canMultiSelect(row: FieldItem): boolean {
  if (selectedStreams.value.length <= 1) return true;
  const streams = asPanelField(row).streams;
  if (!streams) return true;
  return streams.length === selectedStreams.value.length;
}

const showReset = computed(
  () => props.capabilities.actions.includes("toggle-column") && !!props.source.resetColumns,
);

// The footer always carries the field count, so it shows whenever there are fields or footer controls.
function showFooter(fieldCount: number): boolean {
  return fieldCount > 0 || footerToggles.value.length > 0 || showReset.value;
}

function onSchemaToggle(value: string) {
  if (ownSchemaTab.value) localSchemaTab.value = value;
  else props.source.footerToggle?.("schema", value);
}

function onPickerOpen() {
  props.source.picker?.onOpen?.();
  props.source.refreshStreams?.();
}

function onSearch(value: string) {
  props.source.setSearch(value);
  currentPage.value = 1;
}

// The list reports the whole set; the source owns the state, so it is told which group flipped.
function onCollapsedChange(groups: Set<string>) {
  const before = collapsedGroups.value;
  for (const group of new Set([...before, ...groups])) {
    if (before.has(group) !== groups.has(group)) props.source.toggleGroup(group);
  }
}

function onExpandedIdsChange(ids: string[]) {
  const next = new Set(ids);
  for (const key of expandedFields.value) {
    if (!next.has(key)) props.source.closeField(key);
  }
  for (const key of ids) {
    if (expandedSet.value.has(key)) continue;
    const row = fields.value.find((field) => !field.isGroup && keyOf(field) === key);
    if (row && isExpandable(row)) props.source.openField(row);
  }
}

// A new stream starts on the defined-schema tab again.
watch([streamType, () => selectedStreams.value.join(",")], () => {
  localSchemaTab.value = SCHEMA_TAB;
});

// A new stream set or footer tab is a new list, so paging starts over.
watch([selectedStreams, schemaTab, () => props.source.footerInterestingOnly?.value], () => {
  currentPage.value = 1;
});
</script>
