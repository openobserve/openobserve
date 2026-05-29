<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { PaginationProps, PaginationEmits } from "./OPagination.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });

const $attrs = useAttrs();
// Forward consumer's `data-test` so individual buttons can be addressed via
// `${parent}-prev` / `${parent}-next` / `${parent}-page-{n}` selectors.
const parentDataTest = computed(
  () => $attrs["data-test"] as string | undefined,
);

const props = withDefaults(defineProps<PaginationProps>(), {
  disable: false,
  maxPages: 5,
});

const emit = defineEmits<PaginationEmits>();

/** Clamp a value between min and max (inclusive). */
const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

/** Visible page-number window, centred around the current page. */
const pages = computed<number[]>(() => {
  const total = props.max;
  const current = props.modelValue;
  const window = props.maxPages;

  if (total <= 0) return [];
  if (total <= window) return Array.from({ length: total }, (_, i) => i + 1);

  let start = Math.max(1, current - Math.floor(window / 2));
  let end = start + window - 1;

  if (end > total) {
    end = total;
    start = Math.max(1, end - window + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
});

const isFirst = computed(() => props.modelValue <= 1);
const isLast = computed(() => props.modelValue >= props.max);

const navigate = (page: number) => {
  if (props.disable) return;
  const clamped = clamp(page, 1, props.max);
  if (clamped !== props.modelValue) {
    emit("update:modelValue", clamped);
  }
};
</script>

<template>
  <div
    role="navigation"
    class="tw:inline-flex tw:items-center tw:gap-0.5 tw:select-none"
    aria-label="Pagination"
    v-bind="$attrs"
  >
    <!-- Previous page -->
    <button
      type="button"
      class="o-pagination__btn tw:flex tw:size-7 tw:items-center tw:justify-center tw:rounded tw:transition-colors"
      :class="[
        isFirst || disable
          ? 'tw:text-pagination-nav-disabled-text tw:cursor-not-allowed tw:opacity-50'
          : 'tw:text-pagination-nav-text tw:hover:bg-pagination-nav-hover-bg tw:cursor-pointer',
      ]"
      :disabled="isFirst || disable"
      aria-label="Previous page"
      :data-test="parentDataTest ? `${parentDataTest}-prev` : undefined"
      @click="navigate(modelValue - 1)"
    >
      <OIcon name="fast-rewind" size="sm" />
    </button>

    <!-- Page number buttons -->
    <button
      v-for="page in pages"
      :key="page"
      type="button"
      class="o-pagination__btn tw:flex tw:size-7 tw:items-center tw:justify-center tw:rounded tw:text-sm tw:font-medium tw:transition-colors"
      :class="[
        page === modelValue
          ? 'tw:bg-pagination-item-active-bg tw:text-pagination-item-active-text tw:cursor-default'
          : disable
            ? 'tw:text-pagination-item-disabled-text tw:cursor-not-allowed tw:opacity-50'
            : 'tw:text-pagination-item-text tw:hover:bg-pagination-item-hover-bg tw:cursor-pointer',
      ]"
      :disabled="disable && page !== modelValue"
      :aria-label="`Page ${page}`"
      :aria-current="page === modelValue ? 'page' : undefined"
      :data-test="parentDataTest ? `${parentDataTest}-page-${page}` : undefined"
      :data-test-value="page"
      :data-test-active="page === modelValue ? 'true' : 'false'"
      @click="navigate(page)"
    >
      {{ page }}
    </button>

    <!-- Next page -->
    <button
      type="button"
      class="o-pagination__btn tw:flex tw:size-7 tw:items-center tw:justify-center tw:rounded tw:transition-colors"
      :class="[
        isLast || disable
          ? 'tw:text-pagination-nav-disabled-text tw:cursor-not-allowed tw:opacity-50'
          : 'tw:text-pagination-nav-text tw:hover:bg-pagination-nav-hover-bg tw:cursor-pointer',
      ]"
      :disabled="isLast || disable"
      aria-label="Next page"
      :data-test="parentDataTest ? `${parentDataTest}-next` : undefined"
      @click="navigate(modelValue + 1)"
    >
      <OIcon name="fast-forward" size="sm" />
    </button>

  </div>
</template>
