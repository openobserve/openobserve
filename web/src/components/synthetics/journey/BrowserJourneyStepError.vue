<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * What the runner saw on a step that failed during replay.
 *
 * This card used to live in `BrowserJourneyStep.vue`. When that component was
 * replaced by `JourneySteps` + OTable the card was not carried across, so a failed
 * replay showed only a red dot and a journey-level banner: no message, no exit
 * reason, no duration, no failed selector. The evidence was already being computed
 * and thrown away (SE-4).
 *
 * It also renders the player's fidelity notes. X-8.2 requires the preview to say
 * per step what it cannot reproduce — ordered candidate fallback, settle, some
 * assertion kinds, an author-set timeout below 60 s, uploads, retired actions —
 * *"A step the player skipped MUST NOT render as a pass. Silent divergence is the
 * failure mode this whole section exists to prevent."* The extension emits them;
 * until now nothing displayed them.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { StepReplayResult } from "@/types/synthetics";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{
  result: StepReplayResult;
  /** Position in the journey, so "re-run to here" can name what it will run. */
  stepNumber?: number;
}>();

const emit = defineEmits<{ "retry-replay": [] }>();

const { t } = useI18n();

const se = computed(() => props.result.structuredError);

/** Map structuredError.name to an icon. */
const errorIconName = computed<string>(() => {
  switch (se.value?.name) {
    case "TimeoutError":
      return "timer-off";
    case "TargetClosedError":
      return "visibility-off";
    default:
      return "error";
  }
});

/** Map structuredError.name to a human label. */
const errorLabel = computed<string>(() => {
  switch (se.value?.name) {
    case "TimeoutError":
      return t("synthetics.stepErrors.timeout");
    case "TargetClosedError":
      return t("synthetics.stepErrors.tabClosed");
    default:
      return t("synthetics.stepErrors.default");
  }
});

/** Exit reason tag (e.g. "hit timeout", "tab closed"). */
const exitReasonTag = computed<string>(() => {
  const name = se.value?.name;
  if (name === "TimeoutError") return t("synthetics.stepErrors.hitTimeout");
  if (name === "TargetClosedError") return t("synthetics.stepErrors.tabClosedReason");
  return t("synthetics.stepErrors.exitReason");
});

const durationFormatted = computed(() => `${((props.result.durationMs ?? 0) / 1000).toFixed(1)} s`);

/** X-8.2 divergence notes, if the player reported any for this step. */
const fidelityNotes = computed(() => props.result.fidelity?.notes ?? []);
</script>

<template>
  <div
    class="border-badge-error-ol-border/30 rounded-default overflow-hidden border"
    data-test="synthetics-journey-step-error-card"
  >
    <div class="flex items-center gap-2 bg-[var(--color-badge-error-soft-bg)] px-3 py-2">
      <OIcon :name="errorIconName" size="sm" class="text-status-error-text" aria-hidden="true" />
      <span class="text-text-heading flex-1 text-xs font-semibold">{{ errorLabel }}</span>
      <span class="text-text-secondary font-mono text-xs">
        {{ exitReasonTag }} · {{ durationFormatted }}
      </span>
    </div>

    <div class="px-3 py-3">
      <p class="text-text-body m-0 text-xs" data-test="synthetics-journey-step-error-message">
        {{ se?.message || result.error }}
      </p>
    </div>

    <!-- The element the runner could not act on, and how long it waited. -->
    <div v-if="se?.selector" class="flex gap-4 px-3 pb-3">
      <div class="flex flex-col gap-1">
        <span class="text-2xs text-text-label font-medium">
          {{ t("synthetics.stepErrors.selectorTestId") }}
        </span>
        <span
          class="text-status-error-text font-mono text-xs"
          data-test="synthetics-journey-step-error-selector"
          >{{ se.selector }}</span
        >
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-2xs text-text-label font-medium">
          {{ t("synthetics.stepErrors.waited") }}
        </span>
        <span class="text-text-secondary font-mono text-xs">
          {{ durationFormatted }} · {{ exitReasonTag }}
        </span>
      </div>
    </div>

    <!-- X-8.2: what the preview could not reproduce. Silence here is the failure
         mode the requirement exists to prevent. -->
    <div
      v-if="fidelityNotes.length"
      class="px-3 pb-3"
      data-test="synthetics-journey-step-fidelity"
    >
      <span class="text-2xs text-text-label font-medium">
        {{ t("synthetics.journey.fidelityLabel") }}
      </span>
      <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
        <li
          v-for="note in fidelityNotes"
          :key="note"
          class="text-text-secondary flex items-start gap-1 text-xs"
        >
          <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{{ note }}</span>
        </li>
      </ul>
    </div>

    <div class="flex items-center gap-2 px-3 pb-3">
      <OButton
        variant="outline"
        size="xs"
        icon-left="replay"
        data-test="synthetics-journey-error-retry-btn"
        @click="emit('retry-replay')"
      >
        {{
          stepNumber
            ? t("synthetics.journey.reRunToHere", { step: stepNumber })
            : t("synthetics.journey.reRun")
        }}
      </OButton>
    </div>
  </div>
</template>
