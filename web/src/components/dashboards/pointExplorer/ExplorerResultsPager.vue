<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The Logs and Metrics explorers' server pager: records per page, "x–y of N", first/prev/next/last.
     The list shows one loaded page; the host fetches the page it is asked for. While the total is
     not known it shows "x–y of …" (count pending) or just "x–y" (no count), never a guessed total. -->
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";

const props = defineProps<{
  /** Zero-based page shown. */
  page: number;
  pageSize: number;
  /** Matches of the query; null while not known. */
  total: number | null;
  /** Rows on the page shown. */
  rows: number;
  /** The total is still being counted. */
  counting?: boolean;
}>();

const emit = defineEmits<{
  "update:pageSize": [size: number];
  goToPage: [page: number];
}>();

const { t } = useI18nTyped();

const known = computed(() => props.total !== null);
const totalPages = computed(() =>
  props.total !== null
    ? Math.max(1, Math.ceil(props.total / props.pageSize))
    : // Unknown: a full page may have a next one.
      props.page + (props.rows >= props.pageSize ? 2 : 1),
);
const shown = computed(() =>
  known.value ? (props.total ?? 0) > 0 : props.rows > 0 || props.page > 0,
);
const countText = computed(() => {
  if (known.value) return "";
  // A page past an exactly full last page has no range to name.
  if (!props.rows) return t("panel.logExplorer.pagerEmptyPage");
  const start = props.page * props.pageSize + 1;
  const end = props.page * props.pageSize + props.rows;
  return props.counting
    ? t("panel.logExplorer.pagerCounting", { start, end })
    : t("panel.logExplorer.pagerRange", { start, end });
});
</script>

<template>
  <div
    v-if="shown"
    class="bg-dialog-bg border-border-default sticky bottom-0 z-10 flex w-full items-center border-t px-3 py-2"
    data-test="explorer-results-pager"
  >
    <div class="flex-1" />
    <TablePaginationControls
      :show-pagination="true"
      :pagination="{ page: page + 1, rowsPerPage: pageSize }"
      :total-rows="total ?? rows"
      :pages-number="totalPages"
      :is-first-page="page === 0"
      :is-last-page="page >= totalPages - 1"
      :count-text="countText"
      @update:rows-per-page="(n: number) => emit('update:pageSize', n)"
      @first-page="emit('goToPage', 0)"
      @prev-page="emit('goToPage', page - 1)"
      @next-page="emit('goToPage', page + 1)"
      @last-page="emit('goToPage', totalPages - 1)"
    />
  </div>
</template>
