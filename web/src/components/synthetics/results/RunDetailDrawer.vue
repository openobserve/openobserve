<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref, watch } from 'vue'
import { useStore } from 'vuex'
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import { useLLMStreamQuery } from '@/plugins/traces/composables/useLLMStreamQuery'
import {
  buildRunDetailSql,
  mapRunLocationResult,
  type RunLocationResult,
  type RunStatus,
} from '@/composables/synthetics/syntheticResultsSchema'
import syntheticsService from '@/services/synthetics'

const props = defineProps<{
  runId: string
  monitorId: string
  scheduledTs: number  // microseconds
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const store = useStore()
const { executeQuery, cancelAll } = useLLMStreamQuery()

const loading = ref(false)
const queryError = ref<string | null>(null)
const locations = ref<RunLocationResult[]>([])

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) { cancelAll(); return }
    loading.value = true
    queryError.value = null
    locations.value = []
    expandedSteps.value = new Set()
    try {
      const windowUs = 5 * 60 * 1_000_000
      const start = props.scheduledTs - windowUs
      const end = props.scheduledTs + windowUs
      const rows = await executeQuery(buildRunDetailSql(props.runId), start, end, 'logs')
      locations.value = rows.map(mapRunLocationResult)
      // Auto-expand steps for locations that have failures
      for (const loc of locations.value) {
        if (loc.steps.some(s => s.status === 'fail') || loc.status !== 'passed') {
          expandedSteps.value.add(loc.executionId)
        }
      }
      expandedSteps.value = new Set(expandedSteps.value)
    } catch (e: any) {
      queryError.value = e?.message ?? 'Query failed'
    } finally {
      loading.value = false
    }
  },
  { immediate: false },
)

const org = computed(() => store.state.selectedOrganization.identifier)

function artifactUrl(key: string) {
  return syntheticsService.artifactUrl(org.value, key)
}

const overallStatus = computed<RunStatus | null>(() => {
  if (!locations.value.length) return null
  const rank: Record<RunStatus, number> = { passed: 1, warning: 2, failed: 3, error: 4 }
  let worst: RunStatus = 'passed'
  for (const l of locations.value) {
    if (rank[l.status] > rank[worst]) worst = l.status
  }
  return worst
})

const overallDurationMs = computed(() =>
  locations.value.length ? Math.max(...locations.value.map((l) => l.durationMs)) : 0,
)

function statusVariant(s: RunStatus) {
  if (s === 'passed') return 'success'
  if (s === 'warning') return 'warning'
  return 'error'
}

function statusLabel(s: RunStatus) {
  if (s === 'passed') return 'Passed'
  if (s === 'warning') return 'Warning'
  if (s === 'error') return 'Error'
  return 'Failed'
}

function fmtDuration(ms: number) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtTime(tsMicros: number) {
  const ms = tsMicros > 1e12 ? tsMicros / 1000 : tsMicros
  return new Date(ms).toLocaleString()
}

// Steps with errors or screenshots — expanded by default per location
const expandedSteps = ref<Set<string>>(new Set())
function toggleSteps(executionId: string) {
  if (expandedSteps.value.has(executionId)) {
    expandedSteps.value.delete(executionId)
  } else {
    expandedSteps.value.add(executionId)
  }
  expandedSteps.value = new Set(expandedSteps.value)
}
</script>

<template>
  <ODrawer
    :open="open"
    size="lg"
    title="Run Detail"
    :sub-title="fmtTime(scheduledTs)"
    @update:open="(v) => { if (!v) emit('close') }"
  >
    <template #header-right>
      <OBadge
        v-if="overallStatus"
        :variant="statusVariant(overallStatus)"
        size="md"
      >
        {{ statusLabel(overallStatus) }}
      </OBadge>
    </template>

    <div class="tw:flex tw:flex-col tw:h-full">

      <!-- ── Loading skeleton ── -->
      <div v-if="loading" class="tw:flex tw:flex-col tw:gap-3 tw:p-5">
        <div class="tw:flex tw:gap-6 tw:mb-2">
          <div class="skel tw:h-10 tw:w-28 tw:rounded" />
          <div class="skel tw:h-10 tw:w-20 tw:rounded" />
          <div class="skel tw:h-10 tw:w-40 tw:rounded" />
        </div>
        <div v-for="i in 2" :key="i" class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden">
          <div class="skel tw:h-11 tw:w-full" />
          <div class="tw:p-4 tw:flex tw:flex-col tw:gap-2">
            <div class="skel tw:h-4 tw:w-2/3 tw:rounded" />
            <div class="skel tw:h-4 tw:w-1/2 tw:rounded" />
          </div>
        </div>
      </div>

      <!-- ── Query error ── -->
      <div
        v-else-if="queryError"
        class="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:py-16 tw:text-[var(--o2-text-muted)] tw:px-5"
      >
        <OIcon name="error_outline" size="xl" class="tw:text-[var(--o2-status-error-text)]" />
        <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-status-error-text)]">Failed to load run data</p>
        <p class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-caption)] tw:text-center tw:max-w-sm">{{ queryError }}</p>
      </div>

      <!-- ── No data ── -->
      <div
        v-else-if="!locations.length"
        class="tw:flex tw:flex-col tw:items-center tw:gap-3 tw:py-16 tw:text-[var(--o2-text-muted)] tw:px-5"
      >
        <OIcon name="hourglass_empty" size="xl" />
        <p class="tw:text-sm tw:font-medium">No execution data found</p>
        <p class="tw:text-xs tw:text-[var(--o2-text-caption)] tw:text-center">
          Stream data for run <code class="tw:font-mono">{{ runId }}</code> was not found in the ±5 min window around the scheduled time.
        </p>
      </div>

      <!-- ── Data ── -->
      <template v-else>
        <!-- Summary strip -->
        <div class="tw:grid tw:grid-cols-3 tw:gap-x-6 tw:px-5 tw:py-4 tw:border-b tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-surface-secondary)] tw:shrink-0">
          <div>
            <p class="meta-label">Max Duration</p>
            <p class="meta-value">{{ fmtDuration(overallDurationMs) }}</p>
          </div>
          <div>
            <p class="meta-label">Locations</p>
            <p class="meta-value">{{ locations.length }}</p>
          </div>
          <div>
            <p class="meta-label">Run ID</p>
            <p class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)] tw:truncate tw:mt-0.5" :title="runId">{{ runId }}</p>
          </div>
        </div>

        <!-- Per-location cards -->
        <div class="tw:flex-1 tw:overflow-y-auto tw:p-5 tw:flex tw:flex-col tw:gap-4">
          <div
            v-for="loc in locations"
            :key="loc.executionId"
            class="location-card tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden"
          >
            <!-- Card header -->
            <div
              class="tw:flex tw:items-center tw:gap-2.5 tw:px-4 tw:py-3 tw:bg-[var(--o2-surface-secondary)] tw:border-b tw:border-[var(--o2-border-color)]"
            >
              <OBadge :variant="statusVariant(loc.status)" size="sm">{{ statusLabel(loc.status) }}</OBadge>
              <span class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:truncate">{{ loc.location || '—' }}</span>
              <div class="tw:ml-auto tw:flex tw:items-center tw:gap-3 tw:shrink-0">
                <span class="tw:text-xs tw:text-[var(--o2-text-muted)]">{{ [loc.browserEngine, loc.device].filter(Boolean).join(' · ') }}</span>
                <span class="tw:text-sm tw:font-medium tw:tabular-nums tw:text-[var(--o2-text-primary)]">{{ fmtDuration(loc.durationMs) }}</span>
              </div>
            </div>

            <div class="tw:divide-y tw:divide-[var(--o2-border-color)]">

              <!-- Error -->
              <div
                v-if="loc.error"
                class="tw:px-4 tw:py-3"
              >
                <p class="tw:text-xs tw:font-semibold tw:text-[var(--o2-status-error-text)] tw:flex tw:items-center tw:gap-1.5 tw:mb-1.5">
                  <OIcon name="cancel" size="xs" />
                  Error
                </p>
                <pre class="tw:whitespace-pre-wrap tw:font-mono tw:text-xs tw:text-[var(--o2-text-secondary)] tw:leading-relaxed tw:bg-[var(--o2-status-error-subtle)] tw:rounded tw:px-3 tw:py-2 tw:border tw:border-[var(--o2-status-error-border)]">{{ loc.error }}</pre>
              </div>

              <!-- Steps -->
              <div v-if="loc.steps.length" class="tw:px-4 tw:py-3">
                <button
                  class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-2 tw:cursor-pointer hover:tw:text-[var(--o2-text-primary)] tw:transition-colors"
                  @click="toggleSteps(loc.executionId)"
                >
                  <OIcon :name="expandedSteps.has(loc.executionId) ? 'expand_less' : 'expand_more'" size="sm" />
                  Steps ({{ loc.steps.length }})
                  <span v-if="loc.steps.some(s => s.status === 'fail')" class="tw:ml-1 tw:text-[var(--o2-status-error-text)]">
                    · {{ loc.steps.filter(s => s.status === 'fail').length }} failed
                  </span>
                </button>

                <div v-if="expandedSteps.has(loc.executionId)" class="tw:flex tw:flex-col tw:gap-1">
                  <div
                    v-for="(step, idx) in loc.steps"
                    :key="step.stepId"
                    class="tw:flex tw:items-start tw:gap-2.5 tw:py-1.5 tw:text-xs"
                  >
                    <span
                      class="tw:shrink-0 tw:w-4 tw:h-4 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[0.6rem] tw:font-bold tw:mt-px"
                      :class="step.status === 'ok' ? 'tw:bg-green-600' : 'tw:bg-red-500'"
                    >{{ idx + 1 }}</span>
                    <div class="tw:flex-1 tw:min-w-0">
                      <div class="tw:flex tw:items-center tw:gap-2">
                        <span class="tw:font-mono tw:text-[var(--o2-text-secondary)] tw:truncate">{{ step.stepId }}</span>
                        <span class="tw:ml-auto tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:shrink-0">{{ fmtDuration(step.durationMs) }}</span>
                      </div>
                      <p v-if="step.error" class="tw:text-[var(--o2-status-error-text)] tw:truncate tw:mt-0.5" :title="step.error">{{ step.error }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Screenshots -->
              <div v-if="loc.steps.some(s => s.screenshotKey)" class="tw:px-4 tw:py-3">
                <p class="tw:text-xs tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-2">Screenshots</p>
                <div class="tw:grid tw:grid-cols-2 tw:gap-2">
                  <div
                    v-for="step in loc.steps.filter(s => s.screenshotKey)"
                    :key="step.stepId"
                    class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden tw:bg-[var(--o2-surface-secondary)]"
                  >
                    <div class="tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:border-b tw:border-[var(--o2-border-color)]">
                      <span
                        class="tw:w-2 tw:h-2 tw:rounded-full tw:shrink-0"
                        :class="step.status === 'ok' ? 'tw:bg-green-500' : 'tw:bg-red-500'"
                      />
                      <span class="tw:text-[0.65rem] tw:font-mono tw:text-[var(--o2-text-muted)] tw:truncate">{{ step.stepId }}</span>
                    </div>
                    <a :href="artifactUrl(step.screenshotKey!)" target="_blank">
                      <img
                        :src="artifactUrl(step.screenshotKey!)"
                        :alt="`Screenshot ${step.stepId}`"
                        class="tw:w-full tw:block tw:object-contain tw:max-h-48 hover:tw:opacity-90 tw:transition-opacity"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>
              </div>

              <!-- Trace -->
              <div v-if="loc.traceKey" class="tw:px-4 tw:py-3">
                <a
                  :href="artifactUrl(loc.traceKey)"
                  target="_blank"
                  class="tw:inline-flex tw:items-center tw:gap-2 tw:text-xs tw:font-medium tw:text-[var(--o2-text-link)] hover:tw:text-[var(--o2-text-link-hover)] tw:bg-[var(--o2-surface-secondary)] tw:border tw:border-[var(--o2-border-color)] tw:rounded tw:px-3 tw:py-1.5 tw:transition-colors"
                >
                  <OIcon name="download" size="xs" />
                  Download trace.zip
                </a>
              </div>

            </div>
          </div>
        </div>
      </template>
    </div>
  </ODrawer>
</template>

<style scoped lang="scss">
.meta-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--o2-text-muted);
  margin-bottom: 0.2rem;
}

.meta-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.skel {
  background: var(--o2-border-color);
  animation: skel-pulse 1.4s ease-in-out infinite;
}

@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.location-card {
  background: var(--o2-card-bg);
}
</style>
