<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import type { RunLocationResult, RecordedStep, StepResult } from '@/composables/synthetics/syntheticResultsSchema'

const props = defineProps<{
  execution: RunLocationResult | null
  artifactUrlFn: (key: string) => string
}>()

const emit = defineEmits<{ close: [] }>()

const STATUS_COLOR: Record<string, string> = {
  passed:  'tw:text-green-600',
  warning: 'tw:text-yellow-500',
  failed:  'tw:text-red-500',
  error:   'tw:text-orange-500',
}

const DEVICE_ICON: Record<string, string> = {
  laptop_large: 'laptop',
  tablet:       'tablet_mac',
  mobile_small: 'smartphone',
}

// Join recorded_steps (names) with last_attempt_steps (results) by step id
const mergedSteps = computed(() => {
  const ex = props.execution
  if (!ex) return []
  const nameMap = new Map<string, RecordedStep>(ex.recordedSteps.map((s) => [s.id, s]))
  if (ex.steps.length) {
    return ex.steps.map((s: StepResult) => ({
      ...s,
      name: nameMap.get(s.stepId)?.name ?? s.stepId,
      action: nameMap.get(s.stepId)?.action ?? '',
    }))
  }
  // Error execution — no step results, show recorded steps as pending
  return ex.recordedSteps.map((s) => ({
    stepId: s.id,
    name: s.name,
    action: s.action,
    status: 'fail' as const,
    durationMs: 0,
    error: '',
    screenshotKey: null,
  }))
})

function fmtDuration(ms: number) {
  if (!ms) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="execution"
        class="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:justify-end"
        @click.self="emit('close')"
      >
        <!-- Backdrop -->
        <div class="tw:absolute tw:inset-0 tw:bg-black/40" @click="emit('close')" />

        <!-- Drawer panel -->
        <div class="tw:relative tw:z-10 tw:w-full tw:max-w-2xl tw:h-full tw:border-l tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:overflow-hidden tw:shadow-2xl" style="background: var(--o2-body-primary-bg, #18181b)">

          <!-- Header -->
          <div class="tw:flex tw:items-center tw:gap-3 tw:px-5 tw:py-4 tw:border-b tw:border-[var(--o2-border-color)] tw:shrink-0">
            <div class="tw:flex tw:items-center tw:gap-2 tw:flex-1 tw:min-w-0">
              <span class="material-symbols-outlined tw:text-[var(--o2-text-muted)] tw:text-base tw:normal-case tw:not-italic">
                {{ DEVICE_ICON[execution.device] ?? 'devices' }}
              </span>
              <span class="tw:font-semibold tw:text-[var(--o2-text-heading)] tw:capitalize">
                {{ execution.browserEngine }} · {{ execution.device.replace(/_/g, ' ') }}
              </span>
              <span class="tw:text-sm" :class="STATUS_COLOR[execution.status]">
                {{ execution.status.charAt(0).toUpperCase() + execution.status.slice(1) }}
              </span>
              <span class="tw:text-xs tw:text-[var(--o2-text-muted)]">{{ fmtDuration(execution.durationMs) }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:shrink-0">
              <a
                v-if="execution.traceKey"
                :href="artifactUrlFn(execution.traceKey)"
                target="_blank"
                class="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:font-medium tw:text-[var(--o2-text-link)] tw:border tw:border-current tw:rounded tw:px-2 tw:py-1 hover:tw:opacity-80"
              >
                <OIcon name="download" size="xs" />
                trace.zip
              </a>
              <button
                class="tw:p-1 tw:rounded hover:tw:bg-[var(--o2-surface-hover)] tw:text-[var(--o2-text-muted)]"
                @click="emit('close')"
              >
                <OIcon name="close" size="sm" />
              </button>
            </div>
          </div>

          <!-- Error banner (probe crash) -->
          <div
            v-if="execution.error && !execution.steps.length"
            class="tw:mx-5 tw:mt-4 tw:rounded tw:border tw:border-orange-500/30 tw:bg-orange-500/10 tw:px-4 tw:py-3 tw:shrink-0"
          >
            <p class="tw:text-xs tw:font-semibold tw:text-orange-600 tw:mb-1">Probe error</p>
            <p class="tw:text-xs tw:text-orange-600 tw:font-mono tw:whitespace-pre-wrap tw:leading-relaxed">{{ execution.error }}</p>
          </div>

          <!-- Steps -->
          <div class="tw:flex-1 tw:overflow-y-auto tw:px-5 tw:py-4">
            <p v-if="!mergedSteps.length" class="tw:text-xs tw:text-[var(--o2-text-muted)] tw:italic">
              No step data available.
            </p>

            <div v-else class="tw:flex tw:flex-col tw:gap-3">
              <div
                v-for="(step, i) in mergedSteps"
                :key="step.stepId"
                class="tw:rounded-lg tw:border tw:overflow-hidden"
                :class="step.status === 'fail' ? 'tw:border-red-500/40' : 'tw:border-[var(--o2-border-color)]'"
              >
                <!-- Step header -->
                <div
                  class="tw:flex tw:items-start tw:gap-3 tw:px-3 tw:py-2.5"
                  :class="step.status === 'fail' ? 'tw:bg-red-500/10' : 'tw:bg-[var(--o2-surface-secondary)]'"
                >
                  <span
                    class="tw:shrink-0 tw:w-5 tw:h-5 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[0.6rem] tw:font-bold tw:mt-0.5"
                    :class="step.status === 'fail' ? 'tw:bg-red-500' : 'tw:bg-green-600'"
                  >{{ i + 1 }}</span>
                  <div class="tw:flex-1 tw:min-w-0">
                    <p class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-heading)] tw:truncate" :title="step.name">
                      {{ step.name || step.stepId }}
                    </p>
                    <p class="tw:text-[0.65rem] tw:text-[var(--o2-text-muted)] tw:font-mono tw:mt-0.5 tw:truncate" :title="step.stepId">
                      {{ step.stepId }}
                    </p>
                  </div>
                  <span class="tw:shrink-0 tw:text-xs tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:mt-0.5">
                    {{ fmtDuration(step.durationMs) }}
                  </span>
                </div>

                <!-- Step error -->
                <div
                  v-if="step.error"
                  class="tw:px-3 tw:py-2 tw:border-t tw:border-red-500/20 tw:bg-red-500/5"
                >
                  <p class="tw:text-xs tw:text-red-600 tw:font-mono tw:whitespace-pre-wrap tw:leading-relaxed">{{ step.error }}</p>
                </div>

                <!-- Screenshot -->
                <div v-if="step.screenshotKey" class="tw:border-t tw:border-[var(--o2-border-color)]">
                  <a :href="artifactUrlFn(step.screenshotKey)" target="_blank" class="tw:block">
                    <img
                      :src="artifactUrlFn(step.screenshotKey)"
                      :alt="`Step ${i + 1} screenshot`"
                      class="tw:w-full tw:object-contain tw:max-h-64"
                      loading="lazy"
                    />
                  </a>
                </div>
              </div>
            </div>
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
.drawer-enter-active .tw\:relative,
.drawer-leave-active .tw\:relative {
  transition: transform 0.25s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
</style>
