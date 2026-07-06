<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import { useLLMStreamQuery } from '@/plugins/traces/composables/useLLMStreamQuery'
import {
  buildRunDetailSql,
  mapRunLocationResult,
  type RetryAttempt,
  type RunLocationResult,
  type RunStatus,
  type StepResult,
} from '@/composables/synthetics/syntheticResultsSchema'
import syntheticsService from '@/services/synthetics'

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
      const rows = await executeQuery(buildRunDetailSql(props.monitorId), start, end, 'logs')
      executions.value = rows.map(mapRunLocationResult)
      initExpanded()
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      // Stream not found = no results written yet (e.g. probe infra error before first run).
      // Treat as empty rather than surfacing a technical error.
      const isStreamMissing = /stream.*not.*found|table.*not.*found|not.*found/i.test(msg)
      if (!isStreamMissing) {
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
// Executions with steps expanded
const expandedExecutions = ref(new Set<string>())
// Retry attempt 0 expanded per executionId
const expandedRetry = ref(new Set<string>())

function initExpanded() {
  const locs = new Set<string>()
  const execs = new Set<string>()
  for (const ex of executions.value) {
    if (ex.status !== 'passed') {
      locs.add(ex.location)
      if (ex.status === 'failed' || ex.status === 'error') {
        execs.add(ex.executionId)
      }
    }
  }
  expandedLocations.value = locs
  expandedExecutions.value = execs
  expandedRetry.value = new Set()
}

function toggleLocation(loc: string) {
  const s = new Set(expandedLocations.value)
  if (s.has(loc)) s.delete(loc)
  else s.add(loc)
  expandedLocations.value = s
}

function toggleExecution(id: string) {
  const s = new Set(expandedExecutions.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedExecutions.value = s
}

function toggleRetry(id: string) {
  const s = new Set(expandedRetry.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedRetry.value = s
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

const STATUS_BG: Record<RunStatus, string> = {
  passed:  'tw:bg-green-500',
  warning: 'tw:bg-amber-500',
  failed:  'tw:bg-red-500',
  error:   'tw:bg-orange-500',
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

function totalRetries(ex: RunLocationResult): number {
  return ex.retryHistory.length
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
                    :class="expandedExecutions.has(ex.executionId) ? 'tw:bg-[var(--o2-surface-hover)]' : ''"
                    @click="ex.status !== 'passed' && toggleExecution(ex.executionId)"
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

            <!-- Per-execution step detail blocks for non-passed executions -->
            <div
              v-for="ex in group.execs.filter(e => e.status !== 'passed')"
              :key="`detail-${ex.executionId}`"
              class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden tw:mb-2"
            >
              <!-- Execution detail header -->
              <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2.5 tw:bg-[var(--o2-surface-secondary)] tw:border-b tw:border-[var(--o2-border-color)]">
                <span class="tw:font-semibold tw:text-sm tw:capitalize tw:text-[var(--o2-text-heading)]">
                  {{ ex.browserEngine }} · {{ ex.device }}
                </span>
                <span :class="STATUS_COLOR[ex.status]" class="tw:font-semibold tw:text-xs">
                  {{ statusDot(ex.status) }} {{ statusLabel(ex.status) }}
                </span>
                <span class="tw:text-xs tw:text-[var(--o2-text-muted)]">{{ fmtDuration(ex.durationMs) }}</span>
                <span v-if="totalRetries(ex) > 0" class="tw:text-xs tw:text-[var(--o2-text-muted)]">
                  · {{ totalRetries(ex) + 1 }} attempts
                </span>
                <div class="tw:ml-auto tw:flex tw:items-center tw:gap-2">
                  <a
                    v-if="ex.traceKey"
                    :href="artifactUrl(ex.traceKey)"
                    target="_blank"
                    class="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-[var(--o2-text-link)] hover:tw:underline"
                    @click.stop
                  >
                    View trace
                    <OIcon name="open_in_new" size="xs" />
                  </a>
                  <button
                    class="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-[var(--o2-text-muted)] hover:tw:text-[var(--o2-text-primary)]"
                    @click="toggleExecution(ex.executionId)"
                  >
                    <OIcon :name="expandedExecutions.has(ex.executionId) ? 'expand_less' : 'expand_more'" size="sm" />
                    {{ expandedExecutions.has(ex.executionId) ? 'Hide steps' : 'Show steps' }}
                  </button>
                </div>
              </div>

              <div v-if="expandedExecutions.has(ex.executionId)" class="tw:p-3 tw:flex tw:flex-col tw:gap-3">

                <!-- Final attempt steps -->
                <div>
                  <p class="tw:text-[0.65rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1.5">
                    Attempt {{ totalRetries(ex) }} ({{ ex.status === 'passed' || ex.status === 'warning' ? 'passed — final' : 'failed — final' }})
                  </p>
                  <StepList :steps="ex.steps" :show-screenshots="true" :artifact-url-fn="artifactUrl" />
                </div>

                <!-- Error message if no step detail -->
                <div
                  v-if="ex.error && !ex.steps.length"
                  class="tw:rounded tw:border tw:border-orange-500/30 tw:bg-orange-500/10 tw:px-3 tw:py-2"
                >
                  <p class="tw:text-xs tw:text-orange-600 tw:font-mono tw:whitespace-pre-wrap">{{ ex.error }}</p>
                </div>

                <!-- Retry history -->
                <div v-if="ex.retryHistory.length">
                  <button
                    class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-[var(--o2-text-muted)] hover:tw:text-[var(--o2-text-primary)] tw:mb-1.5"
                    @click="toggleRetry(ex.executionId)"
                  >
                    <OIcon :name="expandedRetry.has(ex.executionId) ? 'expand_less' : 'expand_more'" size="xs" />
                    Attempt {{ ex.retryHistory[0]?.attempt ?? 0 }} (failed · {{ fmtDuration(ex.retryHistory[0]?.durationMs) }})
                  </button>
                  <div v-if="expandedRetry.has(ex.executionId)">
                    <StepList :steps="ex.retryHistory[0]?.steps ?? []" :show-screenshots="false" :artifact-url-fn="artifactUrl" />
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<!-- Step list sub-component inlined -->
<script lang="ts">
import { defineComponent, h, PropType } from 'vue'
import type { StepResult } from '@/composables/synthetics/syntheticResultsSchema'

const StepList = defineComponent({
  name: 'StepList',
  props: {
    steps: { type: Array as PropType<StepResult[]>, required: true },
    showScreenshots: { type: Boolean, default: false },
    artifactUrlFn: { type: Function as PropType<(key: string) => string>, required: true },
  },
  setup(props) {
    const maxDuration = () => Math.max(...props.steps.map((s) => s.durationMs), 1)

    return () => {
      if (!props.steps.length) {
        return h('p', { class: 'tw:text-xs tw:text-[var(--o2-text-muted)] tw:italic' }, 'No step data available.')
      }
      const max = maxDuration()
      return h('div', { class: 'tw:flex tw:flex-col tw:gap-0.5' },
        props.steps.map((step, i) => {
          const isFail = step.status === 'fail'
          const pct = max > 0 ? Math.max(4, Math.round((step.durationMs / max) * 100)) : 4
          return h('div', {
            key: step.stepId,
            class: `tw:rounded tw:text-xs tw:px-2 tw:py-1.5 ${isFail ? 'tw:bg-red-500/10 tw:border tw:border-red-500/30' : 'tw:bg-[var(--o2-surface-secondary)]'}`,
          }, [
            h('div', { class: 'tw:flex tw:items-center tw:gap-2' }, [
              h('span', {
                class: `tw:shrink-0 tw:w-4 tw:h-4 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[0.58rem] tw:font-bold ${isFail ? 'tw:bg-red-500' : 'tw:bg-green-600'}`,
              }, String(i + 1)),
              h('span', { class: 'tw:font-mono tw:text-[var(--o2-text-secondary)] tw:flex-1 tw:truncate', title: step.stepId }, step.stepId || `Step ${i + 1}`),
              h('span', { class: 'tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:shrink-0' }, step.durationMs ? `${step.durationMs} ms` : '—'),
            ]),
            // Duration bar
            step.durationMs ? h('div', { class: 'tw:mt-1 tw:h-0.5 tw:rounded tw:bg-[var(--o2-border-color)]' }, [
              h('div', { class: `tw:h-full tw:rounded ${isFail ? 'tw:bg-red-500' : 'tw:bg-blue-500'}`, style: `width:${pct}%` }),
            ]) : null,
            // Error
            isFail && step.error ? h('p', { class: 'tw:mt-1 tw:text-red-600 tw:font-mono tw:text-[0.7rem] tw:whitespace-pre-wrap tw:leading-relaxed' }, step.error) : null,
            // Screenshot
            props.showScreenshots && step.screenshotKey
              ? h('a', { href: props.artifactUrlFn(step.screenshotKey), target: '_blank', class: 'tw:block tw:mt-2' }, [
                  h('img', {
                    src: props.artifactUrlFn(step.screenshotKey),
                    alt: `Screenshot step ${step.stepId}`,
                    class: 'tw:w-full tw:max-h-48 tw:object-contain tw:rounded tw:border tw:border-[var(--o2-border-color)]',
                    loading: 'lazy',
                  }),
                ])
              : null,
          ])
        }),
      )
    }
  },
})
</script>

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
