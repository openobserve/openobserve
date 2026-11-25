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
    <div
      v-if="showValueSearch"
      class="value-search-container pe-page-edge mb-1 ps-[calc(var(--spacing-page-edge)+0.375rem)]"
    >
      <div class="value-search-input-wrap">
        <OSearchInput
          v-model="valueSearchTerm"
          clearable
          size="sm"
          :placeholder="t('common.searchValuesIn', { field: fieldName })"
          @clear="valueSearchTerm = ''"
        />
      </div>
    </div>

    <div
      v-if="info && !showMultiSelect"
      class="pe-page-edge flex justify-end py-1 ps-[calc(var(--spacing-page-edge)+0.375rem)]"
    >
      <OIcon
        name="info-outline"
        size="xs"
        class="text-text-secondary"
        :data-test="info.testId"
        :aria-label="info.text"
        role="img"
      >
        <OTooltip :content="info.text" />
      </OIcon>
    </div>

    <div
      v-if="showMultiSelect"
      class="filter-mode-bar border-card-glass-border pe-page-edge flex items-center justify-between border-b py-1 ps-[calc(var(--spacing-page-edge)+0.375rem)]"
      data-test="field-values-panel-filter-mode-bar"
    >
      <div class="flex items-center gap-1">
        <span
          v-if="selectedValues.length > 0"
          class="selection-count text-3xs text-accent font-medium"
          data-test="field-values-panel-selection-count"
        >
          {{ selectedValues.length }} {{ t("search.selectedLabel") }}
        </span>
        <span v-else class="selection-hint text-3xs text-text-secondary">{{
          t("search.selectToFilter")
        }}</span>
        <OIcon
          v-if="info"
          name="info-outline"
          size="xs"
          class="text-text-secondary"
          :data-test="info.testId"
          :aria-label="info.text"
          role="img"
        >
          <OTooltip :content="info.text" />
        </OIcon>
        <OButton
          v-if="selectedValues.length > 0"
          variant="ghost"
          size="icon"
          :aria-label="t('search.clearSelection')"
          class="selection-clear-btn"
          @click="clearSelection"
          data-test="field-values-panel-clear-selection-btn"
        >
          <OIcon name="close" size="xs" />
          <OTooltip :content="t('search.clearSelection')" />
        </OButton>
      </div>
      <div
        class="filter-mode-toggle border-card-glass-border rounded-default flex overflow-hidden border [&_button:focus-visible]:-outline-offset-2!"
        data-test="field-values-panel-filter-mode-toggle"
      >
        <OButton
          :variant="filterMode === 'include' ? 'primary' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn rounded-none! [transition:background_0.15s,color_0.15s]"
          :aria-label="t('search.includeModeHint')"
          :aria-pressed="filterMode === 'include'"
          @click="setFilterMode('include')"
          data-test="field-values-panel-include-mode-btn"
        >
          <!-- name="" → OIcon renders the slotted custom SVG -->
          <OIcon name="" class="m-0.5! h-2.5! w-2.5!">
            <EqualIcon />
          </OIcon>
          <OTooltip :content="t('search.includeModeHint')" />
        </OButton>
        <OButton
          :variant="filterMode === 'exclude' ? 'filter-exclude' : 'ghost-muted'"
          size="icon-chip"
          class="filter-mode-btn rounded-none! [transition:background_0.15s,color_0.15s]"
          :aria-label="t('search.excludeModeHint')"
          :aria-pressed="filterMode === 'exclude'"
          @click="setFilterMode('exclude')"
          data-test="field-values-panel-exclude-mode-btn"
        >
          <OIcon name="" class="m-0.5! h-2.5! w-2.5!">
            <NotEqualIcon />
          </OIcon>
          <OTooltip :content="t('search.excludeModeHint')" />
        </OButton>
      </div>
    </div>

    <div
      ref="valuesListRef"
      class="max-h-64 overflow-y-auto transition-opacity"
      :class="refreshing ? 'opacity-60' : ''"
      :aria-busy="refreshing || undefined"
      data-test="field-values-panel-scroll"
      @scroll.passive="resumeAutoLoad"
    >
      <!-- Loading state (only shown when there are no interim cached results) -->
      <div v-show="fieldValues?.isLoading && !displayValues.length" class="relative h-15 py-1 ps-3">
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
        class="text-o2-text-secondary py-1 ps-3 text-sm"
        data-test="field-values-panel-no-values-msg"
      >
        <template v-if="fieldValues?.errMsg">{{ fieldValues.errMsg }}</template>
        <template v-else>
          {{ t("search.fieldValuesEmpty") }}
          <span class="text-o2-text-muted mt-0.5 block text-xs">
            {{ t("search.fieldValuesEmptyHint") }}
          </span>
        </template>
      </div>

      <!-- Selected values with no count data available (synthetic fallback) -->
      <div
        v-if="
          displayValues.length > 0 && 'synthetic' in displayValues[0] && !fieldValues?.isLoading
        "
        class="text-o2-text-secondary ps-3 pb-1 text-xs italic"
        data-test="field-values-panel-no-count-msg"
      >
        {{ t("search.noDataInRangeHint") }}
      </div>

      <ul class="m-0 flex list-none flex-col p-0" data-test="field-values-panel-values-list">
        <li
          v-for="(value, index) in displayValues"
          :key="value.key"
          class="group hover:bg-muted/50 pe-page-edge flex items-center ps-[calc(var(--spacing-page-edge)+0.375rem)]"
          @focusin="index === displayValues.length - 1 && loadFromFocus()"
        >
          <!-- A div, not a label: a label would hand clicks on the count to the copy button inside it. -->
          <div
            class="flex min-h-7 min-w-0 flex-1 items-center gap-1 py-0.5"
            :class="showMultiSelect ? 'cursor-pointer' : ''"
            :data-test="`logs-search-subfield-add-${fieldName}-${testToken(value.key)}`"
            @click="showMultiSelect && toggleValue(value.key)"
          >
            <OCheckbox
              v-if="showMultiSelect"
              :model-value="selectedSet.has(value.key)"
              :color="filterMode === 'exclude' ? 'negative' : 'primary'"
              size="xs"
              class="shrink-0"
              :aria-label="raw(value.label ?? value.key)"
              :data-test="`field-values-panel-checkbox-${fieldName}-${testToken(value.key)}`"
              @update:model-value="toggleValue(value.key)"
              @click.stop
            />
            <!-- The checkbox already names the full value, so the cut text is no second Tab stop. -->
            <span class="flex min-w-0 flex-1 items-center gap-0.5">
              <OTruncatedText
                truncate="middle"
                :text="value.label ?? value.key"
                :focusable="!showMultiSelect"
                fit-parent
                tooltip-class="whitespace-pre-wrap break-all"
                class="text-field-list-label-text min-w-0 shrink ps-1"
                data-test="field-values-panel-value-text"
              />
              <OButton
                variant="ghost"
                size="icon-xs"
                class="size-5! shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100 max-md:opacity-100"
                :aria-label="
                  copiedKey === value.key ? t('common.copied') : t('common.copyToClipboard')
                "
                :data-test="`field-values-panel-copy-${fieldName}-${testToken(value.key)}`"
                :data-copied="copiedKey === value.key ? 'true' : undefined"
                @click.stop.prevent="copyValue(value.key, value.label ?? value.key)"
              >
                <OIcon :name="copiedKey === value.key ? 'check' : 'content-copy'" size="xs" />
                <OTooltip :content="t('common.copyToClipboard')" />
              </OButton>
            </span>
            <span
              v-if="value.count !== null"
              :title="String(value.count)"
              class="w-12 shrink-0 text-right tabular-nums"
              data-test="field-values-panel-value-count"
              >{{ formatLargeNumber(value.count) }}</span
            >
          </div>
        </li>
      </ul>

      <div ref="sentinelRef" aria-hidden="true" data-test="field-values-panel-load-more-sentinel" />

      <div
        v-if="isLoadingMore"
        class="flex flex-col"
        aria-hidden="true"
        data-test="field-values-panel-load-more-skeleton"
      >
        <div
          v-for="row in 3"
          :key="row"
          class="pe-page-edge flex items-center gap-1 py-1 ps-[calc(var(--spacing-page-edge)+0.375rem)]"
        >
          <OSkeleton v-if="showMultiSelect" type="rect" class="rounded-default h-3 w-3 shrink-0" />
          <OSkeleton type="text" class="ms-1 flex-1" />
          <OSkeleton type="text" class="w-8 shrink-0" />
        </div>
      </div>

      <div
        v-if="fieldValues?.errMsg && displayValues.length && !loadMoreBusy"
        class="text-status-error-text pe-page-edge py-1 ps-[calc(var(--spacing-page-edge)+0.375rem)] text-xs"
        role="alert"
        data-test="field-values-panel-load-error"
      >
        {{ fieldValues.errMsg }}
      </div>
    </div>

    <div
      class="sr-only"
      role="status"
      aria-live="polite"
      data-test="field-values-panel-load-more-status"
    >
      {{ isLoadingMore ? t("search.loadingMoreValues") : "" }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDebounceFn } from "@vueuse/core";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber } from "@/utils/zincutils";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { valueKeyLabel } from "@/components/common/fieldPanel/valueFilterExpression";

type FilterMode = "include" | "exclude";

interface FieldValues {
  isLoading: boolean;
  values: { key: string; count: number; label?: I18nText }[];
  errMsg?: string;
  hasMore?: boolean;
  generation?: number;
  settled?: number;
}

interface Props {
  fieldName: string;
  fieldValues?: FieldValues;
  showMultiSelect?: boolean;
  defaultValuesCount?: number;
  theme?: string;
  activeIncludeValues?: string[];
  activeExcludeValues?: string[];
  /** Scope note for these values, shown behind an info icon. */
  info?: { text: I18nText; testId?: string } | null;
}

const { t } = useI18nTyped();

const props = withDefaults(defineProps<Props>(), {
  showMultiSelect: true,
  defaultValuesCount: 10,
  theme: "light",
});

const emit = defineEmits<{
  "set-value-filters": [fieldName: string, include: string[], exclude: string[]];
  "remove-field-filter": [fieldName: string];
  "load-more-values": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
}>();

const initialMode = (): FilterMode =>
  (props.activeExcludeValues?.length ?? 0) > 0 ? "exclude" : "include";

/** One operator for every ticked value of the field; switching it flips them all. */
const filterMode = ref<FilterMode>(initialMode());

const activeValues = (): string[] => [
  ...new Set([...(props.activeIncludeValues ?? []), ...(props.activeExcludeValues ?? [])]),
];

const selectedValues = ref<string[]>(activeValues());
const selectedSet = computed(() => new Set(selectedValues.value));

// Set by a mode switch until its debounced query goes out; a tick, clear or reset supersedes it.
let modeChangePending = false;

const sameValues = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const matchesQuery = (): boolean =>
  filterMode.value === initialMode() && sameValues(selectedValues.value, activeValues());

// A re-render passes new arrays with the same values; only a real query change re-syncs, so a pending switch survives.
watch(
  () => [props.activeIncludeValues ?? [], props.activeExcludeValues ?? []] as const,
  ([include, exclude], [prevInclude, prevExclude]) => {
    if (sameValues(include, prevInclude) && sameValues(exclude, prevExclude)) return;
    modeChangePending = false;
    selectedValues.value = activeValues();
    if (include.length + exclude.length > 0) filterMode.value = initialMode();
  },
);

const valueSearchTerm = ref("");
const cachedValues = ref<{ key: string; count: number; label?: I18nText }[]>([]);

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
  if (props.fieldValues?.isLoading && valueSearchTerm.value && cachedValues.value.length) {
    const term = valueSearchTerm.value.toLowerCase();
    return cachedValues.value.filter((v) => String(v.key).toLowerCase().includes(term));
  }

  const apiValues = props.fieldValues?.values || [];
  if (apiValues.length > 0) return apiValues;

  // No API values — fall back to synthetic entries for each selected value so
  // they remain visible and removable (count: null signals no data available).
  if (selectedValues.value.length > 0 && !props.fieldValues?.isLoading) {
    return selectedValues.value.map(
      (v): { key: string; count: number | null; label?: I18nText; synthetic: boolean } => ({
        key: v,
        count: null,
        label: valueKeyLabel(v),
        synthetic: true,
      }),
    );
  }

  return [];
});

// A refetch keeps the old values until the new ones land, so they are marked busy instead of emptied.
const refreshing = computed(() => !!props.fieldValues?.isLoading && displayValues.value.length > 0);

// Show search box whenever there are values to search.
const showValueSearch = computed(
  () => cachedValues.value.length > 0 || (props.fieldValues?.values?.length ?? 0) > 0,
);

// Internal keys start with NUL (the missing value is NUL + "null"), which a test-id selector cannot carry.
const testToken = (key: string): string =>
  key.startsWith("\u0000") ? `__${key.replaceAll("\u0000", "")}__` : key;

const emitSelection = () => {
  if (selectedValues.value.length === 0) {
    emit("remove-field-filter", props.fieldName);
    return;
  }
  const values = [...selectedValues.value];
  if (filterMode.value === "exclude") emit("set-value-filters", props.fieldName, [], values);
  else emit("set-value-filters", props.fieldName, values, []);
};

// Rapid flips send one query, so an intermediate result never resets the list.
const emitModeChange = useDebounceFn(() => {
  if (!modeChangePending) return;
  modeChangePending = false;
  if (!matchesQuery()) emitSelection();
}, 300);

const setFilterMode = (mode: FilterMode) => {
  if (filterMode.value === mode) return;
  filterMode.value = mode;
  if (selectedValues.value.length === 0) return;
  modeChangePending = true;
  emitModeChange();
};

const toggleValue = (key: string) => {
  modeChangePending = false;
  selectedValues.value = selectedSet.value.has(key)
    ? selectedValues.value.filter((value) => value !== key)
    : [...selectedValues.value, key];
  emitSelection();
};

const clearSelection = () => {
  modeChangePending = false;
  selectedValues.value = [];
  emit("remove-field-filter", props.fieldName);
};

// The check swaps in on the button itself, as dashboard table cells do, so no bubble covers the value.
const copiedKey = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const copyValue = async (key: string, text: string) => {
  if (!(await copyToClipboard(text, t, { silent: true }))) {
    toast({ variant: "error", message: t("common.copyError") });
    return;
  }
  copiedKey.value = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedKey.value = null;
  }, 2000);
};

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

const valuesListRef = ref<HTMLElement | null>(null);
// Set once a search was sent, so clearing a term that never left the input sends nothing.
let searchSent = false;
let scrollBeforeSearch: number | null = null;
let scrollToRestore: number | null = null;

const emitSearch = useDebounceFn((term: string) => {
  if (!term || term !== valueSearchTerm.value) return;
  searchSent = true;
  emit("search-field-values", props.fieldName, term);
}, 300);

// Clearing is sent at once: the source puts the earlier list back without a request.
watch(valueSearchTerm, (term, previous) => {
  if (term) {
    if (!previous) scrollBeforeSearch = valuesListRef.value?.scrollTop ?? 0;
    emitSearch(term);
    return;
  }
  const restoreTo = scrollBeforeSearch;
  scrollBeforeSearch = null;
  // A term cleared before it was sent never changed the list, so there is no scroll to put back.
  if (!searchSent) return;
  scrollToRestore = restoreTo;
  searchSent = false;
  emit("search-field-values", props.fieldName, "");
});

watch(
  () => props.fieldValues?.values,
  (values) => {
    const el = valuesListRef.value;
    if (scrollToRestore === null || valueSearchTerm.value || props.fieldValues?.isLoading) return;
    if (!el || !values?.length) return;
    el.scrollTop = scrollToRestore;
    scrollToRestore = null;
  },
  { flush: "post" },
);

const isLoadingMore = ref(false);
// The fetch generation current when the page was asked for; the load-more is the next one.
let generationBeforeLoadMore = 0;
// A failed or declined page stops auto-loading until the user scrolls or the list is refetched, so it never retries in a loop.
let autoLoadPaused = false;
// Tied counts can bring full pages of values already shown, so a run of such pages also waits for the user to scroll.
const MAX_EMPTY_AUTO_LOADS = 3;
let lengthBeforeLoadMore = 0;
let emptyAutoLoads = 0;

// A fetch still streaming may yet change the list, so the next page waits for it to settle.
const fetchPending = computed(() => {
  const state = props.fieldValues;
  return state?.generation !== undefined && state.settled !== state.generation;
});

const loadMoreBusy = computed(() => isLoadingMore.value || fetchPending.value);

const canLoadMore = (): boolean =>
  !!props.fieldValues?.hasMore && !props.fieldValues?.isLoading && !loadMoreBusy.value;

const loadNextPage = () => {
  if (!canLoadMore()) return;
  generationBeforeLoadMore = props.fieldValues?.generation ?? 0;
  lengthBeforeLoadMore = props.fieldValues?.values?.length ?? 0;
  isLoadingMore.value = true;
  emit("load-more-values", props.fieldName);
  // A source that declines the page starts no fetch, so no settle would ever end the wait.
  void nextTick(() => {
    if ((props.fieldValues?.generation ?? 0) === generationBeforeLoadMore) {
      isLoadingMore.value = false;
      autoLoadPaused = true;
    }
  });
};

// Focus on the last row is the keyboard's way to the end of the list, so it asks even after a failure.
const loadFromFocus = () => {
  autoLoadPaused = false;
  loadNextPage();
};

const sentinelRef = ref<HTMLElement | null>(null);
let sentinelObserver: IntersectionObserver | null = null;

// Observing again yields a fresh entry, so a sentinel still in view after a page lands loads the next one.
const observeSentinel = () => {
  const sentinel = sentinelRef.value;
  if (!sentinelObserver || !sentinel) return;
  sentinelObserver.unobserve(sentinel);
  sentinelObserver.observe(sentinel);
};

const resumeAutoLoad = () => {
  if (!autoLoadPaused) return;
  autoLoadPaused = false;
  emptyAutoLoads = 0;
  observeSentinel();
};

onMounted(() => {
  if (typeof IntersectionObserver === "undefined" || !valuesListRef.value) return;
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      if (entries[entries.length - 1]?.isIntersecting && !autoLoadPaused) loadNextPage();
    },
    // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin parses px/% only
    { root: valuesListRef.value, rootMargin: "0px 0px 84px 0px" },
  );
  observeSentinel();
});

onBeforeUnmount(() => {
  sentinelObserver?.disconnect();
  sentinelObserver = null;
});

watch(
  () => [
    displayValues.value.length,
    loadMoreBusy.value,
    props.fieldValues?.hasMore,
    props.fieldValues?.isLoading,
  ],
  observeSentinel,
  { flush: "post" },
);

// A fetch the panel did not ask for (new query, value search) brings a new list, so auto-loading may resume.
watch(
  () => props.fieldValues?.generation,
  () => {
    if (isLoadingMore.value) return;
    autoLoadPaused = false;
    emptyAutoLoads = 0;
  },
);

// One stream can grow the list while others are still running, so only the end of the whole fetch ends the wait; a newer fetch that superseded it counts too.
watch(
  () => props.fieldValues?.settled,
  (settled) => {
    if (!isLoadingMore.value || settled === undefined || settled <= generationBeforeLoadMore) {
      return;
    }
    isLoadingMore.value = false;
    const grew = (props.fieldValues?.values?.length ?? 0) > lengthBeforeLoadMore;
    emptyAutoLoads = grew ? 0 : emptyAutoLoads + 1;
    if (props.fieldValues?.errMsg || emptyAutoLoads >= MAX_EMPTY_AUTO_LOADS) autoLoadPaused = true;
  },
);
</script>
