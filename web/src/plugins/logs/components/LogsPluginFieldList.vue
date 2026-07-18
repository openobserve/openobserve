<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OFieldList
    ref="ofieldListRef"
    :fields="visibleFields"
    :search="filterField"
    :search-placeholder="t('search.searchField')"
    :current-page="pagination.page"
    :page-size="pagination.rowsPerPage"
    :page-size-options="[pagination.rowsPerPage]"
    row-key="name"
    :loading="loadingStream"
    :show-pagination="true"
    @update:search="$emit('update:filter-field', $event)"
    @update:current-page="(page: number) => $emit('set-page', page)"
  >
    <!-- Group header -->
    <template #group-header="{ row, groupName }">
      <div
        :data-test="`logs-page-field-list-group-header-${row.group}`"
        class="font-semibold text-xs py-0.5 px-[0.325rem] cursor-pointer text-field-list-group-text bg-surface-subtle h-full w-full flex! justify-between items-center rounded-[0.25rem]"
        @click="$emit('toggle-group', row.group)"
      >
        <div class="flex-1 min-w-0 flex items-center gap-1">
          <span>{{ groupName }}</span>
          <OTag type="fieldTag">{{
            (showOnlyInterestingFields
              ? interestingExpandedGroupRowsFieldCount[row.group]
              : expandGroupRowsFieldCount[row.group]) ?? 0
          }}</OTag>
        </div>
        <OButton
          v-if="(expandGroupRowsFieldCount[row.group] ?? 0) > 0"
          variant="ghost"
          size="icon-xs-sq"
          class="flex-shrink-0"
        >
          <OIcon
            :name="
              expandGroupRows[row.group] ? 'expand-more' : 'chevron-right'
            "
            size="sm"
          />
        </OButton>
      </div>
    </template>

    <!-- Field row -->
    <template #field-row="{ row }">
      <FieldRow
        :field="row"
        :selected-fields="selectedFields"
        :timestamp-column="timestampColumn"
        :theme="theme"
        :show-quick-mode="showQuickMode"
        :show-fts-field-values="showFtsFieldValues"
        @add-to-filter="$emit('add-to-filter', $event)"
        @toggle-field="$emit('toggle-field', $event)"
        @toggle-interesting="
          (field, isInteresting) =>
            $emit('toggle-interesting', field, isInteresting)
        "
      >
        <template #expansion="{ field }">
          <FieldExpansion
            :field="field"
            :field-values="fieldValues[field.name]"
            :active-include-values="
              activeIncludeFieldValues?.[field.name] ?? []
            "
            :active-exclude-values="
              activeExcludeFieldValues?.[field.name] ?? []
            "
            :expanded="expandedFields?.[field.name] ?? false"
            :selected-fields="selectedFields"
            :selected-streams-count="selectedStreamsCount"
            :theme="theme"
            :show-quick-mode="showQuickMode"
            :default-values-count="defaultValuesCount"
            @add-to-filter="$emit('add-to-filter', $event)"
            @toggle-field="$emit('toggle-field', $event)"
            @toggle-interesting="
              (field, isInteresting) =>
                $emit('toggle-interesting', field, isInteresting)
            "
            @add-search-term="
              (fieldName, value, action) =>
                $emit('add-search-term', fieldName, value, action)
            "
            @add-multiple-search-terms="
              (fieldName, values, action) =>
                $emit(
                  'add-multiple-search-terms',
                  fieldName,
                  values,
                  action,
                )
            "
            @remove-field-filter="
              (fieldName) => $emit('remove-field-filter', fieldName)
            "
            @before-show="
              (event, field) => $emit('before-show', event, field)
            "
            @before-hide="(field) => $emit('before-hide', field)"
            @search-field-values="
              (fieldName, searchTerm) =>
                $emit('search-field-values', fieldName, searchTerm)
            "
            @load-more-values="
              (fieldName) => $emit('load-more-values', fieldName)
            "
          />
        </template>
      </FieldRow>
    </template>

    <!-- Loading skeleton -->
    <template #loading>
      <div
        data-test="logs-fieldlist-loading-skeleton"
        class="w-full flex flex-col"
      >
        <!-- Group 1 header -->
        <div class="h-7 flex items-center justify-between px-2">
          <OSkeleton type="rect" class="h-3 w-24 rounded-sm" />
          <OSkeleton type="rect" class="h-3 w-3 rounded-sm" />
        </div>
        <!-- Group 1 fields -->
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="flex-1" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="w-3/4" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="flex-1" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="w-4/5" />
        </div>
        <!-- Group 2 header -->
        <div class="h-7 flex items-center justify-between px-2 mt-2">
          <OSkeleton type="rect" class="h-3 w-16 rounded-sm" />
          <OSkeleton type="rect" class="h-3 w-3 rounded-sm" />
        </div>
        <!-- Group 2 field -->
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="w-2/3" />
        </div>
        <!-- Group 3 header -->
        <div class="h-7 flex items-center justify-between px-2 mt-2">
          <OSkeleton type="rect" class="h-3 w-32 rounded-sm" />
          <OSkeleton type="rect" class="h-3 w-3 rounded-sm" />
        </div>
        <!-- Group 3 fields -->
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="flex-1" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="w-4/5" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="flex-1" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="w-3/4" />
        </div>
        <div class="flex items-center gap-2 px-3 py-[0.375rem]">
          <OSkeleton type="rect" class="w-[0.875rem] h-[0.875rem] rounded-sm shrink-0" />
          <OSkeleton type="text" class="flex-1" />
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <template #empty>
      <div
        class="text-center py-[0.725rem] flex items-center justify-center"
      >
        <OIcon name="info" size="xs" />
        <span class="pl-[0.375rem]">{{ t('logs.logsPluginFieldList.noMatchingFields') }}</span>
      </div>
    </template>

    <!-- After list: pagination + toggles -->
    <template #after-list="bottomProps">
      <FieldListPagination
        :data-test-prefix="'logs-page'"
        :show-schema-toggle="showUserDefinedSchemaToggle"
        :show-quick-mode="showQuickMode"
        :use-user-defined-schemas="useUserDefinedSchemas"
        :show-only-interesting-fields="showOnlyInterestingFields"
        :schema-toggle-options="userDefinedSchemaBtnGroupOption"
        :interesting-fields-toggle-options="selectedFieldsBtnGroupOption"
        :current-page="bottomProps.currentPage"
        :pages-number="bottomProps.totalPages"
        :is-first-page="bottomProps.isFirstPage"
        :is-last-page="bottomProps.isLastPage"
        :total-fields-count="bottomProps.totalRows"
        @toggle-schema="$emit('toggle-schema', $event)"
        @toggle-interesting-fields="$emit('toggle-interesting-fields', $event)"
        @first-page="bottomProps.firstPage()"
        @last-page="bottomProps.lastPage()"
        @set-page="$emit('set-page', $event)"
        @reset-fields="$emit('reset-fields')"
      />
    </template>
  </OFieldList>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import FieldRow from "@/components/common/FieldRow.vue";
import FieldExpansion from "@/components/common/FieldExpansion.vue";
import FieldListPagination from "@/components/common/FieldListPagination.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const { t } = useI18n();

interface Props {
  streamFieldsRows: any[];
  selectedStream: string;
  filterField: string;
  filterFieldFn: (rows: any, terms: any) => any[];
  pagination: { page: number; rowsPerPage: number };
  wrapCells: boolean;
  loadingStream: boolean;
  showOnlyInterestingFields: boolean;
  interestingExpandedGroupRowsFieldCount: Record<string, number>;
  expandGroupRowsFieldCount: Record<string, number>;
  expandGroupRows: Record<string, boolean>;
  theme: string;
  selectedFields: string[];
  timestampColumn: string;
  showQuickMode: boolean;
  fieldValues: Record<string, any>;
  activeIncludeFieldValues?: Record<string, string[]>;
  activeExcludeFieldValues?: Record<string, string[]>;
  expandedFields?: Record<string, boolean>;
  selectedStreamsCount: number;
  defaultValuesCount: number;
  showUserDefinedSchemaToggle: boolean;
  useUserDefinedSchemas: string;
  userDefinedSchemaBtnGroupOption: any[];
  selectedFieldsBtnGroupOption: any[];
  totalFieldsCount: number;
  showFtsFieldValues: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  "update:pagination": [value: { page: number; rowsPerPage: number }];
  "update:filter-field": [value: string];
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
  "add-multiple-search-terms": [
    fieldName: string,
    values: string[],
    action: string,
  ];
  "remove-field-filter": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
  "load-more-values": [fieldName: string];
  "before-show": [event: any, field: any];
  "before-hide": [field: any];
  "toggle-group": [group: string];
  "toggle-schema": [value: string];
  "toggle-interesting-fields": [value: boolean];
  "set-page": [page: number];
  "reset-fields": [];
}>();

const ofieldListRef = ref<InstanceType<typeof OFieldList> | null>(null);

// ---------------------------------------------------------------------------
// Data transformation: filter & annotate rows for OFieldList
// ---------------------------------------------------------------------------

const visibleFields = computed(() => {
  return props.streamFieldsRows
    .filter((row) => {
      // Group headers
      if (row.label) {
        if (props.showOnlyInterestingFields) {
          return (
            (props.interestingExpandedGroupRowsFieldCount[row.group] ?? 0) > 0
          );
        }
        return true;
      }
      // Field rows — interesting fields filter
      if (props.showOnlyInterestingFields) {
        if (!row.isInterestingField) return false;
        if (
          (props.interestingExpandedGroupRowsFieldCount[row.group] ?? 0) === 0
        )
          return false;
      }
      // Group collapse
      if (row.group && props.expandGroupRows[row.group] === false) return false;
      return true;
    })
    .map((row) => ({
      ...row,
      isGroup: !!row.label,
      groupName: row.label ? row.name : (row.group || row.name),
      _index: row._index ?? 0,
    }));
});

// ---------------------------------------------------------------------------
// Expose for parent (IndexList.vue)
// ---------------------------------------------------------------------------

function scrollToTop() {
  ofieldListRef.value?.scrollToTop?.();
}

function prepareScrollReset() {
  // With OTable, scroll reset is handled by scrollToTop before data changes
}

defineExpose({
  fieldListRef: ofieldListRef,
  scrollToTop,
  prepareScrollReset,
});
</script>

