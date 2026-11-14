<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import {
  PAGINATION_FIRST_LAST_MIN_PAGES,
  type PaginationEmits,
  type PaginationProps,
  type PaginationSlots,
} from "./OPagination.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { activates } from "@/lib/core/Button/activation";
import { useInactiveMenus } from "./useInactiveMenus";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<PaginationProps>(), {
  pageSize: 20,
  totalExact: true,
  pageSizes: () => [],
  loading: false,
});

const emit = defineEmits<PaginationEmits>();
defineSlots<PaginationSlots>();

// Parts are addressable as `<root data-test>-prev` etc. unless the caller names them.
const attrs = useAttrs();
const ids = computed(() => {
  const root = attrs["data-test"] as string | undefined;
  const part = (name: string) => (root ? `${root}-${name}` : undefined);
  return {
    range: props.testIds?.range ?? part("range"),
    size: props.testIds?.size ?? part("size"),
    first: props.testIds?.first ?? part("first"),
    prev: props.testIds?.prev ?? part("prev"),
    next: props.testIds?.next ?? part("next"),
    last: props.testIds?.last ?? part("last"),
  };
});

const pages = computed(() => {
  if (props.pageCount != null) return Math.max(props.pageCount, 1);
  if (props.total == null || props.pageSize <= 0) return 1;
  return Math.max(Math.ceil(props.total / props.pageSize), 1);
});

const isFirst = computed(() => props.page <= 1);
const isLast = computed(() => props.page >= pages.value);
const showEnds = computed(() => pages.value > PAGINATION_FIRST_LAST_MIN_PAGES);

const rangeText = computed(() => {
  if (props.total == null) {
    return t("components.pagination.pageOf", { page: props.page, pages: pages.value });
  }
  const from = props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const to = Math.min(props.page * props.pageSize, props.total);
  if (!props.totalExact) {
    return t("components.pagination.rangeOfMany", {
      from: from.toLocaleString(),
      to: to.toLocaleString(),
    });
  }
  return t("components.pagination.range", {
    from: from.toLocaleString(),
    to: to.toLocaleString(),
    total: props.total.toLocaleString(),
  });
});

const busyReason = computed(() => props.disabledReason ?? t("common.loading"));

function go(page: number): void {
  if (props.loading) return;
  const target = Math.min(Math.max(page, 1), pages.value);
  if (target !== props.page) emit("update:page", target);
}

const sizeOptions = computed(() => {
  const sizes = [...props.pageSizes];
  // A configured size outside the choices is listed too, so the select never renders blank.
  if (props.pageSize > 0 && sizes.length && !sizes.includes(props.pageSize)) {
    const at = sizes.findIndex((size) => size > props.pageSize);
    if (at === -1) sizes.push(props.pageSize);
    else sizes.splice(at, 0, props.pageSize);
  }
  return sizes.map((size) => ({
    label: t("components.pagination.perPage", { size }),
    value: size,
  }));
});

const sizeModel = computed({
  get: () => props.pageSize,
  set: (size: number) => {
    if (!props.loading) emit("update:pageSize", size);
  },
});

// The select owns its trigger, so while busy its wrapper swallows activation instead.
function swallowWhileBusy(event: Event): void {
  if (!props.loading || !activates(event)) return;
  event.preventDefault();
  event.stopPropagation();
}

// The select's menu is portaled outside the wrapper, so going busy closes an open one.
const sizeRef = ref<HTMLElement | null>(null);
useInactiveMenus(
  () => sizeRef.value,
  () => props.loading,
);
</script>

<template>
  <nav
    class="flex min-w-0 items-center gap-2"
    :aria-label="t('components.pagination.pagination')"
    :data-test-page="page"
    :data-test-page-count="pages"
  >
    <!-- Callers may empty the range slot, so the page state is exposed for e2e on the root. -->
    <slot name="range" :text="rangeText">
      <span
        class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
        :data-test="ids.range"
        >{{ rangeText }}</span
      >
    </slot>
    <div
      v-if="sizeOptions.length"
      ref="sizeRef"
      :class="['flex items-center', loading ? 'cursor-not-allowed' : '']"
      :data-test="ids.size ? `${ids.size}-group` : undefined"
      :aria-disabled="loading ? 'true' : undefined"
      @pointerdown.capture="swallowWhileBusy"
      @mousedown.capture="swallowWhileBusy"
      @click.capture="swallowWhileBusy"
      @keydown.capture="swallowWhileBusy"
    >
      <OSelect
        v-model="sizeModel"
        :options="sizeOptions"
        :searchable="false"
        size="sm"
        class="w-30"
        :aria-label="t('components.pagination.pageSize')"
        :data-test="ids.size"
      />
    </div>
    <div class="flex items-center gap-1">
      <OButton
        v-if="showEnds"
        variant="secondary"
        size="sm"
        icon-only
        icon="first-page"
        :label="t('search.firstPage')"
        :disabled="isFirst || loading"
        :disabled-reason="isFirst ? t('components.pagination.onFirstPage') : busyReason"
        :data-test="ids.first"
        @click="go(1)"
      />
      <OButton
        variant="secondary"
        size="sm"
        icon-only
        icon="chevron-left"
        :label="t('components.pagination.previousPage')"
        :disabled="isFirst || loading"
        :disabled-reason="isFirst ? t('components.pagination.onFirstPage') : busyReason"
        :data-test="ids.prev"
        @click="go(page - 1)"
      />
      <OButton
        variant="secondary"
        size="sm"
        icon-only
        icon="chevron-right"
        :label="t('components.pagination.nextPage')"
        :disabled="isLast || loading"
        :disabled-reason="isLast ? t('components.pagination.onLastPage') : busyReason"
        :data-test="ids.next"
        @click="go(page + 1)"
      />
      <OButton
        v-if="showEnds && totalExact"
        variant="secondary"
        size="sm"
        icon-only
        icon="last-page"
        :label="t('search.lastPage')"
        :disabled="isLast || loading"
        :disabled-reason="isLast ? t('components.pagination.onLastPage') : busyReason"
        :data-test="ids.last"
        @click="go(pages)"
      />
    </div>
  </nav>
</template>
