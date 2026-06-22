<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { onUnmounted, ref } from 'vue'
import type { BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import BrowserJourneyStep from './BrowserJourneyStep.vue'

const props = defineProps<{
  startUrl: string
}>()

const emit = defineEmits<{
  'done': [steps: BrowserStep[]]
  'skip': []
}>()

const recordPhase = ref<'setup' | 'recording'>('setup')
const extensionInstalled = ref(false)
const incognitoAllowed = ref(false)
const capturedSteps = ref<BrowserStep[]>([])
const recordingSeconds = ref(0)
const currentUrl = ref(props.startUrl)

let timerInterval: ReturnType<typeof setInterval> | null = null

function formatTime(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function installExtension() {
  extensionInstalled.value = true
}

function startRecording() {
  recordPhase.value = 'recording'

  // Start the recording timer
  timerInterval = setInterval(() => {
    recordingSeconds.value++
  }, 1000)

  // Simulate captured steps for demo purposes (real recorder integration is future work)
  setTimeout(() => {
    capturedSteps.value.push({
      id: crypto.randomUUID(),
      action: 'navigate',
      name: 'Open start URL',
      value: props.startUrl,
      timeout: 30000,
    })
  }, 500)

  setTimeout(() => {
    capturedSteps.value.push({
      id: crypto.randomUUID(),
      action: 'click',
      name: 'Click login button',
      selector: '#login-btn',
      selectorType: 'CSS',
      timeout: 30000,
    })
  }, 2000)

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
  }, 4000)
}

function stopRecording() {
  if (timerInterval !== null) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  emit('done', capturedSteps.value)
}

onUnmounted(() => {
  if (timerInterval !== null) {
    clearInterval(timerInterval)
  }
})
</script>

<template>
  <!-- Phase A: Setup gate -->
  <div
    v-if="recordPhase === 'setup'"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:min-h-screen tw:gap-6 tw:px-4"
  >
    <!-- Large icon box -->
    <div class="tw:rounded-2xl tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:flex tw:items-center tw:justify-center">
      <OIcon name="open_in_browser" size="xl" class="tw:text-[var(--o2-primary-color)]" />
    </div>

    <h1 class="tw:text-2xl tw:font-black tw:text-[var(--o2-text-heading)] tw:text-center tw:m-0">
      Record your journey
    </h1>

    <p class="tw:text-sm tw:text-[var(--o2-text-body)] tw:text-center tw:max-w-md tw:m-0">
      We'll open <strong>{{ startUrl }}</strong> in a fresh incognito tab and capture your clicks and inputs — no code. Finish the last two steps to start.
    </p>

    <!-- Two-step checklist card -->
    <div class="tw:w-full tw:max-w-lg tw:rounded-xl tw:border tw:border-[var(--o2-border-color)] tw:divide-y tw:divide-[var(--o2-border-color)]">
      <!-- Step 1 row -->
      <div class="tw:flex tw:items-start tw:gap-4 tw:p-4">
        <span class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)] tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold">
          1
        </span>
        <div class="tw:flex-1 tw:min-w-0">
          <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:mb-1">
            Install the OpenObserve Recorder
          </h4>
          <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">
            A lightweight Chrome extension that captures your actions.
          </p>
          <OButton
            variant="outline"
            size="sm"
            :disabled="extensionInstalled"
            data-test="synthetics-record-add-to-chrome-btn"
            @click="installExtension"
          >
            {{ extensionInstalled ? 'Installed' : 'Add to Chrome' }}
          </OButton>
        </div>
      </div>

      <!-- Step 2 row -->
      <div class="tw:flex tw:items-start tw:gap-4 tw:p-4" :class="{ 'tw:opacity-60': !extensionInstalled }">
        <span
          class="tw:flex-shrink-0 tw:w-7 tw:h-7 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:text-sm tw:font-semibold"
          :class="extensionInstalled
            ? 'tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)]'
            : 'tw:bg-[var(--o2-bg-subtle)] tw:text-[var(--o2-text-muted)]'"
        >
          2
        </span>
        <div class="tw:flex-1 tw:min-w-0">
          <h4 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0 tw:mb-1">
            Allow it in Incognito
          </h4>
          <p class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:m-0 tw:mb-3">
            Open <code>chrome://extensions</code> → Details → enable Allow in Incognito.
          </p>
          <OSwitch
            v-model="incognitoAllowed"
            label="Done"
            :disabled="!extensionInstalled"
            data-test="synthetics-record-incognito-switch"
          />
        </div>
      </div>
    </div>

    <!-- Primary CTA -->
    <OButton
      variant="primary"
      size="lg"
      class="tw:w-full tw:max-w-lg"
      :disabled="!extensionInstalled || !incognitoAllowed"
      data-test="synthetics-record-open-btn"
      @click="startRecording"
    >
      Open &amp; Record
    </OButton>

    <!-- Skip link -->
    <button
      type="button"
      class="tw:text-sm tw:text-[var(--o2-text-link)] tw:hover:text-[var(--o2-text-link-hover)] tw:underline tw:bg-transparent tw:border-0 tw:cursor-pointer tw:p-0"
      data-test="synthetics-record-skip-link"
      @click="emit('skip')"
    >
      Skip — I'll build the steps manually
    </button>
  </div>

  <!-- Phase B: Recording -->
  <div
    v-else
    class="tw:flex tw:flex-col tw:min-h-screen"
  >
    <!-- Top banner -->
    <div class="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-2 tw:bg-[var(--o2-status-error-subtle)] tw:border-b tw:border-[var(--o2-border-color)]">
      <!-- Red recording dot + label + timer -->
      <span class="tw:flex tw:items-center tw:gap-1.5">
        <span class="tw:w-2 tw:h-2 tw:rounded-full tw:bg-[var(--o2-status-error)] tw:animate-pulse tw:inline-block" aria-hidden="true" />
        <span class="tw:text-sm tw:font-semibold tw:text-[var(--o2-status-error)]">Recording</span>
        <span class="tw:font-mono tw:text-sm tw:text-[var(--o2-text-body)]">{{ formatTime(recordingSeconds) }}</span>
      </span>

      <!-- Current URL -->
      <span class="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-[var(--o2-text-secondary)] tw:truncate tw:flex-1 tw:min-w-0">
        <span class="material-icons-outlined tw:text-base tw:leading-none tw:shrink-0" aria-hidden="true">shield</span>
        <span class="tw:truncate">{{ currentUrl }}</span>
      </span>

      <!-- Actions -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:shrink-0">
        <OButton variant="ghost" size="sm">Pause</OButton>
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
      <span class="material-icons-outlined tw:text-base tw:leading-none tw:text-[var(--o2-text-muted)]" aria-hidden="true">open_in_new</span>
      <span class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:flex-1">Recording in a separate incognito window</span>
      <OButton variant="outline" size="sm">Show window</OButton>
    </div>

    <!-- Captured steps area -->
    <div class="tw:flex-1 tw:overflow-y-auto tw:p-4">
      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
        <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">Journey</h3>
        <span
          class="tw:text-xs tw:font-medium tw:bg-[var(--o2-status-error-subtle)] tw:text-[var(--o2-status-error)] tw:rounded-full tw:px-2 tw:py-0.5 tw:flex tw:items-center tw:gap-1"
        >
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

      <!-- Waiting for steps -->
      <div
        v-else
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:py-16 tw:text-center"
      >
        <span class="material-icons-outlined tw:text-5xl tw:text-[var(--o2-text-muted)] tw:animate-pulse" aria-hidden="true">fiber_manual_record</span>
        <p class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:m-0">Waiting for actions in the browser…</p>
      </div>
    </div>
  </div>
</template>
