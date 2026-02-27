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
  <q-expansion-item
    dense
    switch-toggle-side
    :label="field.name"
    expand-icon-class="field-expansion-icon"
    expand-icon="expand_more"
    expanded-icon="expand_less"
    class="hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
    @before-show="(event: any) => handleBeforeShow(event)"
    @before-hide="() => handleBeforeHide()"
  >
    <template v-slot:header>
      <div
        class="flex content-center ellipsis full-width"
        :title="field.name"
        :data-test="`log-search-expand-${field.name}-field-btn`"
      >
        <div
          class="field_label full-width"
          :data-test="`logs-field-list-item-${field.name}`"
        >
          <div
            class="ellipsis tw:max-w-[calc(100%-1.5rem)]!"
            style="display: inline-block"
          >
            {{ field.name }}
          </div>
          <span class="float-right">
            <q-icon
              :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
              v-if="showQuickMode"
              :name="field.isInterestingField ? 'info' : 'info_outline'"
              :class="theme === 'dark' ? '' : 'light-dimmed'"
              style="margin-right: 0.375rem"
              size="1.1rem"
              :title="
                field.isInterestingField
                  ? 'Remove from interesting fields'
                  : 'Add to interesting fields'
              "
            />
          </span>
        </div>
        <div class="field_overlay tw:rounded-[0.25rem] tw:overflow-hidden">
          <q-btn
            v-if="field.isSchemaField"
            :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
            :icon="outlinedAdd"
            style="margin-right: 0.375rem"
            size="0.4rem"
            class="q-mr-sm"
            @click.stop="$emit('add-to-filter', `${field.name}=''`)"
            round
          />
          <q-icon
            :data-test="`log-search-index-list-add-${field.name}-field-btn`"
            v-if="!isFieldSelected"
            :name="outlinedVisibility"
            style="margin-right: 0.375rem"
            size="1.1rem"
            title="Add field to table"
            @click.stop="$emit('toggle-field', field)"
          />
          <q-icon
            :data-test="`log-search-index-list-remove-${field.name}-field-btn`"
            v-if="isFieldSelected"
            :name="outlinedVisibilityOff"
            style="margin-right: 0.375rem"
            title="Remove field from table"
            size="1.1rem"
            @click.stop="$emit('toggle-field', field)"
          />
          <q-icon
            :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
            v-if="showQuickMode"
            :name="field.isInterestingField ? 'info' : 'info_outline'"
            size="1.1rem"
            :title="
              field.isInterestingField
                ? 'Remove from interesting fields'
                : 'Add to interesting fields'
            "
            @click.stop="
              $emit('toggle-interesting', field, field.isInterestingField)
            "
          />
        </div>
      </div>
    </template>

    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <div class="filter-values-container">
          <!-- Value search input — only when fetched count hits the limit -->
          <div
            v-if="showValueSearch"
            class="value-search-container q-mb-xs"
          >
            <q-input
              v-model="valueSearchTerm"
              dense
              borderless
              clearable
              :placeholder="`Search ${field.name} values…`"
              class="value-search-input"
              @clear="valueSearchTerm = ''"
            >
              <template #prepend>
                <q-icon name="search" size="0.875rem" />
              </template>
            </q-input>
          </div>

          <!-- Loading state (only shown when there are no interim cached results) -->
          <div
            v-show="fieldValues?.isLoading && !displayValues.length"
            class="q-pl-md q-py-xs"
            style="height: 3.75rem"
          >
            <q-inner-loading
              size="xs"
              :showing="fieldValues?.isLoading && !displayValues.length"
              label="Fetching values..."
              label-style="font-size: 1.1em"
            />
          </div>

          <!-- No values found -->
          <div
            v-show="!displayValues.length && !fieldValues?.isLoading"
            class="q-pl-md q-py-xs text-subtitle2"
          >
            {{ fieldValues?.errMsg || "No values found" }}
          </div>

          <!-- Field values list -->
          <div v-for="value in displayValues" :key="value.key">
            <q-list dense>
              <q-item
                tag="label"
                class="q-pr-none"
                :data-test="`logs-search-subfield-add-${field.name}-${value.key}`"
              >
                <!-- Checkbox for multi-select -->
                <q-checkbox
                  v-if="selectedStreamsCount == field.streams.length"
                  v-model="selectedValues"
                  :val="value.key"
                  size="xs"
                  dense
                  class="q-mr-xs"
                  @click.stop
                />

                <div
                  class="flex row wrap justify-between"
                  :style="
                    selectedStreamsCount == field.streams.length
                      ? 'width: calc(100% - 4.25rem)'
                      : 'width: 100%'
                  "
                >
                  <div
                    :title="value.key"
                    class="ellipsis q-pr-xs"
                    style="width: calc(100% - 3.125rem)"
                  >
                    {{ value.key }}
                  </div>
                  <div
                    :title="value.count.toString()"
                    class="ellipsis text-right q-pr-sm"
                    style="display: contents"
                    :style="
                      selectedStreamsCount == field.streams.length
                        ? 'width: 3.125rem'
                        : ''
                    "
                  >
                    {{ formatLargeNumber(value.count) }}
                  </div>
                </div>

                <!-- Include/Exclude buttons -->
                <div
                  v-if="selectedStreamsCount == field.streams.length"
                  class="flex row tw:ml-[0.125rem]"
                  :class="theme === 'dark' ? 'text-white' : 'text-black'"
                >
                  <q-btn
                    class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                    size="0.25rem"
                    @click.stop="handleAddSearchTerm(field.name, value.key, 'include')"
                    title="Include Term"
                    round
                    :data-test="`log-search-subfield-list-equal-${field.name}-field-btn`"
                  >
                    <q-icon class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!">
                      <EqualIcon></EqualIcon>
                    </q-icon>
                  </q-btn>
                  <q-btn
                    class="o2-custom-button-hover tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]!"
                    size="0.25rem"
                    @click.stop="handleAddSearchTerm(field.name, value.key, 'exclude')"
                    title="Exclude Term"
                    round
                    :data-test="`log-search-subfield-list-not-equal-${field.name}-field-btn`"
                  >
                    <q-icon class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!">
                      <NotEqualIcon></NotEqualIcon>
                    </q-icon>
                  </q-btn>
                </div>
              </q-item>
            </q-list>
          </div>

          <!-- View more values -->
          <div
            v-if="fieldValues?.hasMore && !fieldValues?.isLoading"
            class="view-more-container q-px-sm q-pt-xs"
          >
            <q-btn
              flat
              no-caps
              dense
              size="0.2rem"
              padding="0.1rem 0.3rem"
              class="view-more-btn full-width"
              @click="$emit('load-more-values', field.name)"
              :data-test="`log-search-subfield-load-more-${field.name}`"
            >
              View more values
            </q-btn>
          </div>

          <!-- Multi-select action bar -->
          <div
            v-if="selectedValues.length > 0 && selectedStreamsCount == field.streams.length"
            class="multi-select-action-bar q-px-sm q-py-xs"
          >
            <div class="flex items-center justify-between">
              <span class="multi-select-count">
                {{ selectedValues.length }} selected
              </span>
              <div class="flex items-center" style="gap: 0.2rem">
                <q-btn
                  flat
                  round
                  dense
                  size="0.2rem"
                  padding="0.1rem"
                  class="multi-select-clear-btn"
                  :class="theme === 'dark' ? 'text-white' : 'text-dark'"
                  title="Clear selection"
                  @click="selectedValues = []"
                  :data-test="`log-search-subfield-clear-selected-${field.name}`"
                >
                  <q-icon name="close" size="0.6rem" />
                </q-btn>
                <q-btn
                  unelevated
                  no-caps
                  dense
                  size="0.2rem"
                  padding="0.1rem 0.3rem"
                  class="multi-select-include-btn"
                  @click="handleApplyMultiSelect('include')"
                  title="Include selected values (OR)"
                  :data-test="`log-search-subfield-include-selected-${field.name}`"
                >
                  Include
                </q-btn>
                <q-btn
                  unelevated
                  no-caps
                  dense
                  size="0.2rem"
                  padding="0.1rem 0.3rem"
                  class="multi-select-exclude-btn"
                  @click="handleApplyMultiSelect('exclude')"
                  title="Exclude selected values"
                  :data-test="`log-search-subfield-exclude-selected-${field.name}`"
                >
                  Exclude
                </q-btn>
              </div>
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber } from "@/utils/zincutils";

interface Props {
  field: any;
  fieldValues?: {
    isLoading: boolean;
    values: { key: string; count: number }[];
    errMsg?: string;
    hasMore?: boolean;
  };
  selectedFields: string[];
  selectedStreamsCount: number;
  theme: string;
  showQuickMode: boolean;
  defaultValuesCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
  "add-multiple-search-terms": [
    fieldName: string,
    values: string[],
    action: string,
  ];
  "search-field-values": [fieldName: string, searchTerm: string];
  "load-more-values": [fieldName: string];
  "before-show": [event: any, field: any];
  "before-hide": [field: any];
}>();

const selectedValues = ref<string[]>([]);
const valueSearchTerm = ref("");
const cachedValues = ref<{ key: string; count: number }[]>([]);

// Cache the original values whenever they arrive with no active search term.
watch(
  () => props.fieldValues?.values,
  (newVals) => {
    if (!valueSearchTerm.value && newVals?.length) {
      cachedValues.value = [...newVals];
    }
  },
);

// Show interim locally-filtered cache while the API responds to a search term.
const displayValues = computed(() => {
  if (
    props.fieldValues?.isLoading &&
    valueSearchTerm.value &&
    cachedValues.value.length
  ) {
    const term = valueSearchTerm.value.toLowerCase();
    return cachedValues.value.filter((v) =>
      String(v.key).toLowerCase().includes(term),
    );
  }
  return props.fieldValues?.values || [];
});

// Search box is visible once the original values hit the fetch limit.
const showValueSearch = computed(
  () => cachedValues.value.length >= props.defaultValuesCount,
);

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);

watchDebounced(
  valueSearchTerm,
  (term) => {
    emit("search-field-values", props.field.name, term ?? "");
  },
  { debounce: 300 },
);

const handleBeforeShow = (event: any) => {
  emit("before-show", event, props.field);
};

const handleBeforeHide = () => {
  selectedValues.value = [];
  valueSearchTerm.value = "";
  cachedValues.value = [];
  emit("before-hide", props.field);
};

const handleAddSearchTerm = (
  fieldName: string,
  value: string,
  action: string,
) => {
  emit("add-search-term", fieldName, value, action);
};

const handleApplyMultiSelect = (action: string) => {
  if (!selectedValues.value.length) return;
  emit(
    "add-multiple-search-terms",
    props.field.name,
    [...selectedValues.value],
    action,
  );
  selectedValues.value = [];
};
</script>

<style scoped lang="scss">
.field_overlay {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: none;
  align-items: center;
  padding: 0 0.25rem;
  background: var(--q-dark);
}

:deep(.q-expansion-item):hover .field_overlay {
  display: flex;
}

.value-search-container {
  border-bottom: 1px solid var(--o2-border-color);

  .value-search-input {
    font-size: 0.75rem;

    :deep(.q-field__control) {
      height: 1.65rem;
      min-height: 1.65rem;
      padding: 0 0.25rem;
      display: flex;
      align-items: center;
      border: 1px solid var(--o2-border-color);
      border-radius: 0.25rem;
    }

    :deep(.q-field__prepend),
    :deep(.q-field__append) {
      height: 1.65rem;
      display: flex;
      align-items: center;
      padding-right: 0.25rem;
    }

    :deep(.q-field__native) {
      padding: 0;
      line-height: 1.3;
    }

    :deep(.q-field__append .q-icon) {
      font-size: 0.875rem;
    }
  }
}

.multi-select-action-bar {
  border-top: 1px solid var(--o2-border-color);
  background: var(--o2-hover-accent, rgba(0, 0, 0, 0.02));
  border-radius: 0 0 0.25rem 0.25rem;

  .multi-select-count {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--q-primary);
    display: flex;
    align-items: center;
  }

  .multi-select-clear-btn {
    transition: opacity 0.15s;

    &:hover {
      opacity: 0.7;
    }
  }

  .multi-select-include-btn {
    background: var(--q-primary) !important;
    color: #fff !important;
    border-radius: 0.25rem !important;
    font-size: 0.625rem !important;
    font-weight: 500;
    letter-spacing: 0.01em;
    transition: filter 0.15s;

    &:hover {
      filter: brightness(1.12);
    }
  }

  .multi-select-exclude-btn {
    background: var(--q-negative) !important;
    color: #fff !important;
    border-radius: 0.25rem !important;
    font-size: 0.625rem !important;
    font-weight: 500;
    letter-spacing: 0.01em;
    transition: filter 0.15s;

    &:hover {
      filter: brightness(1.12);
    }
  }
}

.view-more-container {
  border-top: 1px solid var(--o2-border-color);
}

.view-more-btn {
  color: var(--q-primary) !important;
  font-size: 0.625rem !important;
  font-weight: 500;
  letter-spacing: 0.01em;
  width: 100%;
  border-radius: 0 0 0.25rem 0.25rem !important;
  transition: opacity 0.15s;

  &:hover {
    opacity: 0.8;
  }
}
</style>
