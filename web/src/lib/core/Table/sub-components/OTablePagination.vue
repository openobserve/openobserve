<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import { useSlots, computed, onBeforeUnmount, ref, watch } from "vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { activates } from "@/lib/core/Button/activation";

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
    /** Rows currently selected; read only when `#selection-actions` is provided. */
    selectedCount?: number;
    bordered?: boolean;
    /** No rows are on screen (the table shows its error state), so the range would describe rows nobody sees. */
    rangeHidden?: boolean;
  }>(),
  {
    position: "bottom",
    totalCountExact: true,
    selectedCount: 0,
    bordered: true,
  },
);

const emit = defineEmits<{
  "update:pageSize": [size: number];
  "first-page": [];
  "prev-page": [];
  "next-page": [];
  "last-page": [];
}>();

const showSkeleton = useDelayedFlag(() => !!props.loading, LOADER_DELAY_MS);

// A second "next" before the first page arrives would count from the requested page, so paging waits for it.
const pagingInactive = computed(() => !!props.pending || !!props.stale);

// Controls a consumer renders or a select owns cannot take aria-disabled themselves, so their wrapper swallows activation.
function swallowActivation(event: Event, inactive: boolean): void {
  if (!inactive) return;
  if (!activates(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

function requestPage(event: "first-page" | "prev-page" | "next-page" | "last-page"): void {
  if (pagingInactive.value) return;
  if (event === "first-page") emit("first-page");
  else if (event === "prev-page") emit("prev-page");
  else if (event === "next-page") emit("next-page");
  else emit("last-page");
}

// Menus these wrappers open are portaled outside them, so an inactive wrapper closes them and blocks their items.
const pageSizeRef = ref<HTMLElement | null>(null);
const selectionActionsRef = ref<HTMLElement | null>(null);
const MENU_EVENTS = ["pointerdown", "pointerup", "mousedown", "click", "keydown"] as const;

// Reka fills a dropdown's aria-controls only after its trigger rendered, so the menu is also found by its aria-labelledby.
function openMenus(root: HTMLElement | null): Element[] {
  if (!root) return [];
  const triggers = Array.from(root.querySelectorAll('[aria-expanded="true"]'));
  if (!triggers.length) return [];
  const triggerIds = new Set(triggers.map((trigger) => trigger.id).filter(Boolean));
  const controlled = triggers.flatMap((trigger) =>
    (trigger.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)),
  );
  const labelled = Array.from(document.querySelectorAll("[aria-labelledby]")).filter((el) =>
    (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).some((id) => triggerIds.has(id)),
  );
  return [...new Set([...controlled, ...labelled])].filter(
    (menu): menu is Element => !!menu && !root.contains(menu),
  );
}

function guardMenusWhile(root: () => HTMLElement | null, active: () => boolean): void {
  let menus: Element[] = [];
  const block = (event: Event): void => {
    if (!activates(event)) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (![...menus, ...openMenus(root())].some((menu) => menu.contains(target))) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const stop = (): void => {
    MENU_EVENTS.forEach((type) => document.removeEventListener(type, block, true));
    menus = [];
  };
  watch(active, (on) => {
    if (!on) {
      stop();
      return;
    }
    menus = openMenus(root());
    MENU_EVENTS.forEach((type) => document.addEventListener(type, block, true));
    // Escape is the menus' own dismiss path and only reaches the topmost layer, which an open menu is.
    menus.forEach((menu) =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
  });
  onBeforeUnmount(stop);
}

guardMenusWhile(
  () => pageSizeRef.value,
  () => pagingInactive.value,
);
guardMenusWhile(
  () => selectionActionsRef.value,
  () => !!props.stale,
);

const pageSizeModel = computed({
  get: () => props.pageSize,
  set: (val: number) => {
    if (!pagingInactive.value) emit("update:pageSize", val);
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

const selectionLabel = computed(() => {
  const selected = props.selectedCount.toLocaleString();
  // A selection can outlive its rows (filter, refetch), and "5 of 3 selected" reads as a bug.
  if (props.selectedCount > props.totalCount) {
    return t("components.table.selectedCount", { selected });
  }
  const total = `${props.totalCount.toLocaleString()}${props.totalCountExact ? "" : "+"}`;
  return t("components.table.selectedOfTotal", { selected, total });
});
</script>

<template>
  <div
    :data-test="`o2-table-pagination-${position}`"
    :class="[
      'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 max-md:gap-y-2',
      bordered ? 'border-border-default border-t' : '',
    ]"
  >
    <!-- Slot presence is read here, not in a computed: slots are not reactive, so a cached answer would miss a slot the page adds later. -->
    <div
      v-if="!loading && selectedCount > 0 && slots['selection-actions']"
      class="flex min-h-[2.125rem] min-w-0 items-center gap-x-3 gap-y-1 max-md:basis-full max-md:flex-wrap"
      data-test="o2-table-pagination-selection"
    >
      <span
        class="text-text-heading text-xs font-medium whitespace-nowrap"
        role="status"
        data-test="o2-table-selected-count"
        >{{ selectionLabel }}</span
      >
      <span class="bg-border-default h-4 w-px shrink-0 max-md:hidden" aria-hidden="true" />
      <div
        :class="[
          'flex min-w-0 flex-wrap items-center gap-2 transition-opacity',
          stale ? 'cursor-not-allowed opacity-60' : '',
        ]"
        :role="stale ? 'group' : undefined"
        :aria-disabled="stale ? 'true' : undefined"
        ref="selectionActionsRef"
        data-test="o2-table-selection-actions"
        @pointerdown.capture="swallowActivation($event, !!stale)"
        @mousedown.capture="swallowActivation($event, !!stale)"
        @click.capture="swallowActivation($event, !!stale)"
        @keydown.capture="swallowActivation($event, !!stale)"
      >
        <slot name="selection-actions" />
      </div>
    </div>

    <!-- max-md:contents makes the note's own root the flex item, so a root that is max-md:hidden leaves no row and no gap. -->
    <div
      v-else-if="!loading && slots['footer-note']"
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
        v-else
        :class="[
          'text-primary text-xs whitespace-nowrap transition-opacity',
          stale ? 'opacity-60' : '',
          rangeHidden ? 'invisible' : '',
        ]"
        :aria-hidden="rangeHidden ? 'true' : undefined"
        data-test="o2-table-pagination-info"
      >
        {{ t("search.showing") }} {{ showingFrom }} - {{ showingTo }} {{ t("search.of") }}
        {{ totalCount.toLocaleString() }}{{ totalCountExact ? "" : "+" }}
      </span>
      <div
        :class="[
          'bg-border-default h-4 w-px shrink-0 max-md:hidden',
          rangeHidden ? 'invisible' : '',
        ]"
        v-if="pageSizeOptions.length > 0"
        data-test="o2-table-pagination-divider"
      />
      <div
        v-if="pageSizeOptions.length > 0"
        :class="[
          'text-primary flex items-center gap-1.5 text-xs transition-opacity',
          stale ? 'cursor-not-allowed opacity-60' : '',
        ]"
        :role="pagingInactive ? 'group' : undefined"
        :aria-disabled="pagingInactive ? 'true' : undefined"
        ref="pageSizeRef"
        data-test="o2-table-page-size"
        @pointerdown.capture="swallowActivation($event, pagingInactive)"
        @mousedown.capture="swallowActivation($event, pagingInactive)"
        @click.capture="swallowActivation($event, pagingInactive)"
        @keydown.capture="swallowActivation($event, pagingInactive)"
      >
        <span class="whitespace-nowrap max-md:hidden">{{ t("search.recordsPerPage") }}</span>
        <OSelect
          v-model="pageSizeModel"
          :options="pageSizeSelectOptions"
          :searchable="false"
          size="sm"
          :aria-label="t('search.recordsPerPage')"
          data-test="o2-table-page-size-select"
        />
      </div>

      <nav class="flex items-center gap-1" :aria-label="t('components.pagination.pagination')">
        <OButton
          variant="outline"
          size="icon"
          :disabled="isFirstPage || stale"
          focusable-unavailable
          :aria-label="t('search.firstPage')"
          data-test="o2-table-first-page-btn"
          :aria-disabled="isFirstPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('first-page')"
        >
          <OIcon name="first-page" size="sm" />
          <template v-if="stale && !isFirstPage" #unavailable-reason>{{
            t("common.loading")
          }}</template>
        </OButton>
        <OButton
          variant="outline"
          size="icon"
          :disabled="isFirstPage || stale"
          focusable-unavailable
          :aria-label="t('components.pagination.previousPage')"
          data-test="o2-table-prev-page-btn"
          :aria-disabled="isFirstPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('prev-page')"
        >
          <OIcon name="chevron-left" size="sm" />
          <template v-if="stale && !isFirstPage" #unavailable-reason>{{
            t("common.loading")
          }}</template>
        </OButton>
        <OButton
          variant="outline"
          size="icon"
          :disabled="isLastPage || stale"
          focusable-unavailable
          :aria-label="t('components.pagination.nextPage')"
          data-test="o2-table-next-page-btn"
          :aria-disabled="isLastPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('next-page')"
        >
          <OIcon name="chevron-right" size="sm" />
          <template v-if="stale && !isLastPage" #unavailable-reason>{{
            t("common.loading")
          }}</template>
        </OButton>
        <OButton
          v-if="totalCountExact"
          variant="outline"
          size="icon"
          :disabled="isLastPage || stale"
          focusable-unavailable
          :aria-label="t('search.lastPage')"
          data-test="o2-table-last-page-btn"
          :aria-disabled="isLastPage || pagingInactive ? 'true' : undefined"
          @click="requestPage('last-page')"
        >
          <OIcon name="last-page" size="sm" />
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
