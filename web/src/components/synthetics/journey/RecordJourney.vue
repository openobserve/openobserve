<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onMounted, onUnmounted, ref } from 'vue'
import type { BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import BrowserJourneyStep from './BrowserJourneyStep.vue'

const props = defineProps<{
  startUrl: string
}>()

const emit = defineEmits<{
  'done': [steps: BrowserStep[]]
  'cancel': []
}>()

const capturedSteps = ref<BrowserStep[]>([])
const recordingSeconds = ref(0)
const currentUrl = ref(props.startUrl)

let timerInterval: ReturnType<typeof setInterval> | null = null
let stepTimeouts: ReturnType<typeof setTimeout>[] = []

function formatTime(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function stopRecording() {
  if (timerInterval !== null) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  emit('done', capturedSteps.value)
}

onMounted(() => {
  // Start timer
  timerInterval = setInterval(() => {
    recordingSeconds.value++
  }, 1000)

  // Simulate captured steps for demo purposes (real recorder integration is future work)
  stepTimeouts.push(
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: 'navigate',
        name: 'Open start URL',
        value: props.startUrl,
        timeout: 30000,
      })
    }, 500),
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: 'click',
        name: 'Click login button',
        selector: '#login-btn',
        selectorType: 'CSS',
        timeout: 30000,
      })
    }, 2000),
    setTimeout(() => {
      capturedSteps.value.push({
        id: crypto.randomUUID(),
        action: 'type',
        name: 'Enter username',
        selector: '#username',
        selectorType: 'CSS',
        value: 'user@example.com',
        timeout: 30000,
      })
    }, 4000),
  )
})

onUnmounted(() => {
  if (timerInterval !== null) clearInterval(timerInterval)
  stepTimeouts.forEach(clearTimeout)
})
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-screen">
    <!-- Recording banner -->
    <div class="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-2 tw:bg-[var(--o2-status-error-subtle)] tw:border-b tw:border-[var(--o2-border-color)]">
      <!-- Red dot + timer -->
      <span class="tw:flex tw:items-center tw:gap-1.5">
        <span class="tw:w-2 tw:h-2 tw:rounded-full tw:bg-[var(--o2-status-error)] tw:animate-pulse tw:inline-block" aria-hidden="true" />
        <span class="tw:text-sm tw:font-semibold tw:text-[var(--o2-status-error)]">Recording</span>
        <span class="tw:font-mono tw:text-sm tw:text-[var(--o2-text-body)]">{{ formatTime(recordingSeconds) }}</span>
      </span>

      <!-- Current URL -->
      <span class="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-[var(--o2-text-secondary)] tw:truncate tw:flex-1 tw:min-w-0">
        <OIcon name="shield" size="sm" class="tw:shrink-0" aria-hidden="true" />
        <span class="tw:truncate">{{ currentUrl }}</span>
      </span>

      <!-- Actions -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:shrink-0">
        <OButton variant="ghost" size="sm" @click="emit('cancel')">Cancel</OButton>
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-record-stop-btn"
          @click="stopRecording"
        >
          Stop &amp; Review
        </OButton>
      </div>
    </div>

    <!-- Info banner -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:border-b tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)]">
      <OIcon name="open-in-new" size="sm" class="tw:text-[var(--o2-text-muted)]" aria-hidden="true" />
      <span class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:flex-1">Recording in a separate incognito window</span>
      <OButton variant="outline" size="sm">Show window</OButton>
    </div>

    <!-- Captured steps -->
    <div class="tw:flex-1 tw:overflow-y-auto tw:p-4">
      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
        <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">Journey</h3>
        <span class="tw:text-xs tw:font-medium tw:bg-[var(--o2-status-error-subtle)] tw:text-[var(--o2-status-error)] tw:rounded-full tw:px-2 tw:py-0.5 tw:flex tw:items-center tw:gap-1">
          <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-status-error)] tw:animate-pulse tw:inline-block" aria-hidden="true" />
          capturing live
        </span>
        <span class="tw:text-sm tw:text-[var(--o2-text-muted)]">({{ capturedSteps.length }} steps)</span>
      </div>

      <!-- Live step list -->
      <div v-if="capturedSteps.length > 0" class="tw:flex tw:flex-col tw:gap-1">
        <BrowserJourneyStep
          v-for="(step, index) in capturedSteps"
          :key="step.id"
          :step="step"
          :index="index"
          :expanded="false"
          @update:step="capturedSteps[index] = $event"
          @update:expanded="() => {}"
          @delete="capturedSteps.splice(index, 1)"
          @duplicate="capturedSteps.splice(index + 1, 0, { ...step, id: crypto.randomUUID() })"
          @insert-below="() => {}"
        />
      </div>

      <!-- Waiting for first step -->
      <div
        v-else
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:py-16 tw:text-center"
      >
        <OIcon name="fiber-manual-record" size="xl" class="tw:text-[var(--o2-text-muted)] tw:animate-pulse" aria-hidden="true" />
        <p class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:m-0">Waiting for actions in the browser…</p>
      </div>
    </div>
  </div>
</template>
