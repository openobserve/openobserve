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

const pageSizeSelectOptions = computed(() =>
  props.pageSizeOptions.map((n) => ({ label: String(n), value: n }))
);
</script>

<template>
  <div
    :data-test="`o2-table-pagination-${position}`"
    class="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 py-1 px-3 border-t border-border-default min-h-10"
  >
    <!-- Left: bulk actions slot or row count.
         The footer-title typography lives on this wrapper so BOTH the default
         row count and any custom #bottom (actions) slot content inherit it —
         consumers don't need to remember to add `o2-table-footer-title`. -->
    <div class="flex items-center gap-2 o2-table-footer-title">
      <!-- Loading: always skeleton, regardless of slot/count -->
      <span
        v-if="loading"
        class="o2-pag-skel inline-block h-3 w-24 rounded-md [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)] [background-size:200%_100%] [animation:o2-pag-shimmer_1.5s_ease-in-out_infinite]"
        aria-hidden="true"
        data-test="o2-table-pagination-count-skel"
      />
      <slot v-else-if="slots.actions" name="actions" />
      <span v-else>
        {{ totalCount.toLocaleString() }} {{ title }}
      </span>
    </div>

    <!-- Right: controls -->
    <div class="flex items-center gap-3">
      <span
        v-if="loading"
        class="o2-pag-skel inline-block h-3 w-36 rounded-md [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)] [background-size:200%_100%] [animation:o2-pag-shimmer_1.5s_ease-in-out_infinite]"
        aria-hidden="true"
        data-test="o2-table-pagination-info-skel"
      />
      <span
        v-else
        class="text-primary text-xs whitespace-nowrap"
        data-test="o2-table-pagination-info"
      >
        {{ t("search.showing") }} {{ showingFrom }} - {{ showingTo }} {{ t("search.of") }} {{ totalCount.toLocaleString() }}
      </span>
      <div class="w-px h-4 bg-border-default shrink-0" v-if="pageSizeOptions.length > 0" />
      <div v-if="pageSizeOptions.length > 0" class="flex items-center gap-1.5 text-primary text-xs">
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

<style>
@keyframes o2-pag-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .o2-pag-skel { animation: none; }
}
</style>
