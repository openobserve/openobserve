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

    <div class="flex flex-col h-full">

      <!-- ── Loading skeleton ── -->
      <div v-if="loading" class="flex flex-col gap-3 p-5">
        <div class="flex gap-6 mb-2">
          <div class="skel h-10 w-28 rounded" />
          <div class="skel h-10 w-20 rounded" />
          <div class="skel h-10 w-40 rounded" />
        </div>
        <div v-for="i in 2" :key="i" class="rounded-lg border border-[var(--o2-border-color)] overflow-hidden">
          <div class="skel h-11 w-full" />
          <div class="p-4 flex flex-col gap-2">
            <div class="skel h-4 w-2/3 rounded" />
            <div class="skel h-4 w-1/2 rounded" />
          </div>
        </div>
      </div>

      <!-- ── Query error ── -->
      <div
        v-else-if="queryError"
        class="flex flex-col items-center gap-3 py-16 text-[var(--o2-text-muted)] px-5"
      >
        <OIcon name="error_outline" size="xl" class="text-[var(--o2-status-error-text)]" />
        <p class="text-sm font-medium text-[var(--o2-status-error-text)]">Failed to load run data</p>
        <p class="text-xs font-mono text-[var(--o2-text-caption)] text-center max-w-sm">{{ queryError }}</p>
      </div>

      <!-- ── No data ── -->
      <div
        v-else-if="!locations.length"
        class="flex flex-col items-center gap-3 py-16 text-[var(--o2-text-muted)] px-5"
      >
        <OIcon name="hourglass_empty" size="xl" />
        <p class="text-sm font-medium">No execution data found</p>
        <p class="text-xs text-[var(--o2-text-caption)] text-center">
          Stream data for run <code class="font-mono">{{ runId }}</code> was not found in the ±5 min window around the scheduled time.
        </p>
      </div>

      <!-- ── Data ── -->
      <template v-else>
        <!-- Summary strip -->
        <div class="grid grid-cols-3 gap-x-6 px-5 py-4 border-b border-[var(--o2-border-color)] bg-[var(--o2-surface-secondary)] shrink-0">
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
            <p class="text-xs font-mono text-[var(--o2-text-secondary)] truncate mt-0.5" :title="runId">{{ runId }}</p>
          </div>
        </div>

        <!-- Per-location cards -->
        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div
            v-for="loc in locations"
            :key="loc.executionId"
            class="location-card rounded-lg border border-[var(--o2-border-color)] overflow-hidden"
          >
            <!-- Card header -->
            <div
              class="flex items-center gap-2.5 px-4 py-3 bg-[var(--o2-surface-secondary)] border-b border-[var(--o2-border-color)]"
            >
              <OBadge :variant="statusVariant(loc.status)" size="sm">{{ statusLabel(loc.status) }}</OBadge>
              <span class="text-sm font-semibold text-[var(--o2-text-heading)] truncate">{{ loc.location || '—' }}</span>
              <div class="ml-auto flex items-center gap-3 shrink-0">
                <span class="text-xs text-[var(--o2-text-muted)]">{{ [loc.browserEngine, loc.device].filter(Boolean).join(' · ') }}</span>
                <span class="text-sm font-medium tabular-nums text-[var(--o2-text-primary)]">{{ fmtDuration(loc.durationMs) }}</span>
              </div>
            </div>

            <div class="divide-y divide-[var(--o2-border-color)]">

              <!-- Error -->
              <div
                v-if="loc.error"
                class="px-4 py-3"
              >
                <p class="text-xs font-semibold text-[var(--o2-status-error-text)] flex items-center gap-1.5 mb-1.5">
                  <OIcon name="cancel" size="xs" />
                  Error
                </p>
                <pre class="whitespace-pre-wrap font-mono text-xs text-[var(--o2-text-secondary)] leading-relaxed bg-[var(--o2-status-error-subtle)] rounded px-3 py-2 border border-[var(--o2-status-error-border)]">{{ loc.error }}</pre>
              </div>

              <!-- Steps -->
              <div v-if="loc.steps.length" class="px-4 py-3">
                <button
                  class="flex items-center gap-1.5 text-xs font-semibold text-[var(--o2-text-heading)] mb-2 cursor-pointer hover:text-[var(--o2-text-primary)] transition-colors"
                  @click="toggleSteps(loc.executionId)"
                >
                  <OIcon :name="expandedSteps.has(loc.executionId) ? 'expand_less' : 'expand_more'" size="sm" />
                  Steps ({{ loc.steps.length }})
                  <span v-if="loc.steps.some(s => s.status === 'fail')" class="ml-1 text-[var(--o2-status-error-text)]">
                    · {{ loc.steps.filter(s => s.status === 'fail').length }} failed
                  </span>
                </button>

                <div v-if="expandedSteps.has(loc.executionId)" class="flex flex-col gap-1">
                  <div
                    v-for="(step, idx) in loc.steps"
                    :key="step.stepId"
                    class="flex items-start gap-2.5 py-1.5 text-xs"
                  >
                    <span
                      class="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[0.6rem] font-bold mt-px"
                      :class="step.status === 'ok' ? 'bg-green-600' : 'bg-red-500'"
                    >{{ idx + 1 }}</span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[var(--o2-text-secondary)] truncate">{{ step.stepId }}</span>
                        <span class="ml-auto tabular-nums text-[var(--o2-text-muted)] shrink-0">{{ fmtDuration(step.durationMs) }}</span>
                      </div>
                      <p v-if="step.error" class="text-[var(--o2-status-error-text)] truncate mt-0.5" :title="step.error">{{ step.error }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Screenshots -->
              <div v-if="loc.steps.some(s => s.screenshotKey)" class="px-4 py-3">
                <p class="text-xs font-semibold text-[var(--o2-text-heading)] mb-2">Screenshots</p>
                <div class="grid grid-cols-2 gap-2">
                  <div
                    v-for="step in loc.steps.filter(s => s.screenshotKey)"
                    :key="step.stepId"
                    class="rounded border border-[var(--o2-border-color)] overflow-hidden bg-[var(--o2-surface-secondary)]"
                  >
                    <div class="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--o2-border-color)]">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="step.status === 'ok' ? 'bg-green-500' : 'bg-red-500'"
                      />
                      <span class="text-[0.65rem] font-mono text-[var(--o2-text-muted)] truncate">{{ step.stepId }}</span>
                    </div>
                    <a :href="artifactUrl(step.screenshotKey!)" target="_blank">
                      <img
                        :src="artifactUrl(step.screenshotKey!)"
                        :alt="`Screenshot ${step.stepId}`"
                        class="w-full block object-contain max-h-48 hover:opacity-90 transition-opacity"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>
              </div>

              <!-- Trace -->
              <div v-if="loc.traceKey" class="px-4 py-3">
                <a
                  :href="artifactUrl(loc.traceKey)"
                  target="_blank"
                  class="inline-flex items-center gap-2 text-xs font-medium text-[var(--o2-text-link)] hover:text-[var(--o2-text-link-hover)] bg-[var(--o2-surface-secondary)] border border-[var(--o2-border-color)] rounded px-3 py-1.5 transition-colors"
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
