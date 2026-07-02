<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { ref, watch } from 'vue'
import { useStore } from 'vuex'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import syntheticsService from '@/services/synthetics'

interface ScreenshotRef { step_id: string; key: string }

interface RunSummary {
  job_id: string
  synthetics_id: string
  location: string
  status: 'up' | 'warning' | 'down' | 'error'
  response_time_ms: number
  error?: string
  browser_engine?: string
  device?: string
  checked_at: number
}

interface FullRunResult extends RunSummary {
  pool: string
  screenshot_refs: ScreenshotRef[]
  trace_ref?: string
}

const props = defineProps<{
  run: RunSummary
  checkId: string
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const store = useStore()

const fullRun = ref<FullRunResult | null>(null)
const isLoadingDetail = ref(false)

watch(() => [props.open, props.run?.job_id] as const, async ([open, jobId]) => {
  if (!open || !jobId) return
  fullRun.value = null
  isLoadingDetail.value = true
  try {
    const org = store.state.selectedOrganization.identifier
    const res = await syntheticsService.getResult(org, props.checkId, jobId)
    fullRun.value = res.data as FullRunResult
  } catch {
    // fallback: show basic info without screenshots
  } finally {
    isLoadingDetail.value = false
  }
}, { immediate: true })

function screenshotSrc(stepId: string) {
  const org = store.state.selectedOrganization.identifier
  return syntheticsService.artifactUrl(org, props.checkId, props.run.job_id, 'screenshot', stepId)
}

function traceUrl() {
  const org = store.state.selectedOrganization.identifier
  return syntheticsService.artifactUrl(org, props.checkId, props.run.job_id, 'trace')
}

function statusVariant(status: RunSummary['status']) {
  return status === 'up' ? 'success' : 'error'
}

function statusLabel(status: RunSummary['status']) {
  if (status === 'up') return 'Passed'
  if (status === 'warning') return 'Warning'
  if (status === 'error') return 'Error'
  return 'Failed'
}

function fmtTime(tsMicros: number) {
  // checked_at from SQL composable is already ms epoch; from API it's microseconds
  const ms = tsMicros > 1e12 ? tsMicros / 1000 : tsMicros
  return new Date(ms).toLocaleString()
}

const display = {
  status: () => props.run.status,
  checkedAt: () => props.run.checked_at,
  durationMs: () => props.run.response_time_ms,
  location: () => props.run.location,
  error: () => props.run.error,
  browserEngine: () => props.run.browser_engine ?? fullRun.value?.browser_engine,
  device: () => props.run.device,
  screenshotRefs: () => fullRun.value?.screenshot_refs ?? [],
  traceRef: () => fullRun.value?.trace_ref,
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:justify-end">
        <!-- Backdrop -->
        <div class="tw:absolute tw:inset-0 tw:bg-black/40" @click="emit('close')" />

        <!-- Panel -->
        <div class="tw:relative tw:w-[520px] tw:max-w-full tw:h-full tw:bg-[var(--o2-body-primary-bg)] tw:shadow-2xl tw:flex tw:flex-col tw:overflow-hidden">
          <!-- Header -->
          <div class="tw:flex tw:items-center tw:gap-3 tw:px-5 tw:py-4 tw:border-b tw:border-[var(--o2-border-color)] tw:shrink-0">
            <OBadge :variant="statusVariant(display.status())" size="md">
              {{ statusLabel(display.status()) }}
            </OBadge>
            <span class="tw:text-sm tw:text-[var(--o2-text-secondary)]">{{ fmtTime(display.checkedAt()) }}</span>
            <button
              type="button"
              class="tw:ml-auto tw:p-1 tw:rounded tw:text-[var(--o2-text-secondary)] tw:hover:text-[var(--o2-text-body)] tw:bg-transparent tw:border-0 tw:cursor-pointer"
              aria-label="Close"
              @click="emit('close')"
            >
              <OIcon name="close" size="sm" />
            </button>
          </div>

          <!-- Body -->
          <div class="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:py-4 tw:space-y-5">
            <!-- Meta grid -->
            <div class="tw:grid tw:grid-cols-2 tw:gap-3 tw:text-sm">
              <div>
                <p class="tw:text-[var(--o2-text-label)] tw:text-xs tw:mb-0.5">Duration</p>
                <p class="tw:text-[var(--o2-text-body)] tw:font-medium">{{ display.durationMs().toFixed(0) }} ms</p>
              </div>
              <div>
                <p class="tw:text-[var(--o2-text-label)] tw:text-xs tw:mb-0.5">Location</p>
                <p class="tw:text-[var(--o2-text-body)] tw:font-medium">{{ display.location() }}</p>
              </div>
              <div v-if="display.browserEngine()">
                <p class="tw:text-[var(--o2-text-label)] tw:text-xs tw:mb-0.5">Browser</p>
                <p class="tw:text-[var(--o2-text-body)] tw:font-medium tw:capitalize">{{ display.browserEngine() }}</p>
              </div>
              <div v-if="display.device()">
                <p class="tw:text-[var(--o2-text-label)] tw:text-xs tw:mb-0.5">Device</p>
                <p class="tw:text-[var(--o2-text-body)] tw:font-medium">{{ display.device() }}</p>
              </div>
              <div class="tw:col-span-2">
                <p class="tw:text-[var(--o2-text-label)] tw:text-xs tw:mb-0.5">Job ID</p>
                <p class="tw:text-[var(--o2-text-body)] tw:font-mono tw:text-xs tw:break-all">{{ run.job_id }}</p>
              </div>
            </div>

            <!-- Error -->
            <div
              v-if="display.error()"
              class="tw:rounded tw:border tw:border-[var(--o2-status-error-border)] tw:bg-[var(--o2-status-error-subtle)] tw:p-3 tw:text-sm tw:text-[var(--o2-status-error-fg)]"
            >
              <p class="tw:font-medium tw:mb-1">Error</p>
              <pre class="tw:whitespace-pre-wrap tw:font-mono tw:text-xs">{{ display.error() }}</pre>
            </div>

            <!-- Screenshots loading -->
            <div v-if="isLoadingDetail" class="tw:flex tw:justify-center tw:py-6 tw:text-[var(--o2-text-muted)]">
              <OIcon name="refresh" size="lg" class="tw:animate-spin" />
            </div>

            <!-- Screenshots -->
            <template v-else>
              <div v-if="display.screenshotRefs().length" data-test="run-detail-screenshots">
                <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-body)] tw:mb-2">
                  Screenshots ({{ display.screenshotRefs().length }})
                </p>
                <div class="tw:space-y-3">
                  <div
                    v-for="ref in display.screenshotRefs()"
                    :key="ref.step_id"
                    class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden"
                  >
                    <p class="tw:text-xs tw:text-[var(--o2-text-label)] tw:px-3 tw:py-1.5 tw:border-b tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)]">
                      Step {{ ref.step_id }}
                    </p>
                    <img
                      :src="screenshotSrc(ref.step_id)"
                      :alt="`Screenshot step ${ref.step_id}`"
                      class="tw:w-full tw:block tw:object-contain tw:max-h-[360px] tw:bg-black/5"
                      loading="lazy"
                    >
                  </div>
                </div>
              </div>

              <div
                v-else
                class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-8 tw:text-[var(--o2-text-muted)] tw:text-sm"
              >
                <OIcon name="image" size="lg" />
                <p>No screenshots captured for this run</p>
              </div>

              <!-- Trace -->
              <div v-if="display.traceRef()">
                <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-body)] tw:mb-2">Trace</p>
                <a
                  :href="traceUrl()"
                  target="_blank"
                  class="tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)] tw:flex tw:items-center tw:gap-1"
                >
                  <OIcon name="download" size="sm" />
                  Download trace.zip
                </a>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
</style>
