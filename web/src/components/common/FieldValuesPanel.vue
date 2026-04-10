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

    <!-- Filter mode toggle + selection count -->
    <div
      v-if="showMultiSelect"
      class="filter-mode-bar q-px-sm q-py-xs tw:flex tw:items-center tw:justify-between"
      data-test="field-values-panel-filter-mode-bar"
    >
      <div class="tw:flex tw:items-center tw:gap-[0.25rem]">
        <span
          v-if="selectedValues.length > 0"
          class="selection-count"
          data-test="field-values-panel-selection-count"
        >
          {{ selectedValues.length }} selected
        </span>
        <span v-else class="selection-hint">Select to filter</span>
        <q-btn
          v-if="selectedValues.length > 0"
          flat
          round
          dense
          size="0.2rem"
          padding="0.1rem"
          title="Clear selection"
          class="selection-clear-btn"
          @click="clearSelection"
          data-test="field-values-panel-clear-selection-btn"
        >
          <q-icon name="close" size="0.6rem" />
        </q-btn>
      </div>
      <div
        class="filter-mode-toggle"
        data-test="field-values-panel-filter-mode-toggle"
      >
        <q-btn
          flat
          dense
          no-caps
          size="xs"
          padding="0.1rem 0.35rem"
          :class="[
            'filter-mode-btn',
            filterMode === 'include' ? 'filter-mode-btn--active-include' : '',
          ]"
          title="Include mode (=)"
          @click="filterMode = 'include'"
          data-test="field-values-panel-include-mode-btn"
        >
          <q-icon class="tw:h-[0.6rem]! tw:w-[0.6rem]! tw:m-[0.1rem]!">
            <EqualIcon />
          </q-icon>
        </q-btn>
        <q-btn
          flat
          dense
          no-caps
          size="xs"
          padding="0.1rem 0.35rem"
          :class="[
            'filter-mode-btn',
            filterMode === 'exclude' ? 'filter-mode-btn--active-exclude' : '',
          ]"
          title="Exclude mode (≠)"
          @click="filterMode = 'exclude'"
          data-test="field-values-panel-exclude-mode-btn"
        >
          <q-icon class="tw:h-[0.6rem]! tw:w-[0.6rem]! tw:m-[0.1rem]!">
            <NotEqualIcon />
          </q-icon>
        </q-btn>
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
            <!-- Checkbox for multi-select — uses :model-value + @update to
                 separate user-initiated changes from parent-sync updates,
                 preventing re-emit loops when the parent reflects query state. -->
            <q-checkbox
              v-if="showMultiSelect"
              :model-value="selectedValues"
              :val="value.key"
              :color="checkboxColor(value.key)"
              size="xs"
              dense
              class="q-mr-xs"
              @update:model-value="handleUserCheckboxChange"
              @click.stop
            />

            <div
              class="flex row wrap justify-between"
              :style="
                showMultiSelect ? 'width: calc(100% - 1.5rem)' : 'width: 100%'
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
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
  "add-multiple-search-terms": [
    fieldName: string,
    values: string[],
    action: string,
  ];
  "remove-field-filter": [fieldName: string];
  "load-more-values": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
}>();

/**
 * Filter mode (include / exclude). Defaults to include.
 * Switching the mode only affects future checkbox interactions —
 * it does NOT retroactively modify already-applied filters.
 */
const filterMode = ref<"include" | "exclude">("include");

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
// NOTE: This updates selectedValues.value directly and does NOT call
// handleUserCheckboxChange, so no spurious emits occur on parent sync.
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

// When the user flips the mode switch with values already selected,
// immediately re-apply the current selection under the new mode.
watch(filterMode, (newMode) => {
  if (selectedValues.value.length > 0) {
    emit(
      "add-multiple-search-terms",
      props.fieldName,
      [...selectedValues.value],
      newMode,
    );
  }
});

/**
 * Called only on explicit user checkbox interaction (never on parent sync).
 * Immediately emits the updated selection with the current filter mode,
 * or emits remove-field-filter when all values are unchecked.
 */
const handleUserCheckboxChange = (newValues: string[]) => {
  selectedValues.value = newValues;
  if (newValues.length === 0) {
    emit("remove-field-filter", props.fieldName);
  } else {
    emit(
      "add-multiple-search-terms",
      props.fieldName,
      [...newValues],
      filterMode.value,
    );
  }
};

/**
 * Clears all selected values and removes the field filter from the query.
 */
const clearSelection = () => {
  selectedValues.value = [];
  emit("remove-field-filter", props.fieldName);
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
  filterMode.value = "include";
};

defineExpose({ reset });
</script>

<style scoped lang="scss">
.filter-mode-bar {
  border-bottom: 1px solid var(--o2-border-color);

  .selection-count {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--q-primary);
  }

  .selection-hint {
    font-size: 0.625rem;
    color: var(--o2-text-secondary, #888);
  }

  .filter-mode-toggle {
    display: flex;
    border: 1px solid var(--o2-border-color);
    border-radius: 0.375rem;
    overflow: hidden;
  }

  .filter-mode-btn {
    border-radius: 0 !important;
    color: var(--o2-text-secondary, #888) !important;
    min-height: 1.25rem !important;
    transition:
      background 0.15s,
      color 0.15s;

    &--active-include {
      background: var(--q-primary) !important;
      color: #fff !important;
    }

    &--active-exclude {
      background: var(--q-negative) !important;
      color: #fff !important;
    }
  }
}

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
