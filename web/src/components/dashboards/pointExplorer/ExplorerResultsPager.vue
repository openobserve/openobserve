<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The Logs and Metrics explorers' server pager: records per page, "x–y of N", first/prev/next/last.
     The list shows one loaded page; the host fetches the page it is asked for. -->
<script setup lang="ts">
import { computed } from "vue";
import TablePaginationControls from "@/components/dashboards/addPanel/TablePaginationControls.vue";

const props = defineProps<{
  /** Zero-based page shown. */
  page: number;
  pageSize: number;
  total: number;
}>();

const emit = defineEmits<{
  "update:pageSize": [size: number];
  goToPage: [page: number];
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<template>
  <div
    v-if="total > 0"
    class="bg-dialog-bg border-border-default sticky bottom-0 z-10 flex w-full items-center border-t px-3 py-2"
    data-test="explorer-results-pager"
  >
    <div class="flex-1" />
    <TablePaginationControls
      :show-pagination="true"
      :pagination="{ page: page + 1, rowsPerPage: pageSize }"
      :total-rows="total"
      :pages-number="totalPages"
      :is-first-page="page === 0"
      :is-last-page="page >= totalPages - 1"
      @update:rows-per-page="(n: number) => emit('update:pageSize', n)"
      @first-page="emit('goToPage', 0)"
      @prev-page="emit('goToPage', page - 1)"
      @next-page="emit('goToPage', page + 1)"
      @last-page="emit('goToPage', totalPages - 1)"
    />
  </div>
</template>
