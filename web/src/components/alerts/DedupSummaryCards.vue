<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div data-test="dedup-summary-cards" class="dedup-summary-cards grid grid-cols-4 gap-4 mb-4">
    <!-- Card 1: Total Alerts -->
    <OCard data-test="total-alerts-card" class="border border-border-default transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
      <OCardSection class="p-4">
        <div data-test="total-alerts-value" class="text-2xl font-semibold">{{ summary.total_alerts }}</div>
        <div data-test="total-alerts-label" class="text-sm text-text-secondary">Total Alerts</div>
      </OCardSection>
    </OCard>

    <!-- Card 2: Alerts with Dedup -->
    <OCard data-test="alerts-with-dedup-card" class="border border-border-default transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
      <OCardSection class="p-4">
        <div class="flex items-center gap-2">
          <div data-test="alerts-with-dedup-value" class="text-2xl font-semibold">{{ summary.alerts_with_dedup }}</div>
          <OIcon data-test="dedup-filter-icon" name="filter-alt" size="sm" />
        </div>
        <div data-test="alerts-with-dedup-label" class="text-sm text-text-secondary flex items-center gap-1">
          Using Deduplication
          <OIcon data-test="dedup-info-icon" name="info-outline" size="xs" class="cursor-pointer" />
            <OTooltip content="Alerts with deduplication configured" />
        </div>
      </OCardSection>
    </OCard>

    <!-- Card 3: Suppression Rate -->
    <OCard
      data-test="suppression-rate-card"
      class="border border-border-default transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      :class="{
        'bg-status-success-bg': summary.suppression_rate > 0.5,
        'bg-status-warning-bg': summary.suppression_rate > 0 && summary.suppression_rate <= 0.5
      }"
    >
      <OCardSection class="p-4">
        <div data-test="suppression-rate-value" class="text-2xl font-semibold" :class="{
          'text-status-success-text': summary.suppression_rate > 0.5,
          'text-status-warning-text': summary.suppression_rate > 0 && summary.suppression_rate <= 0.5
        }">
          {{ formatPercentage(summary.suppression_rate) }}
        </div>
        <div data-test="suppression-rate-label" class="text-sm text-text-secondary flex items-center gap-1">
          Suppression Rate (24h)
          <OIcon data-test="suppression-info-icon" name="info-outline" size="xs" class="cursor-pointer" />
            <OTooltip>
              <template #content>
                {{ summary.suppressions_total }} suppressed /
                {{ summary.suppressions_total + summary.passed_total }} total
                <div class="mt-1">
                  Passed: {{ summary.passed_total }}
                </div>
              </template>
            </OTooltip>
        </div>
      </OCardSection>
    </OCard>

    <!-- Card 4: Pending Batches -->
    <OCard data-test="pending-batches-card" class="border border-border-default transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
      <OCardSection class="p-4">
        <div class="flex items-center gap-2">
          <div data-test="pending-batches-value" class="text-2xl font-semibold">{{ summary.pending_batches }}</div>
          <OIcon data-test="pending-batches-icon" name="group-work" size="sm" />
        </div>
        <div data-test="pending-batches-label" class="text-sm text-text-secondary flex items-center gap-1">
          Pending Batches
          <OIcon data-test="pending-batches-info-icon" name="info-outline" size="xs" class="cursor-pointer" />
            <OTooltip content="Alerts waiting to be grouped together" />
        </div>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useStore } from 'vuex';
import alertsService from '@/services/alerts';
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

const store = useStore();

interface DedupSummary {
  total_alerts: number;
  alerts_with_dedup: number;
  suppressions_total: number;
  passed_total: number;
  suppression_rate: number;
  pending_batches: number;
  timestamp: number;
}

const summary = ref<DedupSummary>({
  total_alerts: 0,
  alerts_with_dedup: 0,
  suppressions_total: 0,
  passed_total: 0,
  suppression_rate: 0,
  pending_batches: 0,
  timestamp: 0,
});

onMounted(async () => {
  await fetchSummary();
});

async function fetchSummary() {
  try {
    const orgId = store.state.selectedOrganization.identifier;
    const response = await alertsService.get_dedup_summary(orgId);
    if (response.data) {
      summary.value = response.data;
    }
  } catch (error) {
    console.error('Failed to fetch dedup summary:', error);
  }
}

function formatPercentage(rate: number): string {
  if (rate === 0) return '0%';
  return `${(rate * 100).toFixed(1)}%`;
}

// Expose fetch method for parent to refresh
defineExpose({
  fetchSummary
});
</script>
