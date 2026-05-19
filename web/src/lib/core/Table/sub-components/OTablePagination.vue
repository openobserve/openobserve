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
    class="tw:flex tw:items-center tw:justify-between tw:py-1.5 tw:px-3 tw:border-t tw:border-border-default tw:min-h-[2.5rem]"
  >
    <!-- Left: bulk actions slot or row count -->
    <div class="tw:flex tw:items-center tw:gap-2">
      <slot name="actions" />
      <span v-if="!slots.actions" class="tw:text-text-primary tw:text-xs" style="font-weight: 700;">
        {{ totalCount.toLocaleString() }} {{ title }}
      </span>
    </div>

    <!-- Right: controls -->
    <div class="tw:flex tw:items-center tw:gap-3">
      <span class="tw:text-text-primary tw:text-xs">
        {{ t("search.showing") }} {{ showingFrom }} - {{ showingTo }} {{ t("search.of") }} {{ totalCount.toLocaleString() }}
      </span>
      <div class="tw:w-px tw:h-4 tw:bg-border-default tw:shrink-0" v-if="pageSizeOptions.length > 0" />
      <div v-if="pageSizeOptions.length > 0" class="tw:flex tw:items-center tw:gap-1.5 tw:text-text-primary tw:text-xs">
        <span class="tw:whitespace-nowrap">{{ t("search.recordsPerPage") }}</span>
        <OSelect
          v-model="pageSizeModel"
          :options="pageSizeSelectOptions"
          :searchable="false"
          size="sm"
          data-test="o2-table-page-size-select"
        />
      </div>

      <div class="tw:flex tw:items-center tw:gap-1">
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
      </div>
    </div>
  </div>
</template>
