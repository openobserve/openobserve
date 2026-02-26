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
    <!-- ════════════════════ Loading State ════════════════════ -->
    <div
      v-if="loading"
      class="full-height flex justify-center items-center tw:pt-[4rem]"
    >
      <div class="q-pb-lg">
        <q-spinner-hourglass
          color="primary"
          size="40px"
          style="margin: 0 auto; display: block"
        />
        <span class="text-center">
          {{ t('traces.fetchingTraces') }}
        </span>
      </div>
    </div>

    <!-- ════════════════════ Empty State ════════════════════ -->
    <div
      v-else-if="noResults"
      class="text-center tw:mx-[10%] tw:my-[40px] tw:text-[20px]"
    >
      <q-icon name="info" color="primary" size="md" /> {{ t('traces.noTracesFoundAdjust') }}
    </div>

    <!-- ════════════════════ Traces List Section ════════════════════ -->
    <div
      v-else
      v-show="hasResults"
      data-test="traces-table-wrapper"
      class="traces-section column tw:h-full"
    >
      <!-- Section header: title + count badge -->
      <div
        v-if="showHeader"
        data-test="traces-section-header"
        class="traces-section-header row items-center q-px-sm q-py-xs tw:bg-[var(--o2-section-header-bg)]!"
      >
        <span
          data-test="traces-section-title"
          class="tw:text-[0.75rem] tw:font-bold tw:tracking-[0.0625rem]! tw:text-[var(--o2-text-1)]! tw:mr-[0.85rem]"
        >
          {{ t('traces.tracesTitle') }}
        </span>
        <q-badge
          data-test="traces-count-badge"
          rounded
          :label="`${hits.length} ${t('traces.tracesFound')}`"
          class="text-caption tw:bg-[var(--o2-tag-grey-1)]! tw:px-[0.625rem]! tw:text-[0.75rem] tw:text-[var(--o2-text-2)]! tw:mr-[0.85rem]"
        />
      </div>

      <!-- Table scroll area -->
      <div
        data-test="traces-search-result-list"
        class="traces-table-scroll-area tw:w-full"
      >
        <TracesTable
          :columns="tracesColumns"
          :rows="hits"
          :row-class="traceRowClass"
          @row-click="(row: any) => emit('row-click', row)"
          @load-more="emit('load-more')"
        >
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
import { computed, ref } from "vue";
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
}

const { t } = useI18n();

const props = withDefaults(defineProps<Props>(), {
  searchPerformed: true,
  showHeader: true,
});

const emit = defineEmits<{
  "row-click": [row: any];
  "load-more": [];
}>();

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
</script>

<style lang="scss" scoped>
.traces-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.traces-section-header {
  flex-shrink: 0;
  min-height: 40px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  padding: 4px 8px;
}

.traces-table-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}
</style>
