<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type {
  RunLocationResult,
  RecordedStep,
  StepResult,
} from "@/composables/synthetics/syntheticResultsSchema";

const { t } = useI18n();

const props = defineProps<{
  execution: RunLocationResult | null;
  artifactUrlFn: (key: string) => string;
}>();

const emit = defineEmits<{ close: [] }>();

const STATUS_COLOR: Record<string, string> = {
  passed: "text-[var(--color-success-600)]",
  warning: "text-[var(--color-warning-500)]",
  failed: "text-[var(--color-error-500)]",
  error: "text-[var(--color-warning-600)]",
};

const DEVICE_ICON: Record<string, string> = {
  desktop: "laptop",
  tablet: "tablet_mac",
  mobile: "smartphone",
  // legacy ids — records created before the rename
  laptop_large: "laptop",
  mobile_small: "smartphone",
};

// Join recorded_steps (names) with last_attempt_steps (results) by step id
const mergedSteps = computed(() => {
  const ex = props.execution;
  if (!ex) return [];
  const nameMap = new Map<string, RecordedStep>(ex.recordedSteps.map((s) => [s.id, s]));
  if (ex.steps.length) {
    return ex.steps.map((s: StepResult) => ({
      ...s,
      name: nameMap.get(s.stepId)?.name ?? s.stepId,
      action: nameMap.get(s.stepId)?.action ?? "",
    }));
  }
  // Error execution — no step results, show recorded steps as pending
  return ex.recordedSteps.map((s) => ({
    stepId: s.id,
    name: s.name,
    action: s.action,
    status: "fail" as const,
    durationMs: 0,
    error: "",
    screenshotKey: null,
  }));
});

function fmtDuration(ms: number) {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
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
      <div v-if="execution" class="fixed inset-0 z-50 flex justify-end" @click.self="emit('close')">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40" @click="emit('close')" />

        <!-- Drawer panel -->
        <div
          class="border-border-default bg-surface-base relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l shadow-lg"
        >
          <!-- Header -->
          <div class="border-border-default flex shrink-0 items-center gap-3 border-b px-5 py-4">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <span
                class="material-symbols-outlined text-text-muted text-base normal-case not-italic"
              >
                {{ DEVICE_ICON[execution.device] ?? "devices" }}
              </span>
              <span class="text-text-heading font-semibold capitalize">
                {{ execution.browserEngine }} · {{ execution.device.replace(/_/g, " ") }}
              </span>
              <span class="text-sm" :class="STATUS_COLOR[execution.status]">
                {{ execution.status.charAt(0).toUpperCase() + execution.status.slice(1) }}
              </span>
              <span class="text-text-muted text-xs">{{ fmtDuration(execution.durationMs) }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <a
                v-if="execution.traceKey"
                :href="artifactUrlFn(execution.traceKey)"
                target="_blank"
                class="text-text-link rounded-default inline-flex items-center gap-1 border border-current px-2 py-1 text-xs font-medium hover:opacity-80"
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
            class="rounded-default mx-5 mt-4 shrink-0 border border-[var(--color-warning-500)]/30 bg-[var(--color-warning-500)]/10 px-4 py-3"
          >
            <p class="mb-1 text-xs font-semibold text-[var(--color-warning-600)]">
              {{ t("synthetics.executionDetail.probeError") }}
            </p>
            <p
              class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-warning-600)]"
            >
              {{ execution.error }}
            </p>
          </div>

          <!-- Steps -->
          <div class="flex-1 overflow-y-auto px-5 py-4">
            <p v-if="!mergedSteps.length" class="text-text-muted text-xs italic">
              {{ t("synthetics.executionDetail.noStepData") }}
            </p>

            <div v-else class="flex flex-col gap-3">
              <div
                v-for="(step, i) in mergedSteps"
                :key="step.stepId"
                class="rounded-default overflow-hidden border"
                :class="
                  step.status === 'fail'
                    ? 'border-[var(--color-error-500)]/40'
                    : 'border-border-default'
                "
              >
                <!-- Step header -->
                <div
                  class="flex items-start gap-3 px-3 py-2.5"
                  :class="
                    step.status === 'fail' ? 'bg-[var(--color-error-500)]/10' : 'bg-surface-panel'
                  "
                >
                  <span
                    class="text-3xs mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-white"
                    :class="
                      step.status === 'fail'
                        ? 'bg-[var(--color-error-500)]'
                        : 'bg-[var(--color-success-600)]'
                    "
                    >{{ i + 1 }}</span
                  >
                  <div class="min-w-0 flex-1">
                    <p class="text-text-heading truncate text-sm font-medium" :title="step.name">
                      {{ step.name || step.stepId }}
                    </p>
                    <p
                      class="text-3xs text-text-muted mt-0.5 truncate font-mono"
                      :title="step.stepId"
                    >
                      {{ step.stepId }}
                    </p>
                  </div>
                  <span class="text-text-muted mt-0.5 shrink-0 text-xs tabular-nums">
                    {{ fmtDuration(step.durationMs) }}
                  </span>
                </div>

                <!-- Step error -->
                <div
                  v-if="step.error"
                  class="border-t border-[var(--color-error-500)]/20 bg-[var(--color-error-500)]/5 px-3 py-2"
                >
                  <p
                    class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-error-600)]"
                  >
                    {{ step.error }}
                  </p>
                </div>

                <!-- Screenshot -->
                <div v-if="step.screenshotKey" class="border-border-default border-t">
                  <a :href="artifactUrlFn(step.screenshotKey)" target="_blank" class="block">
                    <img
                      :src="artifactUrlFn(step.screenshotKey)"
                      :alt="
                        t('synthetics.runDetail.stepOf', {
                          selected: i + 1,
                          total: mergedSteps.length,
                        }) +
                        ' ' +
                        t('synthetics.runDetail.screenshotAlt')
                      "
                      class="max-h-64 w-full object-contain"
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
