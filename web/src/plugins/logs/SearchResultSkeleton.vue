<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    ref="rootRef"
    class="flex h-full max-h-full flex-col overflow-hidden"
    aria-busy="true"
    data-test="logs-search-result-loading-skeleton"
  >
    <div
      class="border-card-glass-border bg-card-glass-bg flex h-9 shrink-0 items-center border-b max-md:h-auto max-md:min-h-9 max-md:flex-wrap max-md:gap-y-1 max-md:py-0.5"
      inert
    >
      <OButton variant="outline" size="icon-xs-sq" class="ms-1.5 shrink-0">
        <OIcon :name="collapseIcon" size="sm" />
      </OButton>
      <div class="min-w-0 flex-1 ps-2 max-md:min-w-32" />
      <div class="flex flex-none items-center justify-end gap-1 pe-2 max-md:ms-auto">
        <OButton v-if="narrow" variant="outline" size="icon-chip">
          <OIcon name="more-horiz" size="sm" />
        </OButton>
        <template v-else>
          <div
            class="border-card-glass-border rounded-default inline-flex h-6 items-center overflow-hidden border px-1"
          >
            <ORefreshButton
              :last-run-at="searchObj.meta.lastRunAt"
              :loading="searchObj.loading || searchObj.loadingHistogram"
              :disabled="searchObj.loading || searchObj.loadingHistogram"
            />
          </div>
          <div v-if="logsTab" class="inline-flex items-center gap-0.5">
            <OButton variant="outline" size="icon-chip" :active="!!searchObj.meta.toggleSourceWrap">
              <OIcon name="wrap-text" size="sm" />
            </OButton>
          </div>
        </template>
        <template v-if="searchObj.meta.resultGrid?.showPagination && logsTab">
          <span>
            <OSelect
              :model-value="searchObj.meta.resultGrid.rowsPerPage"
              :options="ROWS_PER_PAGE"
              class="select-pagination min-w-[4.5rem]"
              size="sm"
              :searchable="false"
              :disabled="searchObj.loading"
            />
          </span>
          <span>
            <OPagination
              :disable="searchObj.loading"
              :model-value="1"
              :max="1"
              :max-pages="narrow ? 3 : 5"
              class="paginator-section"
            />
          </span>
        </template>
      </div>
    </div>
    <div class="relative">
      <LoadingProgress
        :loading="searchObj.loading"
        :loading-progress-percentage="searchObj.loadingProgressPercentage || 0"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <div v-if="showHistogram" class="h-25 pt-1" data-test="logs-search-result-loading-histogram">
        <LogsHistogramSkeleton />
      </div>
      <LogsTableSkeleton v-if="logsTab" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import LogsHistogramSkeleton from "@/plugins/logs/LogsHistogramSkeleton.vue";
import LogsTableSkeleton from "@/plugins/logs/LogsTableSkeleton.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { searchState } from "@/composables/useLogs/searchState";

const ROWS_PER_PAGE = [10, 25, 50, 100];
// The container width below which SearchResult moves its actions into a menu.
const NARROW_WIDTH = 700;

const { searchObj } = searchState();
const { isMobile } = useBreakpoint();

const rootRef = ref<HTMLElement | null>(null);
const width = ref(Number.POSITIVE_INFINITY);
let observer: ResizeObserver | null = null;

const narrow = computed(() => width.value < NARROW_WIDTH);

const logsTab = computed(() => searchObj.meta.logsVisualizeToggle === "logs");

const collapseIcon = computed(() => {
  if (isMobile.value) return "menu";
  return searchObj.meta.showFields ? "keyboard-double-arrow-left" : "keyboard-double-arrow-right";
});

const showHistogram = computed(
  () => !!searchObj.meta.showHistogram && searchObj.meta.logsVisualizeToggle !== "patterns",
);

onMounted(() => {
  if (!rootRef.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width;
  });
  observer.observe(rootRef.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
/* keep(lib-override:opagination): sizes the OPagination/OSelect-rendered buttons, which expose no class hook */
.paginator-section {
  line-height: 1.5rem;
  max-height: 2rem;
  border-radius: 0.5rem;
  padding: 0.125rem 0.25rem;
  background: color-mix(in srgb, var(--color-white) 10%, transparent);
  backdrop-filter: blur(0.625rem);
  margin-top: 0;
  overflow: visible;
}

.paginator-section :deep(.o-pagination__btn) {
  padding: 0.125rem 0.25rem !important;
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  min-width: 1.5rem !important;
  font-size: var(--text-xs) !important;
  border-radius: 0.25rem !important;
  line-height: 1rem !important;
}

.paginator-section :deep(.o-pagination__btn) svg {
  width: 1rem !important;
  height: 1rem !important;
}

.select-pagination {
  position: relative;
  width: 4rem !important;
  height: 1.5rem !important;
  margin-top: 0;
}

.select-pagination :deep(button) {
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  font-size: var(--text-xs) !important;
  padding-inline: 0.5rem !important;
}
</style>
