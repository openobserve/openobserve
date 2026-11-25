<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useSlots, computed, ref, useId } from "vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { guardMenusWhile, swallowActivation } from "../composables/useInactiveGuard";

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
    showingFrom: number;
    showingTo: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    position?: "top" | "bottom";
    /** When true, the range text is a skeleton bar (shown after the loader delay) and the start side is withheld. */
    loading?: boolean;
    /** A page request is in flight: paging and page size ignore input at once, before any dim. */
    pending?: boolean;
    /** The rows on screen are being refetched: the range stays dimmed, controls stay focusable but inactive. */
    stale?: boolean;
    bordered?: boolean;
    /** No rows are on screen (the table shows its error state), so the range would describe rows nobody sees. */
    rangeHidden?: boolean;
    /** Show up to this many numbered page buttons between prev and next; off by default. */
    pageWindow?: number;
    /** Paging is locked for this reason: every control is inert and the reason shows on hover. */
    lockedReason?: I18nText;
    /** Replaces the pager's data-test root; prev, next and pages take `-prev`, `-next`, `-page-N`. */
    dataTestPrefix?: string;
    /** Replaces the page-size select's data-test. */
    pageSizeDataTest?: string;
    /** Only the page buttons wait, e.g. while the page count is still settling; page size stays live. */
    navPending?: boolean;
    /** Omit the "x–y of z" range when the page states its counts elsewhere. */
    hideRange?: boolean;
  }>(),
  {
    position: "bottom",
    totalCountExact: true,
    bordered: true,
  },
);

const emit = defineEmits<{
  "update:pageSize": [size: number];
  "first-page": [];
  "prev-page": [];
  "next-page": [];
  "last-page": [];
  "go-to-page": [page: number];
}>();

const showSkeleton = useDelayedFlag(() => !!props.loading, LOADER_DELAY_MS);

// A second "next" before the first page arrives would count from the requested page, so paging waits for it.
const pageSizeInactive = computed(() => !!props.pending || !!props.stale || !!props.lockedReason);
const pagingInactive = computed(() => pageSizeInactive.value || !!props.navPending);

function goToPage(page: number): void {
  if (!pagingInactive.value) emit("go-to-page", page);
}

function requestPage(event: "prev-page" | "next-page"): void {
  if (pagingInactive.value) return;
  if (event === "prev-page") emit("prev-page");
  else emit("next-page");
}

const pageSizeRef = ref<HTMLElement | null>(null);
const lockReasonId = useId();

guardMenusWhile(
  () => pageSizeRef.value,
  () => pageSizeInactive.value,
);

const pageSizeModel = computed({
  get: () => props.pageSize,
  set: (val: number) => {
    if (!pageSizeInactive.value) emit("update:pageSize", val);
  },
});

const pageSizeSelectOptions = computed(() => {
  const opts = [...props.pageSizeOptions];
  // Surface a caller-configured page size that isn't one of the presets, so the
  // select shows it instead of rendering blank.
  if (props.pageSize != null && props.pageSize > 0 && !opts.includes(props.pageSize)) {
    const idx = opts.findIndex((o) => o > (props.pageSize as number));
    if (idx === -1) opts.push(props.pageSize);
    else opts.splice(idx, 0, props.pageSize);
  }
  return opts.map((n) => ({ label: raw(String(n)), value: n }));
});
</script>

<template>
  <div
    :data-test="`o2-table-pagination-${position}`"
    :data-locked="lockedReason ? 'true' : undefined"
    :aria-describedby="lockedReason ? lockReasonId : undefined"
    :class="[
      'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 max-md:gap-y-2',
      bordered ? 'border-border-default border-t' : '',
    ]"
  >
    <span v-if="lockedReason" :id="lockReasonId" class="sr-only">{{ lockedReason }}</span>
    <OTooltip v-if="lockedReason" :content="lockedReason" />
    <!-- max-md:contents makes the note's own root the flex item, so a root that is max-md:hidden leaves no row and no gap. -->
    <div
      v-if="!loading && slots['footer-note']"
      class="text-text-secondary min-w-0 flex-auto text-xs max-md:contents"
      data-test="o2-table-pagination-note"
    >
      <slot name="footer-note" />
    </div>

    <!-- min-h is one small control, so a one-row footer keeps its height even when the page-size select is absent. -->
    <div
      class="ms-auto flex min-h-[2.125rem] min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 max-md:basis-full max-md:justify-between max-md:gap-x-2"
    >
      <span
        v-if="loading"
        :class="showSkeleton ? '' : 'invisible'"
        class="o2-pag-skel rounded-default inline-block h-3 w-36 [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]"
        aria-hidden="true"
        data-test="o2-table-pagination-info-skel"
      />
      <span
        v-else-if="!hideRange"
        :class="[
          'text-text-secondary text-xs whitespace-nowrap tabular-nums transition-opacity',
          stale ? 'opacity-60' : '',
          rangeHidden ? 'invisible' : '',
        ]"
        :aria-hidden="rangeHidden ? 'true' : undefined"
        data-test="o2-table-pagination-info"
      >
        {{ showingFrom }}–{{ showingTo }} {{ t("search.of") }} {{ totalCount.toLocaleString()
        }}{{ totalCountExact ? "" : "+" }}
      </span>
      <div
        :class="[
          'bg-border-default h-4 w-px shrink-0 max-md:hidden',
          rangeHidden ? 'invisible' : '',
        ]"
        v-if="pageSizeOptions.length > 0 && !hideRange"
        data-test="o2-table-pagination-divider"
      />
      <div
        v-if="pageSizeOptions.length > 0"
        :class="[
          'flex items-center gap-1.5 text-xs transition-opacity',
          stale ? 'cursor-not-allowed opacity-60' : '',
        ]"
        :role="pageSizeInactive ? 'group' : undefined"
        :aria-disabled="pageSizeInactive ? 'true' : undefined"
        ref="pageSizeRef"
        data-test="o2-table-page-size"
        @pointerdown.capture="swallowActivation($event, pageSizeInactive)"
        @mousedown.capture="swallowActivation($event, pageSizeInactive)"
        @click.capture="swallowActivation($event, pageSizeInactive)"
        @keydown.capture="swallowActivation($event, pageSizeInactive)"
      >
        <OSelect
          v-model="pageSizeModel"
          :options="pageSizeSelectOptions"
          :searchable="false"
          :disabled="!!lockedReason"
          size="sm"
          :aria-label="t('search.recordsPerPage')"
          :data-test="pageSizeDataTest ?? 'o2-table-page-size-select'"
        />
      </div>

      <OPagination
        v-if="pageWindow"
        :model-value="currentPage"
        :max="totalPages"
        :max-pages="pageWindow"
        :disable="pagingInactive"
        :data-locked="lockedReason ? 'true' : undefined"
        :data-test="dataTestPrefix ?? 'o2-table-page-window'"
        @update:model-value="goToPage"
      />

      <!-- Same compact pager as OPagination (prev, current, next), so every pager reads alike. -->
      <nav
        v-else
        :data-test="dataTestPrefix"
        class="rounded-default border-button-outline-border bg-button-outline-bg inline-flex items-center gap-0.5 border p-px"
        :aria-label="t('components.pagination.pagination')"
      >
        <OButton
          variant="ghost"
          size="icon-chip"
          :disabled="isFirstPage || stale || !!lockedReason"
          focusable-unavailable
          :aria-label="t('components.pagination.previousPage')"
          :data-test="dataTestPrefix ? `${dataTestPrefix}-prev` : 'o2-table-prev-page-btn'"
          :aria-disabled="isFirstPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('prev-page')"
        >
          <OIcon name="fast-rewind" size="sm" />
          <template v-if="stale && !isFirstPage" #unavailable-reason>{{
            t("common.loading")
          }}</template>
        </OButton>
        <span
          class="text-compact bg-pagination-item-active-bg text-pagination-item-active-text ring-selected-border rounded-default flex h-6 min-w-6 items-center justify-center px-1 tabular-nums ring-1 ring-inset"
          aria-current="page"
          data-test="o2-table-current-page"
          >{{ currentPage }}</span
        >
        <OButton
          variant="ghost"
          size="icon-chip"
          :disabled="isLastPage || stale || !!lockedReason"
          focusable-unavailable
          :aria-label="t('components.pagination.nextPage')"
          :data-test="dataTestPrefix ? `${dataTestPrefix}-next` : 'o2-table-next-page-btn'"
          :aria-disabled="isLastPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('next-page')"
        >
          <OIcon name="fast-forward" size="sm" />
          <template v-if="stale && !isLastPage" #unavailable-reason>{{
            t("common.loading")
          }}</template>
        </OButton>
      </nav>
    </div>
  </div>
</template>

<style scoped>
/* keep(keyframes): reduced-motion opt-out for the pagination skeleton shimmer.
   The keyframe itself was `o2-pag-shimmer`, byte-identical to the table
   skeleton's `o2-skel-shimmer` — merged into that one name in
   styles/keyframes.css, which is where it must live because the template starts
   it from an `[animation:…]` utility. This cancel rule stays as CSS: a
   `motion-reduce:animate-none` utility does not reliably outrank the arbitrary
   `[animation:…]` utility it has to override. `.o2-pag-skel` is this
   component's own element, so scoping is safe. */
@media (prefers-reduced-motion: reduce) {
  .o2-pag-skel {
    animation: none;
  }
}
</style>
