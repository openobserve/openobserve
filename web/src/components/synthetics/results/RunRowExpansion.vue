<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import { useLLMStreamQuery } from '@/plugins/traces/composables/useLLMStreamQuery'
import {
  buildRunDetailSql,
  mapRunLocationResult,
  type RunLocationResult,
  type RunStatus,
  type StepResult,
} from '@/composables/synthetics/syntheticResultsSchema'
import syntheticsService from '@/services/synthetics'
import ExecutionDetailDrawer from './ExecutionDetailDrawer.vue'

const props = defineProps<{
  runId: string
  monitorId: string
  scheduledTs: number // microseconds
  runStatus?: string
}>()

const store = useStore()
const { executeQuery, cancelAll } = useLLMStreamQuery()

// ── Data loading ──────────────────────────────────────────────────────────

const loading = ref(true)
const queryError = ref<string | null>(null)
const executions = ref<RunLocationResult[]>([])

watch(
  () => props.runId,
  async () => {
    loading.value = true
    queryError.value = null
    executions.value = []
    try {
      const windowUs = 5 * 60 * 1_000_000
      const start = props.scheduledTs - windowUs
      const end = props.scheduledTs + windowUs
      const rows = await executeQuery(buildRunDetailSql(props.monitorId, props.runId), start, end, 'logs')
      executions.value = rows.map(mapRunLocationResult)
      initExpanded()
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      // Stream not found = no results written yet (e.g. probe infra error before first run).
      // Treat as empty rather than surfacing a technical error.
      const isIgnorable = /stream.*not.*found|table.*not.*found|not.*found|field.*not.*found|search field|column.*not.*exist/i.test(msg)
      if (!isIgnorable) {
        queryError.value = msg || 'Query failed'
      }
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

onUnmounted(() => cancelAll())

// ── Grouping by location ──────────────────────────────────────────────────

interface LocationGroup {
  location: string
  status: RunStatus
  durationMs: number
  execs: RunLocationResult[]
}

const locationGroups = computed<LocationGroup[]>(() => {
  const map = new Map<string, RunLocationResult[]>()
  for (const ex of executions.value) {
    const key = ex.location || '(unknown)'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(ex)
  }
  return Array.from(map.entries()).map(([location, execs]) => ({
    location,
    execs,
    status: worstStatus(execs.map((e) => e.status)),
    durationMs: Math.max(...execs.map((e) => e.durationMs)),
  }))
})

// ── Accordion state ───────────────────────────────────────────────────────

// Locations expanded (show execution table inside)
const expandedLocations = ref(new Set<string>())
// Drawer state
const selectedExecution = ref<RunLocationResult | null>(null)

function openDrawer(ex: RunLocationResult) {
  selectedExecution.value = ex
}

function initExpanded() {
  expandedLocations.value = new Set()
}

function toggleLocation(loc: string) {
  const s = new Set(expandedLocations.value)
  if (s.has(loc)) s.delete(loc)
  else s.add(loc)
  expandedLocations.value = s
}

// ── Helpers ───────────────────────────────────────────────────────────────

function worstStatus(statuses: RunStatus[]): RunStatus {
  const rank: Record<RunStatus, number> = { passed: 1, warning: 2, failed: 3, error: 4 }
  let worst: RunStatus = 'passed'
  for (const s of statuses) {
    if (rank[s] > rank[worst]) worst = s
  }
  return worst
}

const STATUS_COLOR: Record<RunStatus | 'pending', string> = {
  passed:  'tw:text-green-500',
  warning: 'tw:text-amber-500',
  failed:  'tw:text-red-500',
  error:   'tw:text-orange-500',
  pending: 'tw:text-gray-400',
}

function statusDot(s: RunStatus) {
  return s === 'error' ? '○' : '●'
}

function statusLabel(s: RunStatus) {
  return s === 'passed' ? 'Passed'
    : s === 'warning' ? 'Warning'
    : s === 'error' ? 'Error'
    : 'Failed'
}

function fmtDuration(ms: number) {
  if (!ms) return '—'
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function deviceIcon(device: string) {
  if (device?.includes('mobile') || device?.includes('tablet')) return 'smartphone'
  return 'laptop'
}

const org = computed(() => store.state.selectedOrganization.identifier)

function artifactUrl(key: string) {
  return syntheticsService.artifactUrl(org.value, key)
}

function failedAtStep(steps: StepResult[]): string {
  const step = steps.find((s) => s.status === 'fail')
  return step ? (step.stepId || '—') : '—'
}

</script>

<template>
  <div class="run-expansion tw:border-t tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-surface-secondary)]">

    <!-- Loading skeleton -->
    <div v-if="loading" class="tw:flex tw:flex-col tw:gap-2 tw:p-4">
      <div class="tw:flex tw:gap-3 tw:items-center tw:py-2">
        <div class="skel tw:h-4 tw:w-24 tw:rounded" />
        <div class="skel tw:h-4 tw:w-16 tw:rounded" />
        <div class="skel tw:h-4 tw:w-40 tw:rounded" />
      </div>
      <div class="skel tw:h-24 tw:w-full tw:rounded" />
    </div>

    <!-- Query error -->
    <div v-else-if="queryError" class="tw:flex tw:items-center tw:gap-2 tw:p-4 tw:text-xs tw:text-[var(--o2-status-error-text)]">
      <OIcon name="error_outline" size="sm" />
      <span>{{ queryError }}</span>
    </div>

    <!-- No data -->
    <div v-else-if="!executions.length" class="tw:flex tw:items-center tw:gap-2 tw:p-4 tw:text-xs tw:text-[var(--o2-text-muted)]">
      <OIcon name="info" size="sm" />
      <span v-if="runStatus === 'error'">Probe infrastructure error — no execution data was recorded for this run.</span>
      <span v-else>No execution data found for this run.</span>
    </div>

    <!-- Location groups -->
    <template v-else>
      <!-- Warning banner for warning runs -->
      <div
        v-if="locationGroups.some(g => g.status === 'warning') && locationGroups.every(g => g.status !== 'failed' && g.status !== 'error')"
        class="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:text-xs tw:text-amber-600 tw:bg-amber-500/10 tw:border-b tw:border-amber-500/20"
      >
        <OIcon name="warning" size="xs" />
        This run passed but some checks were flaky (passed on retry).
      </div>

      <div class="tw:flex tw:flex-col tw:divide-y tw:divide-[var(--o2-border-color)]">
        <div
          v-for="group in locationGroups"
          :key="group.location"
          class="location-group"
        >
          <!-- Location header row — click to expand/collapse -->
          <button
            class="tw:w-full tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2.5 tw:text-xs tw:font-medium tw:text-left hover:tw:bg-[var(--o2-surface-hover)] tw:transition-colors"
            @click="toggleLocation(group.location)"
          >
            <OIcon
              :name="expandedLocations.has(group.location) ? 'expand_more' : 'chevron_right'"
              size="sm"
              class="tw:text-[var(--o2-text-muted)] tw:shrink-0"
            />
            <span :class="STATUS_COLOR[group.status]" class="tw:font-bold tw:text-sm">
              {{ statusDot(group.status) }}
            </span>
            <span class="tw:text-[var(--o2-text-heading)] tw:font-semibold">{{ group.location }}</span>
            <span :class="STATUS_COLOR[group.status]" class="tw:font-medium">
              {{ statusLabel(group.status) }}
            </span>
            <span class="tw:text-[var(--o2-text-muted)]">{{ fmtDuration(group.durationMs) }}</span>
            <span class="tw:ml-auto tw:text-[var(--o2-text-muted)]">
              {{ group.execs.length }} execution{{ group.execs.length !== 1 ? 's' : '' }}
            </span>
          </button>

          <!-- Location expansion: execution table -->
          <div v-if="expandedLocations.has(group.location)" class="tw:px-4 tw:pb-3">

            <!-- Execution summary table -->
            <div class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden tw:mb-3">
              <table class="tw:w-full tw:text-xs">
                <thead>
                  <tr class="tw:bg-[var(--o2-surface-secondary)] tw:border-b tw:border-[var(--o2-border-color)]">
                    <th class="tw:px-3 tw:py-2 tw:text-left tw:font-semibold tw:text-[var(--o2-text-muted)] tw:uppercase tw:tracking-wide tw:text-[0.62rem]">Browser</th>
                    <th class="tw:px-3 tw:py-2 tw:text-left tw:font-semibold tw:text-[var(--o2-text-muted)] tw:uppercase tw:tracking-wide tw:text-[0.62rem]">Device</th>
                    <th class="tw:px-3 tw:py-2 tw:text-left tw:font-semibold tw:text-[var(--o2-text-muted)] tw:uppercase tw:tracking-wide tw:text-[0.62rem]">Status</th>
                    <th class="tw:px-3 tw:py-2 tw:text-right tw:font-semibold tw:text-[var(--o2-text-muted)] tw:uppercase tw:tracking-wide tw:text-[0.62rem]">Duration</th>
                    <th class="tw:px-3 tw:py-2 tw:text-left tw:font-semibold tw:text-[var(--o2-text-muted)] tw:uppercase tw:tracking-wide tw:text-[0.62rem]">Failed at</th>
                  </tr>
                </thead>
                <tbody class="tw:divide-y tw:divide-[var(--o2-border-color)]">
                  <tr
                    v-for="ex in group.execs"
                    :key="ex.executionId"
                    class="hover:tw:bg-[var(--o2-surface-hover)] tw:transition-colors tw:cursor-pointer"
                    @click="openDrawer(ex)"
                  >
                    <td class="tw:px-3 tw:py-2 tw:font-medium tw:capitalize">{{ ex.browserEngine }}</td>
                    <td class="tw:px-3 tw:py-2">
                      <span class="tw:flex tw:items-center tw:gap-1">
                        <OIcon :name="deviceIcon(ex.device)" size="xs" class="tw:text-[var(--o2-text-muted)]" />
                        {{ ex.device || '—' }}
                      </span>
                    </td>
                    <td class="tw:px-3 tw:py-2">
                      <span class="tw:flex tw:items-center tw:gap-1.5 tw:font-semibold" :class="STATUS_COLOR[ex.status]">
                        <span class="tw:text-base tw:leading-none">{{ statusDot(ex.status) }}</span>
                        {{ statusLabel(ex.status) }}
                        <span v-if="ex.status === 'warning'" class="tw:font-normal tw:text-[var(--o2-text-muted)]">(flaky)</span>
                      </span>
                    </td>
                    <td class="tw:px-3 tw:py-2 tw:text-right tw:tabular-nums tw:text-[var(--o2-text-secondary)]">{{ fmtDuration(ex.durationMs) }}</td>
                    <td class="tw:px-3 tw:py-2 tw:text-[var(--o2-text-muted)] tw:font-mono tw:truncate tw:max-w-[12rem]">
                      {{ ex.status !== 'passed' ? failedAtStep(ex.steps) : '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
    </template>

    <!-- Execution detail drawer -->
    <ExecutionDetailDrawer
      :execution="selectedExecution"
      :artifact-url-fn="artifactUrl"
      @close="selectedExecution = null"
    />
  </div>
</template>


<style scoped lang="scss">
.skel {
  background: var(--o2-border-color);
  animation: skel-pulse 1.4s ease-in-out infinite;
}
@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
</style>
