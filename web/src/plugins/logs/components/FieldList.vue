<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <q-table
    ref="fieldListRef"
    data-test="log-search-index-list-fields-table"
    :visible-columns="['name']"
    :rows="streamFieldsRows"
    :row-key="(row: any) => selectedStream + row.name"
    :filter="filterField"
    :filter-method="filterFieldFn"
    :pagination="pagination"
    @update:pagination="$emit('update:pagination', $event)"
    hide-header
    :wrap-cells="wrapCells"
    class="field-table full-height"
    :class="{ 'loading-fields': loadingStream }"
    id="fieldList"
    :rows-per-page-options="[]"
  >
    <template #body-cell-name="props">
      <!-- Field Group Header -->
      <q-tr
        v-if="props.row.name === 'no-fields-found'"
        class="tw:text-center tw:py-[0.725rem] tw:flex tw:items-center tw:justify-center"
      >
        <q-icon name="info" color="primary" size="xs" />
        <span class="tw:pl-[0.375rem]">No matching fields found.</span>
      </q-tr>

      <!-- Field Group Header -->
      <q-tr
        :props="props"
        v-else-if="
          props.row.label &&
          (showOnlyInterestingFields
            ? interestingExpandedGroupRowsFieldCount[props.row.group]
            : true)
        "
        @click="$emit('toggle-group', props.row.group)"
        class="cursor-pointer text-bold"
      >
        <q-td
          class="field_list field-group-header tw:flex! tw:justify-between tw:items-center tw:rounded-[0.25rem]"
          :class="[theme === 'dark' ? 'text-grey-5' : 'bg-grey-3']"
        >
          <div class="tw:w-[calc(100%-1.25rem)] ellipsis">
            {{ props.row.name }} ({{
              showOnlyInterestingFields
                ? interestingExpandedGroupRowsFieldCount[props.row.group]
                : expandGroupRowsFieldCount[props.row.group]
            }})
          </div>
          <OButton
            v-if="expandGroupRowsFieldCount[props.row.group] > 0"
            variant="ghost"
            size="icon-xs-sq"
          >
            <q-icon
              :name="
                expandGroupRows[props.row.group]
                  ? 'expand_more'
                  : 'chevron_right'
              "
              size="14px"
            />
          </OButton>
        </q-td>
      </q-tr>

      <!-- Field Row -->
      <q-tr
        :props="props"
        v-else-if="
          !showOnlyInterestingFields ||
          (showOnlyInterestingFields &&
            props.row.isInterestingField &&
            interestingExpandedGroupRowsFieldCount[props.row.group])
        "
        v-show="expandGroupRows[props.row.group]"
      >
        <q-td
          :props="props"
          class="field_list"
          :class="selectedFields.includes(props.row.name) ? 'selected' : ''"
        >
          <FieldRow
            :field="props.row"
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
        </q-td>
      </q-tr>
    </template>

    <template #top-right>
      <div class="field-list-search-container">
        <OInput
          data-test="log-search-index-list-field-search-input"
          :model-value="filterField"
          @update:model-value="$emit('update:filter-field', $event)"
          data-cy="index-field-search-input"
          clearable
          :debounce="1"
          :placeholder="t('search.searchField')"
          class="indexlist-search-input tw:mb-[0.25rem]"
        >
          <template #prepend>
            <q-icon name="search" size="1.25rem" class="o2-search-input-icon" />
          </template>
        </OInput>
        <q-tr v-if="loadingStream == true">
          <q-td colspan="100%" class="text-bold" style="opacity: 0.7">
            <div class="text-subtitle2 text-weight-bold">
              <OSpinner size="xs" />
              {{ t("confirmDialog.loading") }}
            </div>
          </q-td>
        </q-tr>
      </div>
    </template>

    <template v-slot:pagination="scope">
      <FieldListPagination
        :show-user-defined-schema-toggle="showUserDefinedSchemaToggle"
        :show-quick-mode="showQuickMode"
        :use-user-defined-schemas="useUserDefinedSchemas"
        :show-only-interesting-fields="showOnlyInterestingFields"
        :user-defined-schema-btn-group-option="userDefinedSchemaBtnGroupOption"
        :selected-fields-btn-group-option="selectedFieldsBtnGroupOption"
        :current-page="scope.pagination.page"
        :pages-number="scope.pagesNumber"
        :is-first-page="scope.isFirstPage"
        :is-last-page="scope.isLastPage"
        :total-fields-count="totalFieldsCount"
        @toggle-schema="$emit('toggle-schema', $event)"
        @toggle-interesting-fields="$emit('toggle-interesting-fields', $event)"
        @first-page="scope.firstPage"
        @last-page="scope.lastPage"
        @set-page="$emit('set-page', $event)"
        @reset-fields="$emit('reset-fields')"
      />
    </template>
  </q-table>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import FieldRow from "./FieldRow.vue";
import FieldExpansion from "./FieldExpansion.vue";
import FieldListPagination from "./FieldListPagination.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

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

// Refs
const fieldListRef = ref<HTMLElement | null>(null);

// ---------------------------------------------------------------------------
// Scroll position preservation
//
// Problem: Quasar's q-table resets the scroll position to 0 after every
// reactive row update (it does this in a requestAnimationFrame callback of
// its own). A plain onBeforeUpdate / onUpdated pair runs too early and gets
// overridden.
//
// Solution:
//   1. Watch `streamFieldsRows` with flush:"pre" to capture scrollTop
//      synchronously before the DOM mutates.
//   2. Schedule a restore via nextTick + requestAnimationFrame so we run
//      AFTER Quasar's own reset RAF.
//   3. When the parent wants an intentional reset (stream change), it calls
//      prepareScrollReset() which sets _skipScrollRestore = true so the
//      watcher skips the restore for that one update.
// ---------------------------------------------------------------------------

/** When true, the next watcher invocation will skip scroll restoration. */
let _skipScrollRestore = false;
/** RAF handle for a pending scroll-restore; cancelled on intentional resets. */
let _restoreRafId: number | null = null;

/** Returns the scrollable q-table container element, or null if not mounted. */
const getScrollContainer = (): HTMLElement | null =>
  fieldListRef?.value?.$el?.querySelector(".q-table__middle.scroll") ?? null;

// Watch the rows prop specifically — this is what causes q-table to re-render
// and reset scroll. Save the position BEFORE the DOM update (flush: "pre"),
// then restore it after Quasar's own post-render work via nextTick +
// requestAnimationFrame.
watch(
  () => props.streamFieldsRows,
  () => {
    if (_skipScrollRestore) {
      _skipScrollRestore = false;
      return;
    }
    const c = getScrollContainer();
    const saved = c ? c.scrollTop : 0;
    if (saved === 0) return; // nothing to preserve

    if (_restoreRafId !== null) cancelAnimationFrame(_restoreRafId);

    nextTick(() => {
      _restoreRafId = requestAnimationFrame(() => {
        _restoreRafId = null;
        if (_skipScrollRestore) return;
        const container = getScrollContainer();
        if (container) container.scrollTop = saved;
      });
    });
  },
  { flush: "pre" },
);

/**
 * Imperatively scrolls the field list to the top and prevents the next
 * watcher cycle from overriding that position (e.g. after stream change).
 */
const scrollToTop = () => {
  _skipScrollRestore = true;
  if (_restoreRafId !== null) {
    cancelAnimationFrame(_restoreRafId);
    _restoreRafId = null;
  }
  const c = getScrollContainer();
  if (c) c.scrollTop = 0;
};

/**
 * Called synchronously by the parent before an intentional scroll reset
 * (e.g. stream change) so that any in-flight restore RAF is cancelled before
 * the rows change fires the watcher. Without this the restore would run after
 * the parent's scroll-to-top and undo it.
 */
const prepareScrollReset = () => {
  _skipScrollRestore = true;
  if (_restoreRafId !== null) {
    cancelAnimationFrame(_restoreRafId);
    _restoreRafId = null;
  }
};

// Expose methods and refs to parent
defineExpose({
  fieldListRef,
  scrollToTop,
  prepareScrollReset,
});
</script>

<style scoped lang="scss">
.field-list-search-container {
  width: 100%;
  padding: 0;
  margin: 0;
}

.indexlist-search-input {
  height: 2.25rem;
  .q-field__control {
    height: 2.25rem;
    display: flex;
    align-items: center;
    font-size: 0.8125rem;
    padding: 0 0.375rem !important;
    font-weight: 500;
  }
  .q-field__prepend {
    height: 2.25rem !important;
    padding-bottom: 0.25rem !important;
  }
  .q-field__append {
    padding-top: 0.5rem !important;
  }

  .q-icon {
    height: 1rem;
    width: 1rem;
    margin-right: 0.625rem;
  }
}

.field_list {
  padding: 0;

  &.field-group-header {
    font-weight: 600;
    font-size: 0.75rem;
    padding: 0.25rem 0.325rem;
  }
}
</style>
