<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { ref } from 'vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

defineProps<{ checkId: string }>()

interface RunResult {
  id: string
  timestamp: string
  status: 'pass' | 'fail'
  duration: number // ms
  stepsPassed: number
  stepsFailed: number
}

// Empty for now — show empty state when no runs available
const runs = ref<RunResult[]>([])
</script>

<template>
  <div class="tw:p-6">
    <!-- Empty state -->
    <div
      v-if="runs.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-20 tw:gap-4 tw:text-[var(--o2-text-muted)]"
      data-test="synthetics-results-empty-state"
    >
      <OIcon name="bar-chart" size="xl" aria-hidden="true" />
      <h3>No results yet</h3>
      <p>Save and run the check to see results here.</p>
    </div>

    <!-- Results table (shown when runs are available) -->
    <div v-else class="tw:overflow-x-auto">
      <table class="tw:w-full tw:text-sm tw:border-collapse">
        <thead>
          <tr class="tw:border-b tw:border-[var(--o2-border-color)]">
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Timestamp</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Status</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Duration</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Steps passed</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Steps failed</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs"
            :key="run.id"
            class="tw:border-b tw:border-[var(--o2-border-color)] tw:hover:bg-[var(--o2-card-bg)]"
          >
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.timestamp }}</td>
            <td class="tw:py-2 tw:px-3">
              <OBadge :variant="run.status === 'pass' ? 'success' : 'error'">
                {{ run.status === 'pass' ? 'Pass' : 'Fail' }}
              </OBadge>
            </td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.duration }} ms</td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.stepsPassed }}</td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.stepsFailed }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
