<!-- Copyright 2023 OpenObserve Inc.

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
          <q-icon
            v-if="expandGroupRowsFieldCount[props.row.group] > 0"
            :name="
              expandGroupRows[props.row.group] ? 'expand_less' : 'expand_more'
            "
            size="1.25rem"
            class="float-right q-mt-xs"
          ></q-icon>
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
                :selected-fields="selectedFields"
                :selected-streams-count="selectedStreamsCount"
                :theme="theme"
                :show-quick-mode="showQuickMode"
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
                @before-show="
                  (event, field) => $emit('before-show', event, field)
                "
                @before-hide="(field) => $emit('before-hide', field)"
              />
            </template>
          </FieldRow>
        </q-td>
      </q-tr>
    </template>

    <template #top-right>
      <div class="field-list-search-container">
        <q-input
          data-test="log-search-index-list-field-search-input"
          :model-value="filterField"
          @update:model-value="$emit('update:filter-field', $event)"
          data-cy="index-field-search-input"
          borderless
          dense
          clearable
          debounce="1"
          :placeholder="t('search.searchField')"
          class="indexlist-search-input tw:mb-[0.25rem]"
        >
          <template #prepend>
            <q-icon name="search" size="1.25rem" class="o2-search-input-icon" />
          </template>
        </q-input>
        <q-tr v-if="loadingStream == true">
          <q-td colspan="100%" class="text-bold" style="opacity: 0.7">
            <div class="text-subtitle2 text-weight-bold">
              <q-spinner-hourglass size="1.25rem" />
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
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import FieldRow from "./FieldRow.vue";
import FieldExpansion from "./FieldExpansion.vue";
import FieldListPagination from "./FieldListPagination.vue";

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
  selectedStreamsCount: number;
  showUserDefinedSchemaToggle: boolean;
  useUserDefinedSchemas: string;
  userDefinedSchemaBtnGroupOption: any[];
  selectedFieldsBtnGroupOption: any[];
  totalFieldsCount: number;
}

defineProps<Props>();

defineEmits<{
  "update:pagination": [value: { page: number; rowsPerPage: number }];
  "update:filter-field": [value: string];
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
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

// Methods
const scrollToTop = () => {
  if (fieldListRef.value) {
    const scrollContainer = fieldListRef.value.querySelector(
      ".q-table__middle.scroll",
    );
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }
};

// Expose methods and refs to parent
defineExpose({
  fieldListRef,
  scrollToTop,
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
