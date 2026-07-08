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
  passed:  'text-green-600',
  warning: 'text-yellow-500',
  failed:  'text-red-500',
  error:   'text-orange-500',
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
        class="fixed inset-0 z-50 flex justify-end"
        @click.self="emit('close')"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40" @click="emit('close')" />

        <!-- Drawer panel -->
        <div class="relative z-10 w-full max-w-2xl h-full border-l border-[var(--o2-border-color)] flex flex-col overflow-hidden shadow-2xl" style="background: var(--o2-body-primary-bg, #18181b)">

          <!-- Header -->
          <div class="flex items-center gap-3 px-5 py-4 border-b border-[var(--o2-border-color)] shrink-0">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="material-symbols-outlined text-[var(--o2-text-muted)] text-base normal-case not-italic">
                {{ DEVICE_ICON[execution.device] ?? 'devices' }}
              </span>
              <span class="font-semibold text-[var(--o2-text-heading)] capitalize">
                {{ execution.browserEngine }} · {{ execution.device.replace(/_/g, ' ') }}
              </span>
              <span class="text-sm" :class="STATUS_COLOR[execution.status]">
                {{ execution.status.charAt(0).toUpperCase() + execution.status.slice(1) }}
              </span>
              <span class="text-xs text-[var(--o2-text-muted)]">{{ fmtDuration(execution.durationMs) }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <a
                v-if="execution.traceKey"
                :href="artifactUrlFn(execution.traceKey)"
                target="_blank"
                class="inline-flex items-center gap-1 text-xs font-medium text-[var(--o2-text-link)] border border-current rounded px-2 py-1 hover:opacity-80"
              >
                <OIcon name="download" size="xs" />
                trace.zip
              </a>
              <button
                class="p-1 rounded hover:bg-[var(--o2-surface-hover)] text-[var(--o2-text-muted)]"
                @click="emit('close')"
              >
                <OIcon name="close" size="sm" />
              </button>
            </div>
          </div>

          <!-- Error banner (probe crash) -->
          <div
            v-if="execution.error && !execution.steps.length"
            class="mx-5 mt-4 rounded border border-orange-500/30 bg-orange-500/10 px-4 py-3 shrink-0"
          >
            <p class="text-xs font-semibold text-orange-600 mb-1">Probe error</p>
            <p class="text-xs text-orange-600 font-mono whitespace-pre-wrap leading-relaxed">{{ execution.error }}</p>
          </div>

          <!-- Steps -->
          <div class="flex-1 overflow-y-auto px-5 py-4">
            <p v-if="!mergedSteps.length" class="text-xs text-[var(--o2-text-muted)] italic">
              No step data available.
            </p>

            <div v-else class="flex flex-col gap-3">
              <div
                v-for="(step, i) in mergedSteps"
                :key="step.stepId"
                class="rounded-lg border overflow-hidden"
                :class="step.status === 'fail' ? 'border-red-500/40' : 'border-[var(--o2-border-color)]'"
              >
                <!-- Step header -->
                <div
                  class="flex items-start gap-3 px-3 py-2.5"
                  :class="step.status === 'fail' ? 'bg-red-500/10' : 'bg-[var(--o2-surface-secondary)]'"
                >
                  <span
                    class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[0.6rem] font-bold mt-0.5"
                    :class="step.status === 'fail' ? 'bg-red-500' : 'bg-green-600'"
                  >{{ i + 1 }}</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-[var(--o2-text-heading)] truncate" :title="step.name">
                      {{ step.name || step.stepId }}
                    </p>
                    <p class="text-[0.65rem] text-[var(--o2-text-muted)] font-mono mt-0.5 truncate" :title="step.stepId">
                      {{ step.stepId }}
                    </p>
                  </div>
                  <span class="shrink-0 text-xs tabular-nums text-[var(--o2-text-muted)] mt-0.5">
                    {{ fmtDuration(step.durationMs) }}
                  </span>
                </div>

                <!-- Step error -->
                <div
                  v-if="step.error"
                  class="px-3 py-2 border-t border-red-500/20 bg-red-500/5"
                >
                  <p class="text-xs text-red-600 font-mono whitespace-pre-wrap leading-relaxed">{{ step.error }}</p>
                </div>

                <!-- Screenshot -->
                <div v-if="step.screenshotKey" class="border-t border-[var(--o2-border-color)]">
                  <a :href="artifactUrlFn(step.screenshotKey)" target="_blank" class="block">
                    <img
                      :src="artifactUrlFn(step.screenshotKey)"
                      :alt="`Step ${i + 1} screenshot`"
                      class="w-full object-contain max-h-64"
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
