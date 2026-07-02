<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { BrowserStep, ReplayPhase, StepReplayResult } from '@/types/synthetics'
import type { StepDotState } from './BrowserJourneyStep.vue'
import useSyntheticsRecorder from '@/composables/useSyntheticsRecorder'
import { getUUIDv7 } from '@/utils/zincutils'
import { VueDraggableNext } from 'vue-draggable-next'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue'
import BrowserJourneyStep from './BrowserJourneyStep.vue'

const props = defineProps<{
  modelValue: BrowserStep[]
  readonly?: boolean
  startUrl?: string        // URL shown in the recording banner
  extensionReady?: boolean // when false, Record button triggers need-extension-setup
  autoRecord?: boolean     // if true, start recording immediately on mount
  /** Owned by the parent (CreateBrowserTest). */
  replayPhase?: ReplayPhase
  /** Per-step replay results, keyed by step id. Owned by the parent. */
  stepResults?: Map<string, StepReplayResult>
  /** When true, show the incognito blocked warning in the toolbar area. */
  blockedReason?: 'incognito' | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BrowserStep[]]
  'need-extension-setup': []
  'replay': []
  'stop-replay': []
  'auto-record-consumed': []
  'selection-changed': [{ count: number; isRecording: boolean }]
}>()

// ── Filter / expand state ──────────────────────────────────────────────────
const filterQuery = ref('')
const expandedSteps = ref<Set<string>>(new Set())

// ── Drag-and-drop ──────────────────────────────────────────────────────────
const stepsModel = ref<BrowserStep[]>([...props.modelValue])
const dragActive = ref(false)

// Sync from parent mutations (add, delete, recording stop, etc.)
// Suppressed during drag to prevent watcher from overwriting the reorder.
watch(() => props.modelValue, (val) => {
  if (dragActive.value) return
  stepsModel.value = [...val]
})

// ── Replay helpers ──────────────────────────────────────────────────────────
const isReplayRunning = computed(() => props.replayPhase === 'running')
const isReplayActive = computed(() => props.replayPhase && props.replayPhase !== 'idle')
const isReplayTerminal = computed(() =>
  props.replayPhase === 'passed' || props.replayPhase === 'failed' || props.replayPhase === 'stopped'
)
const isReplayLocked = computed(() => isReplayRunning.value) // editing suppressed during running

/** Derive the status dot state for a step based on replay results. */
function stepDotState(stepId: string): StepDotState | undefined {
  if (!isReplayActive.value || !props.replayPhase) return undefined
  const result = props.stepResults?.get(stepId)
  if (result) {
    return result.passed ? 'pass' : 'fail'
  }
  // No result yet — is this step before or after the failed step?
  // Find the first failing step in journey order
  const firstFailedIndex = props.modelValue.findIndex((s) => {
    const r = props.stepResults?.get(s.id)
    return r && !r.passed
  })
  const stepIndex = props.modelValue.findIndex((s) => s.id === stepId)

  if (firstFailedIndex >= 0 && stepIndex > firstFailedIndex) return 'skip'
  if (props.replayPhase === 'running') return 'pending'
  return 'pending'
}

const dragDisabled = computed(() =>
  isRecording.value || isReplayActive.value || props.readonly || !!filterQuery.value.trim()
)

function onDragStart() {
  dragActive.value = true
}

function onDragEnd() {
  dragActive.value = false
  console.log(" steps after drag ----", JSON.parse(JSON.stringify(stepsModel.value)));
  emit('update:modelValue', [...stepsModel.value])
}

// ── Multi-select ───────────────────────────────────────────────────────────
const selectedStepIds = ref<Set<string>>(new Set())

const selectedCount = computed(() => selectedStepIds.value.size)

const allSelected = computed(() =>
  props.modelValue.length > 0 && props.modelValue.every((s) => selectedStepIds.value.has(s.id))
)

const isIndeterminate = computed(() => {
  const count = props.modelValue.filter((s) => selectedStepIds.value.has(s.id)).length
  return count > 0 && count < props.modelValue.length
})

const selectAllModel = computed<boolean | 'indeterminate'>(() =>
  allSelected.value ? true : isIndeterminate.value ? 'indeterminate' : false
)

function toggleStepSelection(id: string) {
  const next = new Set(selectedStepIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedStepIds.value = next
}

function toggleSelectAll() {
  selectedStepIds.value = allSelected.value || isIndeterminate.value
    ? new Set()
    : new Set(props.modelValue.map((s) => s.id))
}

function deleteSelectedSteps() {
  const ids = selectedStepIds.value
  emit('update:modelValue', props.modelValue.filter((s) => !ids.has(s.id)))
  selectedStepIds.value = new Set()
}

// Clear selection when the step list changes, filter changes, or replay starts
watch(() => props.modelValue.length, () => { selectedStepIds.value = new Set() })
watch(filterQuery, () => { selectedStepIds.value = new Set() })
watch(() => props.replayPhase, (phase) => {
  if (phase === 'running') selectedStepIds.value = new Set()
})

const multiSelectEnabled = computed(() =>
  !isRecording.value && !props.readonly && !isReplayRunning.value
)


// ── Recording state ────────────────────────────────────────────────────────
// All Chrome-extension messaging lives in the composable; this component only
// reflects its reactive state and merges the result into the journey on stop.
const recorder = useSyntheticsRecorder()
const isRecording = recorder.isRecording
const capturedSteps = recorder.liveSteps
const externalStopSteps = recorder.externalStopSteps
const currentUrl = recorder.currentUrl
const recordingError = recorder.error

// Emit selection state changes for the parent's sticky footer
watch([selectedCount, isRecording], ([count, recording]) => {
  emit('selection-changed', { count, isRecording: recording })
})

// Expose selection state for the parent's sticky footer
defineExpose({ selectedCount, isRecording, deleteSelectedSteps })

function startRecording() {
  recorder.startRecording(props.startUrl ?? '').catch((err) => {
    console.log("error ---", err);
    recorder.error.value = err instanceof Error ? err.message : String(err)
  })
}

async function stopRecording() {
  const steps = await recorder.stopRecording()
  if (steps.length > 0) emit('update:modelValue', [...props.modelValue, ...steps])
}

function cancelRecording() {
  recorder.cancelRecording()
}

function onRecordButtonClick() {
  if (props.extensionReady) {
    startRecording()
  } else {
    emit('need-extension-setup')
  }
}

onMounted(() => {
  if (props.autoRecord) {
    startRecording()
    emit('auto-record-consumed')
  }
})

// Justified watcher: auto-commit steps when the extension window is closed
// externally (without clicking Stop & Review). Uses externalStopSteps, which is
// snapshotted inside the composable at the exact moment recordingStopped /
// port.onDisconnect fires — immune to subsequent setActions([]) cleanup messages
// the extension may send after stopping. cancelRecording() clears the snapshot,
// so this watcher is a no-op for explicit cancels.
watch(isRecording, (nowRecording, wasRecording) => {
  if (!nowRecording && wasRecording && externalStopSteps.value.length > 0) {
    emit('update:modelValue', [...props.modelValue, ...externalStopSteps.value])
    externalStopSteps.value = []
  }
})

onUnmounted(() => recorder.cleanup())

// ── Step list (single flat list — one journey, one start URL) ───────────────
const filteredSteps = computed<{ step: BrowserStep; originalIndex: number }[]>(() => {
  const indexed = props.modelValue.map((step, originalIndex) => ({ step, originalIndex }))
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return indexed
  return indexed.filter(({ step }) =>
    (step.name?.toLowerCase().includes(q)) ||
    step.action.toLowerCase().includes(q) ||
    (step.selector?.toLowerCase().includes(q)) ||
    (step.value?.toLowerCase().includes(q))
  )
})

const allExpanded = computed(() =>
  props.modelValue.length > 0 && props.modelValue.every((s) => expandedSteps.value.has(s.id))
)

function toggleExpandAll() {
  expandedSteps.value = allExpanded.value ? new Set() : new Set(props.modelValue.map((s) => s.id))
}

function isStepExpanded(id: string) { return expandedSteps.value.has(id) }

function setStepExpanded(id: string, val: boolean) {
  const next = new Set(expandedSteps.value)
  val ? next.add(id) : next.delete(id)
  expandedSteps.value = next
}

function updateStep(index: number, updated: BrowserStep) {
  const next = [...props.modelValue]; 
  next[index] = updated; 
  emit('update:modelValue', next)
}
function deleteStep(index: number) {
  const next = [...props.modelValue]; next.splice(index, 1); emit('update:modelValue', next)
}
function duplicateStep(index: number) {
  const next = [...props.modelValue]
  next.splice(index + 1, 0, { ...next[index], id: getUUIDv7(true) })
  emit('update:modelValue', next)
}
function insertStepBelow(index: number) {
  const next = [...props.modelValue]
  next.splice(index + 1, 0, { id: getUUIDv7(true), action: 'click', name: '', timeout: 30000 })
  emit('update:modelValue', next)
}
function addStep() {
  emit('update:modelValue', [...props.modelValue, { id: getUUIDv7(true), action: 'click', name: '', timeout: 30000 }])
}
function duplicateCapturedStep(index: number, step: BrowserStep) {
  capturedSteps.value.splice(index + 1, 0, { ...step, id: getUUIDv7(true) })
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-0 tw:w-full tw:p-2">

    <!-- Toolbar — no-layout-shift design: fluid search + fixed w-80 action area -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3 tw:pl-3">
      <!-- Select-all — visibility:hidden during replay to preserve layout -->
      <OCheckbox
        :model-value="selectAllModel"
        size="xs"
        :class="{ 'tw:invisible': isRecording || readonly || isReplayActive }"
        data-test="synthetics-journey-select-all"
        @update:model-value="toggleSelectAll"
      />
      <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mr-0">Steps</h3>
      <OBadge variant="default" size="sm">{{ modelValue.length }}</OBadge>
      <OInput
        v-model="filterQuery"
        placeholder="Filter steps..."
        class="tw:flex-1 tw:min-w-[8rem]!"
        data-test="synthetics-journey-filter-input"
      />
      <!-- Fixed-width action area — buttons right-aligned, widest set (Add Step + Record + Replay/Stop) fits in 320px -->
      <div class="tw:w-80 tw:flex tw:items-center tw:gap-2 tw:justify-end">
        <OButton
          v-if="!isRecording && !isReplayRunning"
          variant="outline"
          size="sm"
          :disabled="readonly || isRecording"
          data-test="synthetics-journey-add-step-btn"
          @click="addStep"
          icon-left="add"
        >
          Add Step
        </OButton>

        <!-- Run replay / Stop / Re-run — positionally stable, same slot -->
        <template v-if="!isRecording">
          <OButton
            v-if="replayPhase === 'idle'"
            variant="outline"
            size="sm"
            :disabled="readonly || modelValue.length === 0"
            data-test="synthetics-journey-replay-btn"
            @click="emit('replay')"
            icon-left="replay"
          >
            Run replay
          </OButton>
          <OButton
            v-else-if="replayPhase === 'running'"
            variant="destructive"
            size="sm"
            data-test="synthetics-journey-stop-replay-btn"
            @click="emit('stop-replay')"
            icon-left="stop"
          >
            Stop
          </OButton>
          <OButton
            v-else-if="isReplayTerminal"
            variant="outline"
            size="sm"
            data-test="synthetics-journey-replay-btn"
            @click="emit('replay')"
            icon-left="replay"
          >
            Re-run
          </OButton>
        </template>

        <OButton
          v-if="isRecording"
          variant="outline"
          size="sm"
          data-test="synthetics-journey-cancel-btn"
          @click="cancelRecording"
        >
          Cancel
        </OButton>

        <OButton
          v-if="isRecording"
          variant="destructive"
          size="sm"
          data-test="synthetics-journey-stop-btn"
          @click="stopRecording"
          icon-left="stop"
          class="tw:w-24!"
        >
          Stop
        </OButton>
        <OButton
          v-else
          variant="primary"
          size="sm"
          :disabled="readonly || isRecording || isReplayRunning"
          data-test="synthetics-journey-record-btn"
          @click="onRecordButtonClick"
          icon-left="smart-display"
          class="tw:w-24!"
        >
          Record
        </OButton>
      </div>
    </div>

    <!-- Replay running banner -->
    <div
      v-if="replayPhase === 'running' || true"
      class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:mb-3 tw:rounded tw:bg-[var(--o2-primary-50)] tw:border tw:border-[var(--o2-primary-200)]"
      role="status"
      data-test="synthetics-journey-replay-banner"
    >
      <OIcon name="sync" size="sm" class="tw:animate-spin tw:text-[var(--o2-primary-color)]" aria-hidden="true" />
      <span
        class="tw:text-sm tw:text-[var(--o2-text-heading)]"
        data-test="synthetics-journey-replay-banner-text"
      >
        Replaying…
      </span>
      <span class="tw:text-sm tw:text-[var(--o2-text-secondary)]">
        {{ stepResults?.size ?? 0 }} of {{ modelValue.length }} steps
      </span>
    </div>

    <!-- Recorder error (extension missing / failed to start) -->
    <div
      v-if="recordingError && !isRecording"
      class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:mb-3 tw:rounded tw:bg-[var(--o2-status-error-subtle)] tw:text-[var(--o2-status-error)] tw:text-sm"
      role="alert"
      data-test="synthetics-journey-record-error"
    >
      <OIcon name="error" size="sm" aria-hidden="true" />
      <span>{{ recordingError }}</span>
    </div>

    <!-- Live capture area (shown while recording) -->
    <template v-if="isRecording">
      <!-- Recording banner with current URL + controls -->
      <div class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2 tw:mb-3 tw:rounded tw:bg-[var(--o2-status-error-subtle)] tw:border tw:border-[var(--o2-border-color)]">
        <span class="tw:flex tw:items-center tw:gap-1.5">
          <span class="tw:relative tw:inline-flex tw:items-center tw:justify-center tw:w-[0.7rem] tw:h-[0.7rem]" aria-hidden="true">
            <span class="tw:absolute tw:w-[0.7rem] tw:h-[0.7rem] tw:rounded-full tw:bg-[var(--o2-status-error-text)] tw:z-1" />
            <span class="tw:absolute tw:w-[0.7rem] tw:h-[0.7rem] tw:rounded-full tw:bg-[var(--o2-status-error-text)] tw:opacity-0 tw:animate-[recording-pulse-expand_1.5s_ease-out_infinite]" />
          </span>
          <span class="tw:text-sm tw:font-semibold tw:text-[var(--o2-status-error)] tw:pl-1.5">Recording</span>
        </span>
        <span class="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-[var(--o2-text-secondary)] tw:truncate tw:flex-1 tw:min-w-0">
          <span class="tw:truncate">{{ currentUrl }}</span>
        </span>
        <span class="tw:text-xs tw:text-[var(--o2-text-muted)]">{{ capturedSteps.length }} steps</span>
      </div>

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
          @duplicate="duplicateCapturedStep(index, step)"
          @insert-below="() => {}"
        />
      </div>

      <!-- Waiting for first step -->
      <div v-else class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:py-16 tw:text-center">
        <OIcon name="fiber-manual-record" size="xl" class="tw:text-[var(--o2-text-muted)] tw:animate-pulse" aria-hidden="true" />
        <p class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:m-0">Waiting for actions in the browser…</p>
      </div>
    </template>

    <!-- Normal step list (shown when not recording) -->
    <!-- Empty state -->
    <div
      v-else-if="modelValue.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:py-16 tw:text-center"
    >
      <OIcon name="open-in-browser" size="xl" class="tw:text-[var(--o2-text-muted)]" aria-hidden="true" />
      <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">No steps yet</h3>
      <div class="tw:flex tw:items-center tw:gap-3">
        <OButton variant="primary" size="sm" @click="onRecordButtonClick">Record journey</OButton>
        <OButton variant="outline" size="sm" @click="addStep">Add a step manually</OButton>
      </div>
    </div>

    <!-- Step list — draggable when not recording, replaying, readonly, or filtered -->
    <VueDraggableNext
      v-else-if="!dragDisabled"
      v-model="stepsModel"
      @start="onDragStart"
      @end="onDragEnd"
      handle="[data-test='synthetics-journey-step-drag-handle']"
      :animation="200"
      ghost-class="synthetics-drag-ghost"
      drag-class="synthetics-drag-dragging"
      item-key="id"
    >
      <BrowserJourneyStep
        v-for="(step, index) in stepsModel"
        :key="step.id"
        :step="step"
        :index="index"
        :expanded="isStepExpanded(step.id)"
        :selected="selectedStepIds.has(step.id)"
        :selection-enabled="multiSelectEnabled"
        :replay-dot-state="stepDotState(step.id)"
        :replay-locked="isReplayLocked"
        @update:step="updateStep(index, $event)"
        @update:expanded="setStepExpanded(step.id, $event)"
        @delete="deleteStep(index)"
        @duplicate="duplicateStep(index)"
        @insert-below="insertStepBelow(index)"
        @toggle-select="toggleStepSelection(step.id)"
      />
    </VueDraggableNext>

    <!-- Plain list when drag is disabled (filter active, etc.) -->
    <div v-else class="tw:flex tw:flex-col tw:gap-1">
      <BrowserJourneyStep
        v-for="{ step, originalIndex } in filteredSteps"
        :key="step.id"
        :step="step"
        :index="originalIndex"
        :expanded="isStepExpanded(step.id)"
        :selected="selectedStepIds.has(step.id)"
        :selection-enabled="multiSelectEnabled"
        :replay-dot-state="stepDotState(step.id)"
        :replay-locked="isReplayLocked"
        @update:step="updateStep(originalIndex, $event)"
        @update:expanded="setStepExpanded(step.id, $event)"
        @delete="deleteStep(originalIndex)"
        @duplicate="duplicateStep(originalIndex)"
        @insert-below="insertStepBelow(originalIndex)"
        @toggle-select="toggleStepSelection(step.id)"
      />
    </div>

  </div>
</template>

<style>
.synthetics-drag-ghost {
  opacity: 0.3;
  background: var(--o2-primary-50);
  border: 1px dashed var(--o2-primary-color);
  border-radius: 0.375rem;
}
.synthetics-drag-dragging {
  opacity: 0.5;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}

@keyframes recording-pulse-expand {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}
</style>
