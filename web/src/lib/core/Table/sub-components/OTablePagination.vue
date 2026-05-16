<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";

const { t } = useI18n();

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
    :class="[
      'tw:flex tw:items-center tw:gap-3',
      position === 'bottom'
        ? 'tw:justify-between tw:py-2 tw:px-2 tw:border-t tw:border-border-default'
        : 'tw:justify-between tw:py-1 tw:px-2',
    ]"
  >
    <!-- Left: row count / title -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:text-text-secondary tw:text-sm">
      <span v-if="title" class="tw:font-semibold tw:text-text-primary">
        {{ totalCount }} {{ title }}
      </span>
      <span v-else data-test="o2-table-pagination-info">
        {{ t("search.showing") }}
        {{ showingFrom }}-{{ showingTo }}
        {{ t("search.of") }}
        {{ totalCount }}
      </span>
    </div>

    <!-- Right: controls -->
    <div class="tw:flex tw:items-center tw:gap-3">
      <!-- Records per page -->
      <div class="tw:flex tw:items-center tw:gap-1 tw:text-text-secondary tw:text-sm">
        <span>{{ t("search.recordsPerPage") }}</span>
        <select
          :value="pageSize"
          class="tw:bg-transparent tw:border tw:border-border-default tw:rounded tw:px-1 tw:py-0.5 tw:text-sm tw:text-text-primary tw:cursor-pointer"
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

      <!-- Page navigation -->
      <OButtonGroup>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="isFirstPage"
          data-test="o2-table-first-page-btn"
          @click="emit('first-page')"
        >
          <template #icon-left>
            <q-icon name="first_page" />
          </template>
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="isFirstPage"
          data-test="o2-table-prev-page-btn"
          @click="emit('prev-page')"
        >
          <template #icon-left>
            <q-icon name="chevron_left" />
          </template>
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="isLastPage"
          data-test="o2-table-next-page-btn"
          @click="emit('next-page')"
        >
          <template #icon-left>
            <q-icon name="chevron_right" />
          </template>
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          :disabled="isLastPage"
          data-test="o2-table-last-page-btn"
          @click="emit('last-page')"
        >
          <template #icon-left>
            <q-icon name="last_page" />
          </template>
        </OButton>
      </OButtonGroup>
    </div>
  </div>
</template>
