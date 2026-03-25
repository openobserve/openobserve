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
  <div class="filter-values-container">
    <!-- Value search input — only when fetched count hits the limit -->
    <div v-if="showValueSearch" class="value-search-container q-mb-xs">
      <div class="value-search-input-wrap">
        <q-input
          v-model="valueSearchTerm"
          dense
          borderless
          clearable
          :placeholder="`Search ${fieldName} values…`"
          @clear="valueSearchTerm = ''"
        >
          <template #prepend>
            <q-icon name="search" size="0.875rem" />
          </template>
        </q-input>
      </div>
    </div>

    <!-- Scrollable values area -->
    <div class="values-scroll-container">
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
        data-test="field-values-panel-no-values-msg"
      >
        {{ fieldValues?.errMsg || "No values found" }}
      </div>

      <!-- Field values list -->
      <div v-for="value in displayValues" :key="value.key">
        <q-list dense>
          <q-item
            tag="label"
            class="q-pr-none"
            :data-test="`logs-search-subfield-add-${fieldName}-${value.key}`"
          >
            <!-- Checkbox for multi-select -->
            <q-checkbox
              v-if="showMultiSelect"
              v-model="selectedValues"
              :val="value.key"
              :color="checkboxColor(value.key)"
              size="xs"
              dense
              class="q-mr-xs"
              @click.stop
            />

            <div
              class="flex row wrap justify-between"
              :style="
                showMultiSelect ? 'width: calc(100% - 4.25rem)' : 'width: 100%'
              "
            >
              <div
                :title="value.key"
                class="ellipsis q-pr-xs"
                style="width: calc(100% - 3.125rem)"
              >
                {{ value.label ?? value.key }}
              </div>
              <div
                :title="String(value.count)"
                class="ellipsis text-right q-pr-sm"
                style="display: contents"
                :style="showMultiSelect ? 'width: 3.125rem' : ''"
              >
                {{ formatLargeNumber(value.count) }}
              </div>
            </div>

            <!-- Include/Exclude buttons -->
            <div
              v-if="showMultiSelect"
              class="flex row tw:ml-[0.125rem]"
              :class="theme === 'dark' ? 'text-white' : 'text-black'"
            >
              <q-btn
                class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                size="0.25rem"
                @click.stop="
                  emit('add-search-term', fieldName, value.key, 'include')
                "
                title="Include Term"
                round
                :data-test="`log-search-subfield-list-equal-${fieldName}-field-btn`"
              >
                <q-icon
                  v-if="fieldName === 'duration'"
                  :name="outlinedArrowForwardIos"
                  class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                />
                <q-icon
                  v-else
                  class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!"
                >
                  <EqualIcon />
                </q-icon>
              </q-btn>
              <q-btn
                class="o2-custom-button-hover tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]!"
                size="0.25rem"
                @click.stop="
                  emit('add-search-term', fieldName, value.key, 'exclude')
                "
                title="Exclude Term"
                round
                :data-test="`log-search-subfield-list-not-equal-${fieldName}-field-btn`"
              >
                <q-icon
                  v-if="fieldName === 'duration'"
                  :name="outlinedArrowBackIos"
                  class="tw:h-[0.5rem]! tw:w-[0.5rem]!"
                />
                <q-icon
                  v-else
                  class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!"
                >
                  <NotEqualIcon />
                </q-icon>
              </q-btn>
            </div>
          </q-item>
        </q-list>
      </div>
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
        @click="emit('load-more-values', fieldName)"
        :data-test="`log-search-subfield-load-more-${fieldName}`"
      >
        View more values
      </q-btn>
    </div>

    <!-- Multi-select action bar -->
    <div
      v-if="selectedValues.length > 0 && showMultiSelect"
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
            :data-test="`log-search-subfield-clear-selected-${fieldName}`"
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
            :data-test="`log-search-subfield-include-selected-${fieldName}`"
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
            :data-test="`log-search-subfield-exclude-selected-${fieldName}`"
          >
            Exclude
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import {
  outlinedArrowBackIos,
  outlinedArrowForwardIos,
} from "@quasar/extras/material-icons-outlined";
import { formatLargeNumber } from "@/utils/zincutils";

interface FieldValues {
  isLoading: boolean;
  values: { key: string; count: number; label?: string }[];
  errMsg?: string;
  hasMore?: boolean;
}

interface Props {
  fieldName: string;
  fieldValues?: FieldValues;
  showMultiSelect?: boolean;
  defaultValuesCount?: number;
  theme?: string;
  activeIncludeValues?: string[];
  activeExcludeValues?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  showMultiSelect: true,
  defaultValuesCount: 10,
  theme: "light",
});

const emit = defineEmits<{
  "add-search-term": [fieldName: string, value: string, action: string];
  "add-multiple-search-terms": [
    fieldName: string,
    values: string[],
    action: string,
  ];
  "load-more-values": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
}>();

/**
 * Union of all values that are currently active in the query (both included
 * and excluded). Used to initialise selectedValues and keep it in sync when
 * the parent query changes.
 */
const allActiveValues = computed(() => [
  ...(props.activeIncludeValues ?? []),
  ...(props.activeExcludeValues ?? []),
]);

/**
 * Drives the multi-select checkboxes. Initialised from allActiveValues so
 * previously filtered values appear pre-checked when the panel opens.
 * Kept in sync via the watcher below as the parent query changes.
 */
const selectedValues = ref<string[]>(allActiveValues.value);
const valueSearchTerm = ref("");
const cachedValues = ref<{ key: string; count: number; label?: string }[]>([]);

// Sync selectedValues whenever the parent's active query changes so that
// checkboxes always reflect the current filter state.
watch(allActiveValues, (newVals) => {
  selectedValues.value = newVals;
});

// Cache original values whenever they arrive with no active search term.
watch(
  () => props.fieldValues?.values,
  (newVals) => {
    if (!valueSearchTerm.value && newVals?.length) {
      cachedValues.value = [...newVals];
    }
  },
  { immediate: true },
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

// Show search box once original values hit the fetch limit.
const showValueSearch = computed(
  () => cachedValues.value.length >= props.defaultValuesCount,
);

watchDebounced(
  valueSearchTerm,
  (term) => {
    emit("search-field-values", props.fieldName, term ?? "");
  },
  { debounce: 300 },
);

const handleApplyMultiSelect = (action: string) => {
  if (!selectedValues.value.length) return;
  emit(
    "add-multiple-search-terms",
    props.fieldName,
    [...selectedValues.value],
    action,
  );
  selectedValues.value = [];
};

/**
 * Returns the Quasar colour token for a value's checkbox.
 * Excluded values (!=) render red ("negative") to visually distinguish them
 * from included values (=) which render the default blue ("primary").
 */
const checkboxColor = (key: string): string => {
  if (props.activeExcludeValues?.includes(key)) return "negative";
  return "primary";
};

/**
 * Resets the panel to match the current active filter state.
 * Called by the parent (via defineExpose) when the expansion panel closes, so
 * stale user selections don't persist the next time the panel is opened.
 */
const reset = () => {
  selectedValues.value = allActiveValues.value;
  valueSearchTerm.value = "";
  cachedValues.value = [];
};

defineExpose({ reset });
</script>

<style scoped lang="scss">
.value-search-container {
  border-bottom: 1px solid var(--o2-border-color);
}

.value-search-input-wrap {
  font-size: 0.75rem;

  &:deep(.q-field__control) {
    height: 1.65rem;
    min-height: 1.65rem;
    padding: 0 0.25rem;
    display: flex;
    align-items: center;
    border: 1px solid var(--o2-border-color);
    border-radius: 0.25rem;
  }

  &:deep(.q-field__prepend),
  &:deep(.q-field__append) {
    height: 1.65rem;
    display: flex;
    align-items: center;
    padding-right: 0.25rem;
  }

  &:deep(.q-field__native) {
    padding: 0;
    line-height: 1.3;
    height: 1.65rem !important;
  }

  &:deep(.q-field__append .q-icon) {
    font-size: 0.875rem;
  }

  .q-icon {
    line-height: 1.3;
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

.values-scroll-container {
  max-height: 16rem;
  overflow-y: auto;
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
