<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { ref, useSlots } from "vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OButton from "@/lib/core/Button/OButton.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import { activates } from "@/lib/core/Button/activation";
import { useInactiveMenus } from "@/lib/navigation/Pagination/useInactiveMenus";

const { t } = useI18nTyped();
const slots = useSlots();

const props = withDefaults(
  defineProps<{
    currentPage: number;
    totalPages: number;
    totalCount: number;
    /** False when totalCount is only a lower bound. */
    totalCountExact?: boolean;
    pageSize: number;
    pageSizeOptions: number[];
    /** The built-in pager is on; off, the bar only appears as the selection bar. */
    paged?: boolean;
    /** The first page is loading: the range is a skeleton and the start side is withheld. */
    loading?: boolean;
    /** A page request is in flight: paging and page size ignore input at once, before any dim. */
    pending?: boolean;
    /** The rows on screen are being refetched: the range dims, controls stay focusable but inactive. */
    stale?: boolean;
    /** Rows currently selected, for the selection bar (D6). */
    selectedCount?: number;
    /** No rows are on screen (the table shows its error state), so the range would describe nothing. */
    rangeHidden?: boolean;
  }>(),
  {
    totalCountExact: true,
    paged: true,
    selectedCount: 0,
  },
);

const emit = defineEmits<{
  "update:pageSize": [size: number];
  "go-to-page": [page: number];
  "clear-selection": [];
}>();

const showSkeleton = useDelayedFlag(() => !!props.loading, LOADER_DELAY_MS);

// Bulk actions act on rows that are about to be replaced, so a refetch makes them inert.
function swallowActivation(event: Event): void {
  if (!props.stale || !activates(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

// A bulk action's menu is portaled outside the bar, so a refetch closes an open one.
const actionsRef = ref<HTMLElement | null>(null);
useInactiveMenus(
  () => actionsRef.value,
  () => !!props.stale,
);
</script>

<template>
  <div
    data-test="o2-table-pagination-bottom"
    data-toast-avoid=""
    :class="[
      'px-page-edge border-table-row-divider flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 text-xs max-md:gap-y-2',
      !loading && selectedCount > 0 ? 'bg-table-row-selected-bg' : '',
    ]"
  >
    <!-- Slot presence is read in the template: slots are not reactive, so a cached answer would miss one added later. -->
    <div
      v-if="!loading && selectedCount > 0"
      class="flex min-w-0 items-center gap-x-3 gap-y-1 max-md:basis-full max-md:flex-wrap"
      data-test="o2-table-pagination-selection"
    >
      <span
        class="text-text-heading text-compact font-semibold whitespace-nowrap tabular-nums"
        role="status"
        data-test="o2-table-selected-count"
        >{{
          t("components.table.selectedCount", { selected: selectedCount.toLocaleString() })
        }}</span
      >
      <div
        v-if="slots['selection-actions']"
        ref="actionsRef"
        :class="[
          'flex min-w-0 flex-wrap items-center gap-2 transition-opacity',
          stale ? 'cursor-not-allowed opacity-60' : '',
        ]"
        :role="stale ? 'group' : undefined"
        :aria-disabled="stale ? 'true' : undefined"
        data-test="o2-table-selection-actions"
        @pointerdown.capture="swallowActivation"
        @mousedown.capture="swallowActivation"
        @click.capture="swallowActivation"
        @keydown.capture="swallowActivation"
      >
        <slot name="selection-actions" />
      </div>
      <OButton
        variant="link"
        :label="t('components.table.clearSelection')"
        data-test="o2-table-clear-selection"
        @click="emit('clear-selection')"
      />
    </div>

    <!-- max-md:contents makes the note's own root the flex item, so a root that is max-md:hidden leaves no row and no gap. -->
    <div
      v-else-if="!loading && slots['footer-note']"
      class="text-text-secondary min-w-0 flex-auto max-md:contents"
      data-test="o2-table-pagination-note"
    >
      <slot name="footer-note" />
    </div>

    <OPagination
      v-if="paged"
      class="ms-auto max-md:basis-full max-md:justify-between"
      :page="currentPage"
      :page-count="totalPages"
      :page-size="pageSize"
      :page-sizes="pageSizeOptions"
      :total="totalCount"
      :total-exact="totalCountExact"
      :loading="!!pending || !!stale"
      :test-ids="{
        range: 'o2-table-pagination-info',
        size: 'o2-table-page-size-select',
        first: 'o2-table-first-page-btn',
        prev: 'o2-table-prev-page-btn',
        next: 'o2-table-next-page-btn',
        last: 'o2-table-last-page-btn',
      }"
      data-test="o2-table-pager"
      @update:page="emit('go-to-page', $event)"
      @update:page-size="emit('update:pageSize', $event)"
    >
      <template #range="{ text }">
        <span
          v-if="loading"
          :class="showSkeleton ? '' : 'invisible'"
          class="o2-pag-skel rounded-default inline-block h-3 w-28 [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]"
          aria-hidden="true"
          data-test="o2-table-pagination-info-skel"
        />
        <span
          v-else
          :class="[
            'text-text-secondary text-xs whitespace-nowrap tabular-nums transition-opacity',
            stale ? 'opacity-60' : '',
            rangeHidden ? 'invisible' : '',
          ]"
          :aria-hidden="rangeHidden ? 'true' : undefined"
          data-test="o2-table-pagination-info"
          >{{ text }}</span
        >
      </template>
    </OPagination>
  </div>
</template>

<style scoped>
/* keep(keyframes): reduced motion cancels the range shimmer; a motion-reduce utility
   does not outrank the arbitrary [animation:…] utility that starts it. */
@media (prefers-reduced-motion: reduce) {
  .o2-pag-skel {
    animation: none;
  }
}
</style>
