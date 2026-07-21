<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Run detail for protocol checks (http/tcp/tls/ssh) — flat result fields, a
// timing waterfall, and assertion outcomes. No steps/screenshots/replay
// (those are browser-run concepts).
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import OPageHeader from '@/lib/core/PageHeader/OPageHeader.vue'
import OPageLayout from '@/lib/core/PageLayout/OPageLayout.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OSkeleton from '@/lib/feedback/Skeleton/OSkeleton.vue'
import OEmptyState from '@/lib/core/EmptyState/OEmptyState.vue'
import useSyntheticResults from '@/composables/useSyntheticResults'
import syntheticsService from '@/services/synthetics'
import type { HttpAssertion } from '@/types/synthetics'

const props = withDefaults(
  defineProps<{
    monitorId: string
    runId: string
    executionId: string
    drawerMode?: boolean
  }>(),
  { drawerMode: false },
)

const emit = defineEmits<{
  (
    e: 'update-status',
    status: { variant: string; icon: string; label: string; url: string; timestamp: string },
  ): void
}>()

const { t } = useI18n()
const store = useStore()
const synthetics = useSyntheticResults()

const run = computed(() => synthetics.protocolRunDetail.value)
const loading = computed(() => synthetics.loading.value)

// Assertion definitions come from the monitor config; the result record only
// carries assertions_passed + the first failure detail in `error`.
const assertionDefs = ref<HttpAssertion[]>([])

async function loadRun() {
  if (!props.runId || !props.executionId) return
  const endTime = Date.now() * 1000 // µs
  const startTime = endTime - 30 * 24 * 3600 * 1000 * 1000 // 30 days
  await synthetics.fetchProtocolRun(
    props.monitorId,
    props.runId,
    props.executionId,
    startTime,
    endTime,
  )
}

async function loadAssertionDefs() {
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.get(org, props.monitorId)
    assertionDefs.value = ((res.data as any)?.config?.assertions ?? []) as HttpAssertion[]
  } catch {
    assertionDefs.value = []
  }
}

onMounted(loadAssertionDefs)

watch(
  () => [props.runId, props.executionId] as [string, string],
  ([rid, eid]) => {
    if (rid && eid) loadRun()
  },
  { immediate: true },
)

// ── Status display ───────────────────────────────────────────────────────────
// Canonical vocabulary shared with the browser probe and control plane
// (config::meta::synthetics::SyntheticStatus): passed|warning|failed|error.
const statusMeta = computed(() => {
  switch (run.value?.status) {
    case 'passed':
      return { variant: 'success' as const, icon: 'check-circle', label: t('synthetics.protocolRun.passed') }
    case 'warning':
      return { variant: 'warning' as const, icon: 'error', label: t('synthetics.protocolRun.warning') }
    case 'error':
      return { variant: 'error-soft' as const, icon: 'error', label: t('synthetics.protocolRun.error') }
    default:
      return { variant: 'error' as const, icon: 'cancel', label: t('synthetics.protocolRun.failed') }
  }
})

watch(
  () => run.value?.status ?? null,
  (status) => {
    if (!props.drawerMode || !status || !run.value) return
    emit('update-status', {
      variant: statusMeta.value.variant === 'error' ? 'error' : statusMeta.value.variant,
      icon: statusMeta.value.icon,
      label: statusMeta.value.label,
      url: run.value.target,
      timestamp: fmtTs(run.value.timestamp),
    })
  },
)

// ── Formatting ──────────────────────────────────────────────────────────────
function fmtTs(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}
function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms + ' ms'
}
function fmtBytes(b: number | null): string {
  if (b == null) return '—'
  return b >= 1024 ? (b / 1024).toFixed(1) + ' KiB' : b + ' B'
}

const certDaysRemaining = computed(() => {
  const exp = run.value?.tlsCertExpiry
  if (!exp) return null
  return Math.floor((exp / 1000 - Date.now()) / (24 * 3600 * 1000))
})
const certExpiryDate = computed(() => {
  const exp = run.value?.tlsCertExpiry
  return exp ? new Date(exp / 1000).toLocaleDateString() : null
})

// Timing waterfall — bar widths relative to the total.
const timingBars = computed(() => {
  if (!run.value) return []
  const total = Math.max(run.value.totalMs, 1)
  return run.value.timings.map((tm) => ({
    phase: tm.phase,
    ms: tm.ms,
    pct: Math.max(1, Math.round((tm.ms / total) * 100)),
  }))
})

// Per-assertion verdict: the record only has a bool + first-failure detail, so
// when the run failed on an assertion we mark the row whose field appears at
// the start of `error` (probe detail format: "status 503 eq 200" etc.).
const assertionRows = computed(() => {
  if (!run.value) return []
  const passedAll = run.value.assertionsPassed
  return assertionDefs.value.map((a) => {
    let failed = false
    if (passedAll === false && run.value) {
      const err = run.value.error
      const fieldWord = a.field === 'status_code' ? 'status' : a.field
      failed = run.value.errorClass === 'assertion' && err.startsWith(fieldWord)
    }
    return { ...a, failed }
  })
})

const showAssertions = computed(
  () => run.value?.type === 'http' && assertionDefs.value.length > 0,
)
</script>

<template>
  <OPageLayout data-test="synthetics-protocol-run-detail" bleed>
    <template #header v-if="!drawerMode">
    <OPageHeader
      class=""
      :subtitle="run ? fmtTs(run.timestamp) : ''"
      :back="{
        label: t('synthetics.results.monitors'),
        to: { name: 'synthetic-monitor-results', params: { id: monitorId } },
        dataTest: 'synthetics-protocol-run-back-btn',
      }"
    >
      <template #title>
        <span data-test="synthetics-protocol-run-title">{{ run?.monitorName || '' }}</span>
      </template>
      <template #title-trail>
        <OBadge v-if="run" :variant="statusMeta.variant" size="sm" :icon="statusMeta.icon">
          {{ statusMeta.label }}
        </OBadge>
        <OBadge v-if="run" variant="default" size="sm">{{ run.type.toUpperCase() }}</OBadge>
        <OBadge v-if="run?.target" variant="default" size="sm" icon="link" class="truncate max-w-60">
          {{ run.target }}
        </OBadge>
      </template>
    </OPageHeader>
    </template>

    <div class="flex-1 min-h-0 overflow-y-auto px-page-edge py-4">
      <OSkeleton v-if="loading" class="h-80 w-full" />

      <OEmptyState
        v-else-if="!run"
        preset="no-data"
        :title="t('synthetics.protocolRun.notFound')"
      />

      <div v-else class="max-w-[53.75rem] flex flex-col gap-4">
        <!-- ── Result ── -->
        <div class="rounded-default border border-border-default">
          <div class="flex items-center border-b border-border-default py-2 px-3">
            <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
            <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolRun.result') }}</h3>
          </div>
          <div class="px-3 py-3 grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.status') }}</span>
              <span class="flex items-center gap-2">
                <OBadge :variant="statusMeta.variant" size="sm" :icon="statusMeta.icon">{{ statusMeta.label }}</OBadge>
                <OBadge v-if="run.errorClass" variant="default" size="sm">{{ run.errorClass }}</OBadge>
              </span>
            </div>
            <div v-if="run.statusCode != null" class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.statusCode') }}</span>
              <span class="text-sm font-medium">{{ run.statusCode }}</span>
            </div>
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.responseTime') }}</span>
              <span class="text-sm font-medium">{{ fmtMs(run.responseTimeMs) }}</span>
            </div>
            <div v-if="run.responseBytes != null" class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.responseSize') }}</span>
              <span class="text-sm font-medium">{{ fmtBytes(run.responseBytes) }}</span>
            </div>
            <div v-if="run.error" class="col-span-2 flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.error') }}</span>
              <span class="text-sm font-medium text-status-error-text break-all">{{ run.error }}</span>
            </div>
          </div>
        </div>

        <!-- ── Timing breakdown ── -->
        <div v-if="timingBars.length" class="rounded-default border border-border-default">
          <div class="flex items-center border-b border-border-default py-2 px-3">
            <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
            <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolRun.timings') }}</h3>
          </div>
          <div class="px-3 py-3 flex flex-col gap-2">
            <div v-for="bar in timingBars" :key="bar.phase" class="flex items-center gap-2">
              <span class="w-20 shrink-0 text-xs text-text-secondary">{{ t(`synthetics.protocolRun.phase.${bar.phase}`) }}</span>
              <div class="flex-1 h-3 rounded-default bg-surface-subtle overflow-hidden">
                <div
                  class="h-full rounded-default bg-accent"
                  :style="{ width: bar.pct + '%' }"
                />
              </div>
              <span class="w-[4.5rem] shrink-0 text-right text-xs text-text-secondary">{{ fmtMs(bar.ms) }}</span>
            </div>
            <div class="flex items-center gap-2 pt-1 border-t border-border-default">
              <span class="w-20 shrink-0 text-xs font-semibold text-text-body">{{ t('synthetics.protocolRun.phase.total') }}</span>
              <div class="flex-1" />
              <span class="w-[4.5rem] shrink-0 text-right text-xs font-semibold text-text-body">{{ fmtMs(run.totalMs) }}</span>
            </div>
          </div>
        </div>

        <!-- ── Assertions (http) ── -->
        <div v-if="showAssertions" class="rounded-default border border-border-default">
          <div class="flex items-center border-b border-border-default py-2 px-3">
            <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
            <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolRun.assertions') }}</h3>
            <OBadge
              class="ml-2"
              :variant="run.assertionsPassed === false ? 'error' : 'success'"
              size="sm"
            >
              {{ run.assertionsPassed === false ? t('synthetics.protocolRun.assertionsFailed') : t('synthetics.protocolRun.assertionsPassed') }}
            </OBadge>
          </div>
          <ul class="px-3 py-2 flex flex-col gap-1">
            <li
              v-for="(a, i) in assertionRows"
              :key="i"
              class="flex items-center gap-2 text-sm py-1"
              :data-test="`synthetics-protocol-run-assertion-${i}`"
            >
              <OBadge :variant="a.failed ? 'error' : 'success'" size="sm" :icon="a.failed ? 'cancel' : 'check-circle'" />
              <span class="font-mono text-xs">{{ a.field }} {{ a.operator }} {{ a.value }}</span>
            </li>
          </ul>
        </div>

        <!-- ── TLS certificate ── -->
        <div v-if="certExpiryDate" class="rounded-default border border-border-default">
          <div class="flex items-center border-b border-border-default py-2 px-3">
            <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
            <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolRun.tlsCert') }}</h3>
          </div>
          <div class="px-3 py-3 flex items-center gap-2 text-sm">
            <span>{{ t('synthetics.protocolRun.certExpires', { date: certExpiryDate }) }}</span>
            <OBadge
              v-if="certDaysRemaining != null"
              :variant="certDaysRemaining < 30 ? 'warning' : 'default'"
              size="sm"
            >
              {{ t('synthetics.protocolRun.daysRemaining', { days: certDaysRemaining }) }}
            </OBadge>
          </div>
        </div>

        <!-- ── Probe ── -->
        <div class="rounded-default border border-border-default">
          <div class="flex items-center border-b border-border-default py-2 px-3">
            <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
            <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.protocolRun.probe') }}</h3>
          </div>
          <div class="px-3 py-3 grid grid-cols-2 gap-3 text-sm">
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.location') }}</span>
              <span class="font-medium">{{ run.location || '—' }}</span>
            </div>
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.runtime') }}</span>
              <span class="font-medium">{{ run.runtime || '—' }} <span v-if="run.initMs" class="text-text-muted">(+{{ fmtMs(run.initMs) }} {{ t('synthetics.protocolRun.init') }})</span></span>
            </div>
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.probeId') }}</span>
              <span class="font-mono text-xs break-all">{{ run.probeId || '—' }}</span>
            </div>
            <div class="flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.trigger') }}</span>
              <span class="font-medium">{{ run.triggerType }}</span>
            </div>
            <div class="col-span-2 flex flex-col gap-1.5 p-3 rounded-default bg-surface-subtle">
              <span class="text-xs text-text-muted">{{ t('synthetics.protocolRun.timeline') }}</span>
              <span class="text-xs">
                {{ t('synthetics.protocolRun.scheduled') }} {{ fmtTs(run.scheduledTs) }}
                → {{ t('synthetics.protocolRun.started') }} {{ fmtTs(run.startedTs) }}
                → {{ t('synthetics.protocolRun.completed') }} {{ fmtTs(run.completedTs) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </OPageLayout>
</template>
