<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import type { RunLocationResult, RecordedStep, StepResult } from '@/composables/synthetics/syntheticResultsSchema'

const { t } = useI18n()

const props = defineProps<{
  execution: RunLocationResult | null
  artifactUrlFn: (key: string) => string
}>()

const emit = defineEmits<{ close: [] }>()

const STATUS_COLOR: Record<string, string> = {
  passed:  'text-[var(--color-success-600)]',
  warning: 'text-[var(--color-warning-500)]',
  failed:  'text-[var(--color-error-500)]',
  error:   'text-[var(--color-warning-600)]',
}

const DEVICE_ICON: Record<string, string> = {
  desktop:      'laptop',
  tablet:       'tablet_mac',
  mobile:       'smartphone',
  // legacy ids — records created before the rename
  laptop_large: 'laptop',
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
    <Transition
      enter-active-class="transition-opacity duration-200 ease"
      leave-active-class="transition-opacity duration-200 ease"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="execution"
        class="fixed inset-0 z-50 flex justify-end"
        @click.self="emit('close')"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40" @click="emit('close')" />

        <!-- Drawer panel -->
        <div class="relative z-10 w-full max-w-2xl h-full border-l border-border-default flex flex-col overflow-hidden shadow-lg bg-surface-base">

          <!-- Header -->
          <div class="flex items-center gap-3 px-5 py-4 border-b border-border-default shrink-0">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="material-symbols-outlined text-text-muted text-base normal-case not-italic">
                {{ DEVICE_ICON[execution.device] ?? 'devices' }}
              </span>
              <span class="font-semibold text-text-heading capitalize">
                {{ execution.browserEngine }} · {{ execution.device.replace(/_/g, ' ') }}
              </span>
              <span class="text-sm" :class="STATUS_COLOR[execution.status]">
                {{ execution.status.charAt(0).toUpperCase() + execution.status.slice(1) }}
              </span>
              <span class="text-xs text-text-muted">{{ fmtDuration(execution.durationMs) }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <a
                v-if="execution.traceKey"
                :href="artifactUrlFn(execution.traceKey)"
                target="_blank"
                class="inline-flex items-center gap-1 text-xs font-medium text-text-link border border-current rounded-default px-2 py-1 hover:opacity-80"
              >
                <OIcon name="download" size="xs" />
                trace.zip
              </a>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                data-test="synthetics-execution-detail-close-btn"
                @click="emit('close')"
              />
            </div>
          </div>

          <!-- Error banner (probe crash) -->
          <div
            v-if="execution.error && !execution.steps.length"
            class="mx-5 mt-4 rounded-default border border-[var(--color-warning-500)]/30 bg-[var(--color-warning-500)]/10 px-4 py-3 shrink-0"
          >
            <p class="text-xs font-semibold text-[var(--color-warning-600)] mb-1">{{ t('synthetics.executionDetail.probeError') }}</p>
            <p class="text-xs text-[var(--color-warning-600)] font-mono whitespace-pre-wrap leading-relaxed">{{ execution.error }}</p>
          </div>

          <!-- Steps -->
          <div class="flex-1 overflow-y-auto px-5 py-4">
            <p v-if="!mergedSteps.length" class="text-xs text-text-muted italic">
              {{ t('synthetics.executionDetail.noStepData') }}
            </p>

            <div v-else class="flex flex-col gap-3">
              <div
                v-for="(step, i) in mergedSteps"
                :key="step.stepId"
                class="rounded-default border overflow-hidden"
                :class="step.status === 'fail' ? 'border-[var(--color-error-500)]/40' : 'border-border-default'"
              >
                <!-- Step header -->
                <div
                  class="flex items-start gap-3 px-3 py-2.5"
                  :class="step.status === 'fail' ? 'bg-[var(--color-error-500)]/10' : 'bg-surface-panel'"
                >
                  <span
                    class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-3xs font-bold mt-0.5"
                    :class="step.status === 'fail' ? 'bg-[var(--color-error-500)]' : 'bg-[var(--color-success-600)]'"
                  >{{ i + 1 }}</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-text-heading truncate" :title="step.name">
                      {{ step.name || step.stepId }}
                    </p>
                    <p class="text-3xs text-text-muted font-mono mt-0.5 truncate" :title="step.stepId">
                      {{ step.stepId }}
                    </p>
                  </div>
                  <span class="shrink-0 text-xs tabular-nums text-text-muted mt-0.5">
                    {{ fmtDuration(step.durationMs) }}
                  </span>
                </div>

                <!-- Step error -->
                <div
                  v-if="step.error"
                  class="px-3 py-2 border-t border-[var(--color-error-500)]/20 bg-[var(--color-error-500)]/5"
                >
                  <p class="text-xs text-[var(--color-error-600)] font-mono whitespace-pre-wrap leading-relaxed">{{ step.error }}</p>
                </div>

                <!-- Screenshot -->
                <div v-if="step.screenshotKey" class="border-t border-border-default">
                  <a :href="artifactUrlFn(step.screenshotKey)" target="_blank" class="block">
                    <img
                      :src="artifactUrlFn(step.screenshotKey)"
                      :alt="t('synthetics.runDetail.stepOf', { selected: i + 1, total: mergedSteps.length }) + ' ' + t('synthetics.runDetail.screenshotAlt')"
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
