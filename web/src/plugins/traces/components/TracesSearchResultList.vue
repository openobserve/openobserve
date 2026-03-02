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
  <div class="traces-search-result-list tw:h-full tw:flex tw:flex-col">
    <!-- ════════════════════ Empty State ════════════════════ -->
    <div
      v-if="noResults"
      class="text-center tw:mx-[10%] tw:my-[2.5rem] tw:text-[1.25rem]"
    >
      <q-icon name="info" color="primary" size="md" />
      {{ t("traces.noTracesFoundAdjust") }}
    </div>

    <!-- ════════════════════ Traces List Section ════════════════════ -->
    <div
      v-else
      v-show="hasResults || loading"
      data-test="traces-table-wrapper"
      class="column tw:h-full tw:flex-1 tw:min-h-0"
    >
      <!-- Section header: title + count badge + pagination -->
      <div
        v-if="showHeader"
        data-test="traces-section-header"
        class="row items-center q-px-sm q-py-xs tw:shrink-0 tw:min-h-[2.5rem] tw:border-t tw:border-[rgba(0,0,0,0.07)] tw:bg-[var(--o2-section-header-bg)]!"
      >
        <span
          data-test="traces-section-title"
          class="tw:text-[0.75rem] tw:font-bold tw:tracking-[0.0625rem]! tw:text-[var(--o2-text-1)]! tw:mr-[0.85rem]"
        >
          {{ t("traces.tracesTitle") }}
        </span>
        <q-badge
          data-test="traces-count-badge"
          rounded
          :label="`${props.total != null ? props.total : hits.length} ${t('traces.tracesFound')}`"
          class="text-caption tw:bg-[var(--o2-tag-grey-1)]! tw:px-[0.625rem]! tw:text-[0.75rem] tw:text-[var(--o2-text-2)]! tw:mr-[0.85rem]"
        />
        <div
          v-if="props.errorCount != null"
          data-test="traces-error-count-badge"
          class="tw:rounded-xl tw:py-[0.125rem] tw:px-[0.625rem] tw:inline-flex tw:items-center tw:w-fit tw:mr-[0.85rem]"
          style="
            background: rgba(244, 67, 54, 0.12);
            color: var(--q-negative, #c62828);
          "
        >
          <span class="tw:text-[0.75rem] tw:tracking-[0.03em] tw:font-bold">
            {{ props.errorCount }} {{ t("traces.errorsFound") }}
          </span>
        </div>

        <q-space />

        <!-- Pagination -->
        <template v-if="showPagination">
          <q-select
            :model-value="rowsPerPage"
            :options="rowsPerPageOptions"
            class="select-pagination tw:mr-[0.25rem]"
            size="sm"
            dense
            borderless
            data-test="traces-search-result-records-per-page"
            @update:model-value="emit('rows-per-page-change', $event)"
          />
          <q-pagination
            :disable="loading"
            :model-value="currentPage"
            :max="totalPages"
            :input="false"
            direction-links
            :boundary-numbers="false"
            :max-pages="5"
            :ellipses="false"
            icon-first="skip_previous"
            icon-last="skip_next"
            icon-prev="fast_rewind"
            icon-next="fast_forward"
            class="float-right paginator-section"
            data-test="traces-search-result-pagination"
            @update:model-value="emit('page-change', $event)"
          />
        </template>
      </div>

      <!-- Table scroll area -->
      <div
        data-test="traces-search-result-list"
        class="tw:w-full tw:flex-1 tw:overflow-y-auto tw:overflow-x-auto tw:relative"
      >
        <TracesTable
          :columns="tracesColumns"
          :rows="hits"
          :loading="loading"
          :row-class="traceRowClass"
          @row-click="(row: any) => emit('row-click', row)"
        >
          <!-- Loading banner: shown above rows while a new page is fetching -->
          <template #loading-banner>
            <div
              data-test="traces-table-loading-row"
              class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
            >
              <q-spinner-hourglass
                color="primary"
                size="1.25rem"
                class="tw:mx-[0.25rem]"
              />
              <span
                class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
                >{{ t("traces.fetchingTraces") }}</span
              >
            </div>
          </template>

          <!-- Loading row: shown when no rows exist yet (first fetch) -->
          <template #loading>
            <div
              data-test="traces-table-loading-row"
              class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
            >
              <q-spinner-hourglass
                color="primary"
                size="1.25rem"
                class="tw:mr-[0.25rem]"
              />
              <span
                class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
                >{{ t("traces.fetchingTraces") }}</span
              >
            </div>
          </template>

          <template #cell-timestamp="{ item }">
            <TraceTimestampCell :item="item" />
          </template>

          <template #cell-service_operation="{ item }">
            <TraceServiceCell :item="item" />
          </template>

          <template #cell-duration="{ item }">
            <span class="text-caption" data-test="trace-row-duration">
              {{ formatTimeWithSuffix(item.duration) || "0us" }}
            </span>
          </template>

          <template #cell-spans="{ item }">
            <q-badge
              data-test="trace-row-spans-badge"
              :label="item.spans"
              class="tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.325rem]!"
            />
          </template>

          <template #cell-status="{ item }">
            <TraceStatusCell :item="item" />
          </template>

          <template #cell-input_tokens="{ item }">
            <span class="text-caption" data-test="trace-row-input-tokens">
              {{
                isLLMTrace(item)
                  ? formatTokens(extractLLMData(item)?.usage?.input ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-output_tokens="{ item }">
            <span class="text-caption" data-test="trace-row-output-tokens">
              {{
                isLLMTrace(item)
                  ? formatTokens(extractLLMData(item)?.usage?.output ?? 0)
                  : "-"
              }}
            </span>
          </template>

          <template #cell-cost="{ item }">
            <span class="text-caption" data-test="trace-row-cost">
              {{
                isLLMTrace(item)
                  ? `$${formatCost(extractLLMData(item)?.cost?.total ?? 0)}`
                  : "-"
              }}
            </span>
          </template>

          <template #cell-service_latency="{ item }">
            <TraceLatencyCell :item="item" />
          </template>

          <template #empty />
        </TracesTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import TracesTable from "@/components/traces/TracesTable.vue";
import { useTracesTableColumns } from "../composables/useTracesTableColumns";
import TraceTimestampCell from "./TraceTimestampCell.vue";
import TraceServiceCell from "./TraceServiceCell.vue";
import TraceLatencyCell from "./TraceLatencyCell.vue";
import TraceStatusCell from "./TraceStatusCell.vue";
import {
  isLLMTrace,
  extractLLMData,
  formatCost,
  formatTokens,
} from "../../../utils/llmUtils";
import { formatTimeWithSuffix } from "../../../utils/zincutils";

interface Props {
  hits: any[];
  loading: boolean;
  /** Whether a search has been executed. Controls idle vs empty state. Default: true */
  searchPerformed?: boolean;
  /** Show the "TRACES X Traces Found" section header. Default: true */
  showHeader?: boolean;
  /** Server-side total record count (distinct trace_ids from count query). */
  total?: number;
  /** Current page number (1-indexed). */
  currentPage?: number;
  /** Rows displayed per page. */
  rowsPerPage?: number;
  /** Whether to show the pagination controls. */
  showPagination?: boolean;
  /** Error trace count from the count query. */
  errorCount?: number;
}

const { t } = useI18n();

const props = withDefaults(defineProps<Props>(), {
  searchPerformed: true,
  showHeader: true,
  total: undefined,
  currentPage: 1,
  rowsPerPage: 25,
  showPagination: false,
  errorCount: undefined,
});

const emit = defineEmits<{
  "row-click": [row: any];
  "page-change": [page: number];
  "rows-per-page-change": [rowsPerPage: number];
}>();

const rowsPerPageOptions = [10, 25, 50, 100];

const hasLlmTraces = computed(() =>
  props.hits.some((hit: any) => isLLMTrace(hit)),
);

const tracesColumns = useTracesTableColumns(hasLlmTraces);

const traceRowClass = (row: any) =>
  (row.errors ?? 0) > 0 ? "oz-table__row--error" : "";

const noResults = computed(
  () => props.searchPerformed && !props.loading && props.hits.length === 0,
);

const hasResults = computed(
  () => props.searchPerformed && props.hits.length > 0,
);

const totalPages = computed(() =>
  props.total && props.rowsPerPage
    ? Math.max(1, Math.ceil(props.total / props.rowsPerPage))
    : 1,
);
</script>

<style lang="scss" scoped>
@import "@/styles/pagination.scss";
</style>
