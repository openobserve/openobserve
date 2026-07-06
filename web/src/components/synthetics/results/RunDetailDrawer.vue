<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useStore } from 'vuex'
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import syntheticsService from '@/services/synthetics'

interface RunSummary {
  job_id: string
  synthetics_id: string
  location: string
  status: 'passed' | 'warning' | 'failed' | 'error'
  response_time_ms: number
  error?: string
  browser_engine?: string
  device?: string
  checked_at: number
  screenshot_refs: { step_id: string; key: string }[]
  trace_ref?: string
}

const props = defineProps<{
  run: RunSummary
  checkId: string
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const store = useStore()

const screenshots = computed(() =>
  props.run.screenshot_refs.map((r) => ({
    step_id: r.step_id,
    url: syntheticsService.artifactUrl(
      store.state.selectedOrganization.identifier,
      r.key,
    ),
  })),
)

const traceUrl = computed(() =>
  props.run.trace_ref
    ? syntheticsService.artifactUrl(
        store.state.selectedOrganization.identifier,
        props.run.trace_ref,
      )
    : null,
)

const statusVariant = computed(() => {
  if (props.run.status === 'passed') return 'success'
  if (props.run.status === 'warning') return 'warning'
  return 'error'
})
const statusLabel = computed(() => {
  const s = props.run.status
  if (s === 'passed') return 'Passed'
  if (s === 'warning') return 'Warning'
  if (s === 'error') return 'Error'
  return 'Failed'
})

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtTime(tsMicros: number) {
  const ms = tsMicros > 1e12 ? tsMicros / 1000 : tsMicros
  return new Date(ms).toLocaleString()
}
</script>

<template>
  <ODrawer
    :open="open"
    size="lg"
    title="Run Detail"
    :sub-title="fmtTime(run.checked_at)"
    @update:open="(v) => { if (!v) emit('close') }"
  >
    <template #header-right>
      <OBadge :variant="statusVariant" size="md">{{ statusLabel }}</OBadge>
    </template>

    <div class="tw:flex tw:flex-col tw:gap-6 tw:p-5">

      <!-- Meta grid -->
      <div class="tw:grid tw:grid-cols-2 tw:gap-x-8 tw:gap-y-4">
        <div>
          <p class="tw:text-[0.68rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1">Duration</p>
          <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-primary)]">{{ fmtDuration(run.response_time_ms) }}</p>
        </div>
        <div>
          <p class="tw:text-[0.68rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1">Location</p>
          <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-primary)]">{{ run.location || '—' }}</p>
        </div>
        <div v-if="run.browser_engine">
          <p class="tw:text-[0.68rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1">Browser</p>
          <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-primary)] tw:capitalize">{{ run.browser_engine }}</p>
        </div>
        <div v-if="run.device">
          <p class="tw:text-[0.68rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1">Device</p>
          <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-primary)]">{{ run.device }}</p>
        </div>
        <div class="tw:col-span-2">
          <p class="tw:text-[0.68rem] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-[var(--o2-text-muted)] tw:mb-1">Job ID</p>
          <p class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)] tw:break-all">{{ run.job_id }}</p>
        </div>
      </div>

      <!-- Error -->
      <div
        v-if="run.error"
        class="tw:rounded-lg tw:border tw:border-[var(--o2-status-error-border)] tw:bg-[var(--o2-status-error-subtle)] tw:p-4"
      >
        <div class="tw:flex tw:items-center tw:gap-1.5 tw:mb-2">
          <OIcon name="error" size="sm" class="tw:text-[var(--o2-status-error-text)] tw:shrink-0" />
          <p class="tw:text-sm tw:font-semibold tw:text-[var(--o2-status-error-text)]">Error</p>
        </div>
        <pre class="tw:whitespace-pre-wrap tw:font-mono tw:text-xs tw:text-[var(--o2-status-error-text)] tw:opacity-90 tw:leading-relaxed">{{ run.error }}</pre>
      </div>

      <!-- Screenshots -->
      <div>
        <p class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-3">Screenshots</p>

        <div v-if="screenshots.length" class="tw:flex tw:flex-col tw:gap-4">
          <div
            v-for="shot in screenshots"
            :key="shot.step_id"
            class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden"
          >
            <div class="tw:px-3 tw:py-2 tw:border-b tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-surface-secondary)]">
              <p class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)]">step {{ shot.step_id }}</p>
            </div>
            <img
              :src="shot.url"
              :alt="`Screenshot for step ${shot.step_id}`"
              class="tw:w-full tw:block tw:object-contain tw:max-h-80"
              loading="lazy"
            >
          </div>
        </div>

        <div
          v-else
          class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-12 tw:rounded-lg tw:border tw:border-dashed tw:border-[var(--o2-border-color)] tw:text-[var(--o2-text-muted)]"
        >
          <OIcon name="image" size="xl" />
          <p class="tw:text-sm">No screenshots captured for this run</p>
        </div>
      </div>

      <!-- Trace -->
      <div v-if="traceUrl">
        <p class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-3">Trace</p>
        <a
          :href="traceUrl"
          target="_blank"
          class="tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)]"
        >
          <OIcon name="download" size="sm" />
          Download trace.zip
        </a>
      </div>

    </div>
  </ODrawer>
</template>
