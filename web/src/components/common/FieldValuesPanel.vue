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
  <div data-test="field-values-panel-container" class="py-2 text-xs">
    <!-- Value search input — only when fetched count hits the limit -->
    <div v-if="showValueSearch" class="value-search-container mb-1">
      <div class="value-search-input-wrap">
        <OSearchInput
          v-model="valueSearchTerm"
          clearable
          size="sm"
          :placeholder="`Search ${fieldName} values…`"
          @clear="valueSearchTerm = ''"
        />
      </div>
    </div>

    <!-- Filter mode toggle + selection count -->
    <div
      v-if="showMultiSelect"
      class="filter-mode-bar flex items-center justify-between px-2 py-1 border-b border-card-glass-border"
      data-test="field-values-panel-filter-mode-bar"
    >
      <div class="flex items-center gap-1 ">
        <span
          v-if="selectedValues.length > 0"
          class="selection-count text-3! text-3xs font-medium text-accent"
          data-test="field-values-panel-selection-count"
        >
          {{ selectedValues.length }} {{ t('search.selectedLabel') }}
        </span>
        <span v-else class="selection-hint  text-3! text-3xs text-text-secondary">{{ t('search.selectToFilter') }}</span>
        <OButton
          v-if="selectedValues.length > 0"
          variant="ghost"
          size="icon"
          :title="t('search.clearSelection')"
          class="selection-clear-btn"
          @click="clearSelection"
          data-test="field-values-panel-clear-selection-btn"
        >
          <OIcon name="close" size="xs" />
        </OButton>
      </div>
      <div
        class="filter-mode-toggle flex border border-card-glass-border rounded-default overflow-hidden"
        data-test="field-values-panel-filter-mode-toggle"
      >
        <OButton
          :variant="filterMode === 'include' ? 'primary' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn rounded-none! [transition:background_0.15s,color_0.15s]"
          :disabled="filterMode !== 'include' && isModeToggleDisabled"
          :title="t('search.includeModeHint')"
          @click="setFilterMode('include')"
          data-test="field-values-panel-include-mode-btn"
        >
          <!-- name="" → OIcon renders the slotted custom SVG -->
          <OIcon name="" class="h-2.5! w-2.5! m-0.5!">
            <EqualIcon />
          </OIcon>
        </OButton>
        <OButton
          :variant="filterMode === 'exclude' ? 'destructive' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn rounded-none! [transition:background_0.15s,color_0.15s]"
          :disabled="filterMode !== 'exclude' && isModeToggleDisabled"
          :title="t('search.excludeModeHint')"
          @click="setFilterMode('exclude')"
          data-test="field-values-panel-exclude-mode-btn"
        >
          <OIcon name="" class="h-2.5! w-2.5! m-0.5!">
            <NotEqualIcon />
          </OIcon>
        </OButton>
      </div>
    </div>

    <!-- Scrollable values area -->
    <div class="max-h-64 overflow-y-auto">
      <!-- Loading state (only shown when there are no interim cached results) -->
      <div
        v-show="fieldValues?.isLoading && !displayValues.length"
        class="relative pl-3 py-1 h-15"
      >
        <!-- scrim off: this box is empty while loading, so there is nothing to
             dim — and the scrim is 70% of surface-base (white), which on this
             panel's grey surface just reads as a white block. -->
        <OInnerLoading
          :showing="!!fieldValues?.isLoading && !displayValues.length"
          :label="t('search.fetchingValues')"
          size="xs"
          :scrim="false"
          data-test="field-values-panel-loading-indicator"
        />
      </div>

      <!-- No values found -->
      <div
        v-show="!displayValues.length && !fieldValues?.isLoading"
        class="pl-3 py-1 text-sm text-o2-text-secondary"
        data-test="field-values-panel-no-values-msg"
      >
        <template v-if="fieldValues?.errMsg">{{ fieldValues.errMsg }}</template>
        <template v-else>
          {{ t("search.fieldValuesEmpty") }}
          <span class="block text-xs text-o2-text-muted mt-0.5">
            {{ t("search.fieldValuesEmptyHint") }}
          </span>
        </template>
      </div>

      <!-- Selected values with no count data available (synthetic fallback) -->
      <div
        v-if="displayValues.length > 0 && (displayValues[0] as any)?.synthetic && !fieldValues?.isLoading"
        class="pl-3 pb-1 text-xs text-o2-text-secondary italic"
        data-test="field-values-panel-no-count-msg"
      >
        {{ t('search.noDataInRangeHint') }}
      </div>

      <!-- Field values list -->
      <ul
        class="flex flex-col m-0 p-0 list-none"
        data-test="field-values-panel-values-list"
      >
        <li v-for="value in displayValues" :key="value.key" class="py-1">
          <label
            class="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-muted/50"
            :data-test="`logs-search-subfield-add-${fieldName}-${value.key}`"
          >
            <!-- Checkbox for multi-select — uses :model-value + @update to
                 separate user-initiated changes from parent-sync updates,
                 preventing re-emit loops when the parent reflects query state. -->
            <OCheckbox
              v-if="showMultiSelect"
              :model-value="selectedValues"
              :value="value.key"
              :color="filterMode === 'exclude' ? 'negative' : 'primary'"
              size="xs"
              class="shrink-0"
              @update:model-value="handleUserCheckboxChange"
              @click.stop
            />

            <div
              class="flex flex-row flex-wrap justify-between min-w-0 pl-1"
              :class="showMultiSelect ? 'w-[calc(100%-1.5rem)]' : 'w-full'"
            >
              <div
                :title="value.key"
                class="truncate pr-1 text-field-list-label-text text-3! w-[calc(100%-3.125rem)]"
              >
                {{ value.label ?? value.key }}
              </div>
              <div
                v-if="value.count != null"
                :title="String(value.count)"
                class="truncate text-right pr-0 text-3! contents"
                :class="showMultiSelect ? 'w-[3.125rem]' : ''"
              >
                {{ formatLargeNumber(value.count) }}
              </div>
            </div>
          </label>
        </li>
      </ul>
    </div>

    <!-- View more values / loading more indicator -->
    <div
      v-if="isLoadingMore || (fieldValues?.hasMore && !fieldValues?.isLoading)"
      class="w-full flex justify-center border-t border-card-glass-border pt-1 px-1"
    >
      <button
        class="inline-flex items-center gap-1 bg-transparent border-0 text-accent text-2xs font-[inherit] py-0.5 px-1 cursor-pointer rounded-default transition-opacity duration-150 hover:opacity-80 hover:bg-interactive-hover-bg disabled:opacity-50 disabled:cursor-default"
        :disabled="isLoadingMore"
        @click="handleLoadMoreClick"
        :data-test="`log-search-subfield-load-more-${fieldName}`"
      >
        <OSpinner variant="dots" v-if="isLoadingMore" size="xs" />
        <span v-else>{{ t('search.viewMoreValues') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDebounceFn, watchDebounced } from "@vueuse/core";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";

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

const { t } = useI18n();

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
// When the API returns no values but there are selected values (e.g. after page
// refresh where the filter exists in the URL but the time range yields no data),
// synthesise the selected values as items so the user can see and deselect them
// instead of seeing a contradictory "N selected / No values found" state.
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

  const apiValues = props.fieldValues?.values || [];
  if (apiValues.length > 0) return apiValues;

  // No API values — fall back to synthetic entries for each selected value so
  // they remain visible and removable (count: null signals no data available).
  if (selectedValues.value.length > 0 && !props.fieldValues?.isLoading) {
    return selectedValues.value.map(
      (v): { key: string; count: number; label?: string; synthetic: boolean } => ({
        key: v,
        count: null as unknown as number,
        synthetic: true,
      }),
    );
  }

  return [];
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
const handleUserCheckboxChange = (value: CheckboxModelValue) => {
  // Array (group) mode: OCheckbox emits the current selection as primitives.
  const newValues = Array.isArray(value) ? value.map(String) : [];
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
