<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import { useSlots, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

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
    /** When true, the range text is a skeleton bar and the start side is withheld. */
    loading?: boolean;
    /** Rows currently selected; read only when `#selection-actions` is provided. */
    selectedCount?: number;
    bordered?: boolean;
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

const pageSizeModel = computed({
  get: () => props.pageSize,
  set: (val: number) => emit("update:pageSize", val),
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
      'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1',
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
      <div class="flex min-w-0 flex-wrap items-center gap-2">
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
        class="o2-pag-skel rounded-default inline-block h-3 w-36 [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]"
        aria-hidden="true"
        data-test="o2-table-pagination-info-skel"
      />
      <span
        v-else
        class="text-primary text-xs whitespace-nowrap"
        data-test="o2-table-pagination-info"
      >
        {{ t("search.showing") }} {{ showingFrom }} - {{ showingTo }} {{ t("search.of") }}
        {{ totalCount.toLocaleString() }}{{ totalCountExact ? "" : "+" }}
      </span>
      <div
        class="bg-border-default h-4 w-px shrink-0 max-md:hidden"
        v-if="pageSizeOptions.length > 0"
      />
      <div v-if="pageSizeOptions.length > 0" class="text-primary flex items-center gap-1.5 text-xs">
        <span class="whitespace-nowrap max-md:hidden">{{ t("search.recordsPerPage") }}</span>
        <OSelect
          v-model="pageSizeModel"
          :options="pageSizeSelectOptions"
          :searchable="false"
          size="sm"
          data-test="o2-table-page-size-select"
        />
      </div>

      <div class="flex items-center gap-1">
        <OButton
          variant="outline"
          size="icon"
          :disabled="isFirstPage"
          data-test="o2-table-first-page-btn"
          @click="emit('first-page')"
        >
          <OIcon name="first-page" size="sm" />
        </OButton>
        <OButton
          variant="outline"
          size="icon"
          :disabled="isFirstPage"
          data-test="o2-table-prev-page-btn"
          @click="emit('prev-page')"
        >
          <OIcon name="chevron-left" size="sm" />
        </OButton>
        <OButton
          variant="outline"
          size="icon"
          :disabled="isLastPage"
          data-test="o2-table-next-page-btn"
          @click="emit('next-page')"
        >
          <OIcon name="chevron-right" size="sm" />
        </OButton>
        <OButton
          v-if="totalCountExact"
          variant="outline"
          size="icon"
          :disabled="isLastPage"
          data-test="o2-table-last-page-btn"
          @click="emit('last-page')"
        >
          <OIcon name="last-page" size="sm" />
        </OButton>
      </div>
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
