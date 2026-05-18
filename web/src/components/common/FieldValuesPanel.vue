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
        <OInput
          v-model="valueSearchTerm"
          clearable
          :placeholder="`Search ${fieldName} values…`"
          @clear="valueSearchTerm = ''"
        >
          <template #prepend>
            <OIcon name="search" size="0.875rem" />
          </template>
        </OInput>
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
        <OButton
          v-if="selectedValues.length > 0"
          variant="ghost"
          size="icon-xs-circle"
          title="Clear selection"
          class="selection-clear-btn"
          @click="clearSelection"
          data-test="field-values-panel-clear-selection-btn"
        >
          <OIcon name="close" size="0.6rem" />
        </OButton>
      </div>
      <div
        class="filter-mode-toggle"
        data-test="field-values-panel-filter-mode-toggle"
      >
        <OButton
          :variant="filterMode === 'include' ? 'primary' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn"
          :disabled="filterMode !== 'include' && isModeToggleDisabled"
          title="Include mode (=)"
          @click="setFilterMode('include')"
          data-test="field-values-panel-include-mode-btn"
        >
          <OIcon class="tw:h-[0.6rem]! tw:w-[0.6rem]! tw:m-[0.1rem]!">
            <EqualIcon />
          </OIcon>
        </OButton>
        <OButton
          :variant="filterMode === 'exclude' ? 'destructive' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn"
          :disabled="filterMode !== 'exclude' && isModeToggleDisabled"
          title="Exclude mode (≠)"
          @click="setFilterMode('exclude')"
          data-test="field-values-panel-exclude-mode-btn"
        >
          <OIcon class="tw:h-[0.6rem]! tw:w-[0.6rem]! tw:m-[0.1rem]!">
            <NotEqualIcon />
          </OIcon>
        </OButton>
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
        <OInnerLoading
          :showing="fieldValues?.isLoading && !displayValues.length"
          label="Fetching values..."
          size="xs"
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
            <OCheckbox
              v-if="showMultiSelect"
              :model-value="selectedValues"
              :value="value.key"
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

    <!-- View more values / loading more indicator -->
    <div
      v-if="isLoadingMore || (fieldValues?.hasMore && !fieldValues?.isLoading)"
      class="view-more-container q-px-sm q-pt-xs"
    >
      <OButton
        variant="ghost-primary"
        size="xs"
        :block="true"
        class="view-more-btn"
        :disabled="isLoadingMore"
        @click="handleLoadMoreClick"
        :data-test="`log-search-subfield-load-more-${fieldName}`"
      >
        <OSpinner variant="dots" v-if="isLoadingMore" size="xs" />
        <span v-else>View more values</span>
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDebounceFn, watchDebounced } from "@vueuse/core";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

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
 * Filter mode (include / exclude). Initialised from the current query state
 * and kept in sync with the active filter props so that it always reflects
 * which operator (= / !=) the user's selection is using.
 */
const filterMode = ref<"include" | "exclude">(
  (props.activeExcludeValues?.length ?? 0) > 0 ? "exclude" : "include",
);

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

// Show search box whenever there are values to search.
const showValueSearch = computed(
  () =>
    cachedValues.value.length > 0 ||
    (props.fieldValues?.values?.length ?? 0) > 0,
);

watchDebounced(
  valueSearchTerm,
  (term) => {
    emit("search-field-values", props.fieldName, term ?? "");
  },
  { debounce: 300 },
);

/**
 * Debounced emission for mode changes. The UI toggle updates immediately
 * (instant feedback) but the API call is consolidated so that rapid
 * include→exclude→include clicks only fire one search at the end, preventing
 * a brief "no events found" flash (from an intermediate result set) that
 * would reset the field-list scroll position.
 */
const debouncedEmitModeChange = useDebounceFn((mode: "include" | "exclude") => {
  if (selectedValues.value.length > 0) {
    emit("add-multiple-search-terms", props.fieldName, [...selectedValues.value], mode);
  }
}, 300);

/**
 * Called when the user explicitly clicks the include/exclude toggle.
 * Updates filterMode immediately for instant visual feedback, then
 * debounces the actual query emission to avoid rapid successive API calls.
 * This is the ONLY path that should emit add-multiple-search-terms for
 * a mode change — the prop-sync watcher below only updates the ref silently.
 */
const setFilterMode = (mode: "include" | "exclude") => {
  filterMode.value = mode;
  debouncedEmitModeChange(mode);
};

// Keep filterMode in sync with the external filter state.
// When props change after a query re-run (or after reset() is called with
// stale props), this corrects the toggle without triggering a new emission.
watch(
  () => ({
    exc: props.activeExcludeValues?.length ?? 0,
    inc: props.activeIncludeValues?.length ?? 0,
  }),
  ({ exc, inc }) => {
    if (exc > 0) {
      filterMode.value = "exclude";
    } else if (inc > 0) {
      filterMode.value = "include";
    }
    // When both are zero (no active filters) keep the current mode so the
    // user's last preference is preserved for the next checkbox interaction.
  },
  { deep: true },
);

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

// Only block the non-active toggle when a request is in-flight with active
// selections — prevents out-of-order responses without blocking the user
// when there's nothing selected (no API call would be triggered anyway).
const isModeToggleDisabled = computed(
  () => !!(props.fieldValues?.isLoading && selectedValues.value.length > 0),
);

const isLoadingMore = ref(false);
let valuesCountBeforeLoadMore = 0;

const handleLoadMoreClick = () => {
  valuesCountBeforeLoadMore = props.fieldValues?.values?.length ?? 0;
  isLoadingMore.value = true;
  emit("load-more-values", props.fieldName);
};

// Clear isLoadingMore only once values have actually grown — early
// streaming chunks can arrive empty yet flip isLoading to false.
watch(
  () => props.fieldValues?.values?.length,
  (newLen) => {
    if (isLoadingMore.value && (newLen ?? 0) > valuesCountBeforeLoadMore) {
      nextTick(() => {
        isLoadingMore.value = false;
      });
    }
  },
);

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
  filterMode.value =
    (props.activeExcludeValues?.length ?? 0) > 0 ? "exclude" : "include";
  isLoadingMore.value = false;
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
    transition:
      background 0.15s,
      color 0.15s;
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

  &:deep(.q-field__append .OIcon) {
    font-size: 0.875rem;
  }

  .OIcon {
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
