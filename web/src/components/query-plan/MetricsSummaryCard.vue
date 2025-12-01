<!-- Copyright 2023 OpenObserve Inc.

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
  <q-card flat bordered class="metrics-summary-card">
    <q-card-section class="q-pa-md">
      <div class="text-subtitle2 text-weight-bold q-mb-md">{{ t("search.executionSummary") }}</div>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-icon">
            <q-icon name="schedule" size="24px" color="primary" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.totalTime") }}</div>
            <div class="metric-value">{{ metrics.totalTime }}</div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <q-icon name="format_list_numbered" size="24px" color="primary" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.totalRows") }}</div>
            <div class="metric-value">{{ metrics.totalRows }}</div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <q-icon name="memory" size="24px" color="primary" />
          </div>
          <div class="metric-content">
            <div class="metric-label">{{ t("search.peakMemory") }}</div>
            <div class="metric-value">{{ metrics.peakMemory }}</div>
          </div>
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import { SummaryMetrics } from "@/utils/queryPlanParser";

export default defineComponent({
  name: "MetricsSummaryCard",
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
  background: linear-gradient(135deg, rgba(var(--q-primary-rgb), 0.05) 0%, rgba(var(--q-primary-rgb), 0.02) 100%);

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
  }

  .metric-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    background-color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(var(--q-primary-rgb), 0.1);
    transition: all 0.2s ease;

    &:hover {
      background-color: rgba(255, 255, 255, 1);
      border-color: rgba(var(--q-primary-rgb), 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .metric-icon {
      flex-shrink: 0;
    }

    .metric-content {
      flex: 1;
      min-width: 0;

      .metric-label {
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 4px;
      }

      .metric-value {
        font-size: 20px;
        font-weight: 700;
        color: var(--q-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
}

// Dark theme support
.body--dark {
  .metrics-summary-card {
    background: linear-gradient(135deg, rgba(var(--q-primary-rgb), 0.15) 0%, rgba(var(--q-primary-rgb), 0.08) 100%);

    .metric-item {
      background-color: rgba(255, 255, 255, 0.05);
      border-color: rgba(var(--q-primary-rgb), 0.2);

      &:hover {
        background-color: rgba(255, 255, 255, 0.08);
        border-color: rgba(var(--q-primary-rgb), 0.4);
      }

      .metric-label {
        color: rgba(255, 255, 255, 0.7);
      }
    }
  }
}
</style>
