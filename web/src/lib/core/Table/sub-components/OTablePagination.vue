<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useSlots } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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

function onPageSizeChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  emit("update:pageSize", Number(target.value));
}
</script>

<template>
  <div
    :data-test="`o2-table-pagination-${position}`"
    class="tw:flex tw:items-center tw:justify-between tw:py-1.5 tw:px-3 tw:border-t tw:border-border-default tw:min-h-[2.5rem]"
  >
    <!-- Left: bulk actions slot or row count -->
    <div class="tw:flex tw:items-center tw:gap-2">
      <slot name="actions" />
      <span v-if="!slots.actions" class="tw:text-text-secondary tw:text-xs">
        {{ showingFrom }}-{{ showingTo }} of {{ totalCount.toLocaleString() }}
      </span>
    </div>

    <!-- Right: controls -->
    <div class="tw:flex tw:items-center tw:gap-3">
      <div class="tw:flex tw:items-center tw:gap-1.5 tw:text-text-secondary tw:text-xs">
        <span>{{ t("search.recordsPerPage") }}</span>
        <select
          :value="pageSize"
          class="tw:bg-transparent tw:border tw:border-border-default tw:rounded tw:px-1.5 tw:py-0.5 tw:text-xs tw:text-text-primary tw:cursor-pointer tw:hover:border-border-strong"
          data-test="o2-table-page-size-select"
          @change="onPageSizeChange"
        >
          <option
            v-for="opt in pageSizeOptions"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>

      <div class="tw:flex tw:items-center tw:gap-1">
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          :disabled="isFirstPage"
          data-test="o2-table-prev-page-btn"
          @click="emit('prev-page')"
        >
          <OIcon name="chevron_left" size="1.1rem" />
        </OButton>
        <span class="tw:text-xs tw:text-text-secondary tw:min-w-[3rem] tw:text-center">
          {{ currentPage }} / {{ totalPages }}
        </span>
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          :disabled="isLastPage"
          data-test="o2-table-next-page-btn"
          @click="emit('next-page')"
        >
          <OIcon name="chevron_right" size="1.1rem" />
        </OButton>
      </div>
    </div>
  </div>
</template>
