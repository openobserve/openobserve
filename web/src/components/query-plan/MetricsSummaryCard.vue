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
  <OCard class="metrics-summary-card">
    <OCardSection role="body">
      <div class="tw:text-sm tw:font-medium text-weight-bold tw:mb-3">{{ t("search.executionSummary") }}</div>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-icon">
            <OIcon name="schedule" size="md" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.totalTime") }}</div>
            <div class="metric-value">{{ metrics.totalTime }}</div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <OIcon name="format-list-numbered" size="md" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.totalRows") }}</div>
            <div class="metric-value">{{ metrics.totalRows }}</div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <OIcon name="memory" size="md" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.peakMemory") }}</div>
            <div class="metric-value">{{ metrics.peakMemory }}</div>
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

<style lang="scss" scoped>
.metrics-summary-card {
  background-color: transparent;
  box-shadow: none;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11.25rem, 1fr));
  gap: 1rem;
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 0.5rem;
  background-color: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    border-color: var(--o2-primary-color);
    box-shadow: 0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.05);
  }
}

.metric-icon {
  flex-shrink: 0;
  color: var(--o2-text-secondary);
}

.metric-content {
  flex: 1;
  min-width: 0;
}

.metric-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--o2-text-label);
  margin-bottom: 0.25rem;
}

.metric-value {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--o2-primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
