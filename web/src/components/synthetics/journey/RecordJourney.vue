<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserStep } from "@/types/synthetics";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import BrowserJourneyStep from "./BrowserJourneyStep.vue";

const { t } = useI18n();

const props = defineProps<{
  startUrl: string;
}>();

const emit = defineEmits<{
  done: [steps: BrowserStep[]];
  cancel: [];
}>();

const capturedSteps = ref<BrowserStep[]>([]);
// template-invokable id generator (script scope resolves the global crypto)
const genId = () => crypto.randomUUID();
const recordingSeconds = ref(0);
const currentUrl = ref(props.startUrl);

let timerInterval: ReturnType<typeof setInterval> | null = null;
let stepTimeouts: ReturnType<typeof setTimeout>[] = [];

function formatTime(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function stopRecording() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  emit("done", capturedSteps.value);
}

onMounted(() => {
  // Start timer
  timerInterval = setInterval(() => {
    recordingSeconds.value++;
  }, 1000);

  // Simulate captured steps for demo purposes (real recorder integration is future work)
  stepTimeouts.push(
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: "navigate",
        name: "Open start URL",
        value: props.startUrl,
        timeout: 30000,
        code: "",
      });
    }, 500),
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: "click",
        name: "Click login button",
        selector: "#login-btn",
        selectorType: "CSS",
        timeout: 30000,
        code: "",
      });
    }, 2000),
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: "type",
        name: "Enter username",
        selector: "#username",
        selectorType: "CSS",
        value: "user@example.com",
        timeout: 30000,
        code: "",
      });
    }, 4000),
  );
});

onUnmounted(() => {
  if (timerInterval !== null) clearInterval(timerInterval);
  stepTimeouts.forEach(clearTimeout);
});
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <!-- Recording banner -->
    <div
      class="flex items-center gap-3 px-4 py-2 bg-status-error-bg border-b border-border-default"
    >
      <!-- Red dot + timer -->
      <span class="flex items-center gap-1.5">
        <span
          class="w-2 h-2 rounded-full bg-[var(--color-status-error-text)] animate-pulse inline-block"
          aria-hidden="true"
        />
        <span class="text-sm font-semibold text-status-error-text">{{
          t("synthetics.journey.recording")
        }}</span>
        <span class="font-mono text-sm text-text-body">{{ formatTime(recordingSeconds) }}</span>
      </span>

      <!-- Current URL -->
      <span class="flex items-center gap-1 text-xs text-text-secondary truncate flex-1 min-w-0">
        <OIcon name="shield" size="sm" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ currentUrl }}</span>
      </span>

      <!-- Actions -->
      <div class="flex items-center gap-2 shrink-0">
        <OButton variant="ghost" size="sm" @click="emit('cancel')">{{
          t("synthetics.journey.cancel")
        }}</OButton>
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-record-stop-btn"
          @click="stopRecording"
        >
          {{ t("synthetics.journey.stopAndReview") }}
        </OButton>
      </div>
    </div>

    <!-- Info banner -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-border-default bg-surface-base">
      <OIcon name="open-in-new" size="sm" class="text-text-muted" aria-hidden="true" />
      <span class="text-xs text-text-secondary flex-1">{{
        t("synthetics.journey.recordingIncognitoInfo")
      }}</span>
      <OButton variant="outline" size="sm">{{ t("synthetics.journey.showWindow") }}</OButton>
    </div>

    <!-- Captured steps -->
    <div class="flex-1 overflow-y-auto p-4">
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-base font-semibold text-text-heading m-0">
          {{ t("synthetics.journey.journeyHeading") }}
        </h3>
        <span
          class="text-xs font-medium bg-status-error-bg text-status-error-text rounded-full px-2 py-0.5 flex items-center gap-1"
        >
          <span
            class="w-1.5 h-1.5 rounded-full bg-[var(--color-status-error-text)] animate-pulse inline-block"
            aria-hidden="true"
          />
          {{ t("synthetics.journey.capturingLive") }}
        </span>
        <span class="text-sm text-text-muted">{{
          t("synthetics.journey.stepCount", { count: capturedSteps.length })
        }}</span>
      </div>

      <!-- Live step list -->
      <div v-if="capturedSteps.length > 0" class="flex flex-col gap-1">
        <BrowserJourneyStep
          v-for="(step, index) in capturedSteps"
          :key="step.id"
          :step="step"
          :index="index"
          :expanded="false"
          @update:step="capturedSteps[index] = $event"
          @update:expanded="() => {}"
          @delete="capturedSteps.splice(index, 1)"
          @duplicate="capturedSteps.splice(index + 1, 0, { ...step, id: genId() })"
          @insert-below="() => {}"
        />
      </div>

      <!-- Waiting for first step -->
      <div v-else class="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <OIcon
          name="fiber-manual-record"
          size="xl"
          class="text-text-muted animate-pulse"
          aria-hidden="true"
        />
        <p class="text-sm text-text-secondary m-0">
          {{ t("synthetics.journey.waitingForActions") }}
        </p>
      </div>
    </div>
  </div>
</template>
