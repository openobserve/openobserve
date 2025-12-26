<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="dedup-summary-cards tw:grid tw:grid-cols-4 tw:gap-4 tw:mb-4">
    <!-- Card 1: Total Alerts -->
    <q-card class="summary-card">
      <q-card-section class="tw:p-4">
        <div class="tw:text-2xl tw:font-semibold">{{ summary.total_alerts }}</div>
        <div class="tw:text-sm tw:text-gray-600">Total Alerts</div>
      </q-card-section>
    </q-card>

    <!-- Card 2: Alerts with Dedup -->
    <q-card class="summary-card">
      <q-card-section class="tw:p-4">
        <div class="tw:flex tw:items-center tw:gap-2">
          <div class="tw:text-2xl tw:font-semibold">{{ summary.alerts_with_dedup }}</div>
          <q-icon name="filter_alt" size="sm" color="primary" />
        </div>
        <div class="tw:text-sm tw:text-gray-600 tw:flex tw:items-center tw:gap-1">
          Using Deduplication
          <q-icon name="info_outline" size="xs" class="tw:cursor-pointer">
            <q-tooltip class="bg-grey-8">
              Alerts with deduplication configured
            </q-tooltip>
          </q-icon>
        </div>
      </q-card-section>
    </q-card>

    <!-- Card 3: Suppression Rate -->
    <q-card
      class="summary-card"
      :class="{
        'tw:bg-green-50': summary.suppression_rate > 0.5,
        'tw:bg-yellow-50': summary.suppression_rate > 0 && summary.suppression_rate <= 0.5
      }"
    >
      <q-card-section class="tw:p-4">
        <div class="tw:text-2xl tw:font-semibold" :class="{
          'tw:text-green-700': summary.suppression_rate > 0.5,
          'tw:text-yellow-700': summary.suppression_rate > 0 && summary.suppression_rate <= 0.5
        }">
          {{ formatPercentage(summary.suppression_rate) }}
        </div>
        <div class="tw:text-sm tw:text-gray-600 tw:flex tw:items-center tw:gap-1">
          Suppression Rate (24h)
          <q-icon name="info_outline" size="xs" class="tw:cursor-pointer">
            <q-tooltip class="bg-grey-8">
              {{ summary.suppressions_total }} suppressed /
              {{ summary.suppressions_total + summary.passed_total }} total
              <div class="tw:mt-1">
                Passed: {{ summary.passed_total }}
              </div>
            </q-tooltip>
          </q-icon>
        </div>
      </q-card-section>
    </q-card>

    <!-- Card 4: Pending Batches -->
    <q-card class="summary-card">
      <q-card-section class="tw:p-4">
        <div class="tw:flex tw:items-center tw:gap-2">
          <div class="tw:text-2xl tw:font-semibold">{{ summary.pending_batches }}</div>
          <q-icon name="group_work" size="sm" color="amber" />
        </div>
        <div class="tw:text-sm tw:text-gray-600 tw:flex tw:items-center tw:gap-1">
          Pending Batches
          <q-icon name="info_outline" size="xs" class="tw:cursor-pointer">
            <q-tooltip class="bg-grey-8">
              Alerts waiting to be grouped together
            </q-tooltip>
          </q-icon>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useStore } from 'vuex';
import alertsService from '@/services/alerts';

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

<style scoped lang="scss">
.summary-card {
  border: 1px solid #e0e0e0;
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}
</style>
