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
  <OCard data-test="metrics-summary-card" class="bg-transparent shadow-none">
    <OCardSection role="body">
      <div class="mb-3 text-sm font-bold font-medium">{{ t("search.executionSummary") }}</div>
      <div class="grid [grid-template-columns:repeat(auto-fit,minmax(11.25rem,1fr))] gap-4">
        <div
          data-test="metrics-summary-card-item"
          class="rounded-default bg-card-glass-bg border-card-glass-border hover:border-accent flex items-center gap-3 border border-solid p-[0.875rem_1rem] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]"
        >
          <div data-test="metrics-summary-card-icon" class="text-text-secondary shrink-0">
            <OIcon name="schedule" size="md" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              data-test="metrics-summary-card-label"
              class="text-text-label mb-1 text-xs font-semibold tracking-[0.04em] uppercase"
            >
              {{ t("search.totalTime") }}
            </div>
            <div
              data-test="metrics-summary-card-value"
              class="text-accent overflow-hidden text-xl font-bold text-ellipsis whitespace-nowrap"
            >
              {{ metrics.totalTime }}
            </div>
          </div>
        </div>

        <div
          data-test="metrics-summary-card-item"
          class="rounded-default bg-card-glass-bg border-card-glass-border hover:border-accent flex items-center gap-3 border border-solid p-[0.875rem_1rem] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]"
        >
          <div data-test="metrics-summary-card-icon" class="text-text-secondary shrink-0">
            <OIcon name="format-list-numbered" size="md" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              data-test="metrics-summary-card-label"
              class="text-text-label mb-1 text-xs font-semibold tracking-[0.04em] uppercase"
            >
              {{ t("search.totalRows") }}
            </div>
            <div
              data-test="metrics-summary-card-value"
              class="text-accent overflow-hidden text-xl font-bold text-ellipsis whitespace-nowrap"
            >
              {{ metrics.totalRows }}
            </div>
          </div>
        </div>

        <div
          data-test="metrics-summary-card-item"
          class="rounded-default bg-card-glass-bg border-card-glass-border hover:border-accent flex items-center gap-3 border border-solid p-[0.875rem_1rem] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]"
        >
          <div data-test="metrics-summary-card-icon" class="text-text-secondary shrink-0">
            <OIcon name="memory" size="md" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              data-test="metrics-summary-card-label"
              class="text-text-label mb-1 text-xs font-semibold tracking-[0.04em] uppercase"
            >
              {{ t("search.peakMemory") }}
            </div>
            <div
              data-test="metrics-summary-card-value"
              class="text-accent overflow-hidden text-xl font-bold text-ellipsis whitespace-nowrap"
            >
              {{ metrics.peakMemory }}
            </div>
          </div>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { SummaryMetrics } from "@/utils/queryPlanParser";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "MetricsSummaryCard",
  components: {
    OIcon,
    OCard,
    OCardSection,
  },
  props: {
    metrics: {
      type: Object as PropType<SummaryMetrics>,
      required: true,
    },
  },
  setup() {
    const { t } = useI18n();
    return { t };
  },
});
</script>
