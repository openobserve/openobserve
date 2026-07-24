<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useSlots, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const { t } = useI18n();
const slots = useSlots();

const props = withDefaults(
  defineProps<{
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    pageSizeOptions: number[];
    showingFrom: number;
    showingTo: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    position?: "top" | "bottom";
    title?: string;
    /** When true, replace count + range text with skeleton bars */
    loading?: boolean;
  }>(),
  {
    position: "bottom",
    title: "",
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
  // Surface the active page size when it isn't one of the presets (e.g. a
  // caller-configured size), inserted in ascending position, so the select
  // shows it instead of rendering blank.
  if (props.pageSize != null && props.pageSize > 0 && !opts.includes(props.pageSize)) {
    const idx = opts.findIndex((o) => o > (props.pageSize as number));
    if (idx === -1) opts.push(props.pageSize);
    else opts.splice(idx, 0, props.pageSize);
  }
  return opts.map((n) => ({ label: String(n), value: n }));
});
</script>

<template>
  <div
    :data-test="`o2-table-pagination-${position}`"
    class="border-border-default flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-1"
  >
    <!-- Left: bulk actions slot or row count.
         The footer-title typography lives on this wrapper so BOTH the default
         row count and any custom #bottom (actions) slot content inherit it —
         font-size / weight / line-height are inherited properties. -->
    <div
      class="flex items-center gap-2 text-xs font-normal"
      data-test="o2-table-pagination-actions"
    >
      <!-- Loading: always skeleton, regardless of slot/count -->
      <span
        v-if="loading"
        class="o2-pag-skel rounded-default inline-block h-3 w-24 [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]"
        aria-hidden="true"
        data-test="o2-table-pagination-count-skel"
      />
      <slot v-else-if="slots.actions" name="actions" />
      <span v-else> {{ totalCount.toLocaleString() }} {{ title }} </span>
    </div>

    <!-- Right: controls -->
    <div class="flex items-center gap-3">
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
        {{ totalCount.toLocaleString() }}
      </span>
      <div class="bg-border-default h-4 w-px shrink-0" v-if="pageSizeOptions.length > 0" />
      <div v-if="pageSizeOptions.length > 0" class="text-primary flex items-center gap-1.5 text-xs">
        <span class="whitespace-nowrap">{{ t("search.recordsPerPage") }}</span>
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
