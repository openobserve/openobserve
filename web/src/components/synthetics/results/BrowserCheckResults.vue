<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onMounted, ref } from 'vue'
import { useStore } from 'vuex'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import syntheticsService from '@/services/synthetics'
import RunDetailDrawer from './RunDetailDrawer.vue'

const props = defineProps<{ checkId: string }>()

const store = useStore()

interface ScreenshotRef { step_id: string; key: string }

interface RunResult {
  job_id: string
  synthetics_id: string
  location: string
  pool: string
  status: 'up' | 'warning' | 'down' | 'error'
  response_time_ms: number
  error?: string
  browser_engine?: string
  device?: string
  checked_at: number
  screenshot_refs: ScreenshotRef[]
  trace_ref?: string
}

const runs = ref<RunResult[]>([])
const isLoading = ref(true)
const selectedRun = ref<RunResult | null>(null)
const drawerOpen = ref(false)

async function fetchResults() {
  isLoading.value = true
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.results(org, props.checkId)
    runs.value = (res.data?.results ?? []) as RunResult[]
  } catch (err) {
    console.error('[synthetics] failed to load results', err)
  } finally {
    isLoading.value = false
  }
}

function openRun(run: RunResult) {
  selectedRun.value = run
  drawerOpen.value = true
}

function statusVariant(status: RunResult['status']) {
  return status === 'up' ? 'success' : 'error'
}

function statusLabel(status: RunResult['status']) {
  return status === 'up' ? 'Passed' : status === 'warning' ? 'Warning' : status === 'error' ? 'Error' : 'Failed'
}

function fmtTime(tsMicros: number) {
  return new Date(tsMicros / 1000).toLocaleString()
}

onMounted(fetchResults)
</script>

<template>
  <div class="tw:p-6">
    <div v-if="isLoading" class="tw:flex tw:justify-center tw:py-16 tw:text-[var(--o2-text-muted)]">
      <OIcon name="refresh" size="lg" class="tw:animate-spin" />
    </div>

    <div
      v-else-if="runs.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-20 tw:gap-4 tw:text-[var(--o2-text-muted)]"
      data-test="synthetics-results-empty-state"
    >
      <OIcon name="bar-chart" size="xl" />
      <h3>No results yet</h3>
      <p>Save and run the check to see results here.</p>
    </div>

    <div v-else class="tw:overflow-x-auto">
      <table class="tw:w-full tw:text-sm tw:border-collapse">
        <thead>
          <tr class="tw:border-b tw:border-[var(--o2-border-color)]">
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Timestamp</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Status</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Duration</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Location</th>
            <th class="tw:text-left tw:py-2 tw:px-3 tw:font-medium tw:text-[var(--o2-text-label)]">Device</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs"
            :key="run.job_id"
            class="tw:border-b tw:border-[var(--o2-border-color)] tw:hover:bg-[var(--o2-card-bg)] tw:cursor-pointer"
            data-test="synthetics-result-row"
            @click="openRun(run)"
          >
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ fmtTime(run.checked_at) }}</td>
            <td class="tw:py-2 tw:px-3">
              <OBadge :variant="statusVariant(run.status)">{{ statusLabel(run.status) }}</OBadge>
            </td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.response_time_ms.toFixed(0) }} ms</td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.location }}</td>
            <td class="tw:py-2 tw:px-3 tw:text-[var(--o2-text-body)]">{{ run.device ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <RunDetailDrawer
      v-if="selectedRun"
      :run="selectedRun"
      :check-id="checkId"
      :open="drawerOpen"
      @close="drawerOpen = false"
    />
  </div>
</template>
