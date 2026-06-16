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
  <OCard class="tw:bg-transparent tw:shadow-none">
    <OCardSection role="body">
      <div class="tw:text-sm tw:font-medium text-weight-bold tw:mb-3">{{ t("search.executionSummary") }}</div>
      <div class="tw:grid tw:[grid-template-columns:repeat(auto-fit,minmax(11.25rem,1fr))] tw:gap-4">
        <div class="tw:flex tw:items-center tw:gap-3 tw:p-[0.875rem_1rem] tw:rounded-lg tw:bg-[var(--o2-card-bg)] tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:transition-[border-color,box-shadow] tw:duration-200 tw:hover:border-[var(--o2-primary-color)] tw:hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]">
          <div class="tw:shrink-0 tw:text-[var(--o2-text-secondary)]">
            <OIcon name="schedule" size="md" />
          </div>
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-[var(--o2-text-label)] tw:mb-1">{{ t("search.totalTime") }}</div>
            <div class="tw:text-xl tw:font-bold tw:text-[var(--o2-primary-color)] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ metrics.totalTime }}</div>
          </div>
        </div>

        <div class="tw:flex tw:items-center tw:gap-3 tw:p-[0.875rem_1rem] tw:rounded-lg tw:bg-[var(--o2-card-bg)] tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:transition-[border-color,box-shadow] tw:duration-200 tw:hover:border-[var(--o2-primary-color)] tw:hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]">
          <div class="tw:shrink-0 tw:text-[var(--o2-text-secondary)]">
            <OIcon name="format-list-numbered" size="md" />
          </div>
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-[var(--o2-text-label)] tw:mb-1">{{ t("search.totalRows") }}</div>
            <div class="tw:text-xl tw:font-bold tw:text-[var(--o2-primary-color)] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ metrics.totalRows }}</div>
          </div>
        </div>

        <div class="tw:flex tw:items-center tw:gap-3 tw:p-[0.875rem_1rem] tw:rounded-lg tw:bg-[var(--o2-card-bg)] tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:transition-[border-color,box-shadow] tw:duration-200 tw:hover:border-[var(--o2-primary-color)] tw:hover:shadow-[0_0.0625rem_0.1875rem_rgba(0,0,0,0.05)]">
          <div class="tw:shrink-0 tw:text-[var(--o2-text-secondary)]">
            <OIcon name="memory" size="md" />
          </div>
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-[var(--o2-text-label)] tw:mb-1">{{ t("search.peakMemory") }}</div>
            <div class="tw:text-xl tw:font-bold tw:text-[var(--o2-primary-color)] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ metrics.peakMemory }}</div>
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

