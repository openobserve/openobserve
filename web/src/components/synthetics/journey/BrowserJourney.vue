<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserStep, ReplayPhase, StepReplayResult, WireStep } from '@/types/synthetics'
import type { StepDotState } from './JourneySteps.vue'
import useSyntheticsRecorder from '@/composables/useSyntheticsRecorder'
import { getUUIDv7 } from '@/utils/zincutils'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue'
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { toast } from '@/lib/feedback/Toast/useToast'
import JourneySteps from './JourneySteps.vue'
import {
  ACTION_LABELS,
  SELECTOR_ACTIONS as SELECTOR_ACTIONS_CONST,
  VALUE_ACTIONS as VALUE_ACTIONS_CONST,
  VALUE_LABELS,
  SELECTOR_TYPE_OPTIONS,
  actionOptions,
  VALUE_WIDTH_MAP,
  VALUE_TOOLTIP_MAP,
} from '@/constants/synthetics'

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
  /** Id of the step currently being executed (set by stepReplayStarted). */
  activeStepId?: string | null
  /** When true, show the incognito blocked warning in the toolbar area. */
  blockedReason?: 'incognito' | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BrowserStep[]]
  'need-extension-setup': []
  'clear-results': []
  'replay': []
  'stop-replay': []
  'auto-record-consumed': []
  'selection-changed': [{ count: number; isRecording: boolean }]
}>()

// ── Filter / expand / select state ──────────────────────────────────────────
const filterQuery = ref('')
const expandedStepIds = ref<string[]>([])
const selectedStepIds = ref<string[]>([])

// Delete confirmation
const deleteConfirm = ref<{ show: boolean; step: BrowserStep | null }>({
  show: false,
  step: null,
})

const deleteConfirmMessage = computed(() => {
  const step = deleteConfirm.value.step
  if (!step) return ''
  const label = step.name || `#${props.modelValue.indexOf(step) + 1}`
  return t('synthetics.journey.confirmDeleteMessage', { label })
})

// ── Drag-and-drop ──────────────────────────────────────────────────────────
const dragReady = computed(() =>
  !isRecording.value && !isReplayActive.value && !props.readonly && !filterQuery.value.trim()
)
// Column stays visible during replay (handles invisible) to prevent layout shift
const showDragColumn = computed(() =>
  !isRecording.value && !props.readonly && !filterQuery.value.trim()
)

// ── Replay helpers ──────────────────────────────────────────────────────────
const isReplayRunning = computed(() => props.replayPhase === 'running')
const isReplayActive = computed(() => props.replayPhase && props.replayPhase !== 'idle')
const isReplayTerminal = computed(() =>
  props.replayPhase === 'passed' || props.replayPhase === 'failed' || props.replayPhase === 'stopped'
)
const isReplayLocked = computed(() => isReplayRunning.value) // editing suppressed during running

/** Index of the first failing step in journey order, or -1 when none failed. */
const firstFailedIndex = computed(() =>
  props.modelValue.findIndex((s) => {
    const r = props.stepResults?.get(s.id)
    return r && !r.passed
  })
)

/** Replay result for the first failing step (for the inline error card). */
const failedStepResult = computed<StepReplayResult | undefined>(() => {
  if (firstFailedIndex.value < 0) return undefined
  const step = props.modelValue[firstFailedIndex.value]
  return props.stepResults?.get(step.id)
})

/** Derive the status dot state for a step based on replay results. */
function stepDotState(stepId: string): StepDotState | undefined {
  if (!isReplayActive.value || !props.replayPhase) return undefined
  const result = props.stepResults?.get(stepId)
  if (result) {
    return result.passed ? 'pass' : 'fail'
  }
  // Currently executing step
  if (props.activeStepId === stepId) return 'active'
  const stepIndex = props.modelValue.findIndex((s) => s.id === stepId)
  if (firstFailedIndex.value >= 0 && stepIndex > firstFailedIndex.value) return 'skip'
  if (props.replayPhase === 'running') return 'pending'
  return 'pending'
}

// ── Selection helpers ──────────────────────────────────────────────────────
const selectedCount = computed(() => selectedStepIds.value.length)

const allSelected = computed(() =>
  props.modelValue.length > 0 && props.modelValue.every((s) => selectedStepIds.value.includes(s.id))
)

function toggleSelectAll() {
  selectedStepIds.value = allSelected.value
    ? []
    : props.modelValue.map((s) => s.id)
}

function deleteSelectedSteps() {
  const ids = new Set(selectedStepIds.value)
  emit('update:modelValue', props.modelValue.filter((s) => !ids.has(s.id)))
  selectedStepIds.value = []
}

// Clear selection when the step list changes, filter changes, or replay starts.
// Also clear replay banner when all steps are deleted so stale pass/fail banners
// don't linger after the user removes every step.
watch(() => props.modelValue.length, (newLen) => {
  selectedStepIds.value = []
  if (newLen === 0) emit('clear-results')
})
watch(filterQuery, () => { selectedStepIds.value = [] })
watch(() => props.replayPhase, (phase) => {
  if (phase === 'running') {
    selectedStepIds.value = []
    expandedStepIds.value = [] // collapse all on new replay
    return
  }
  // Auto-expand the first failing step when replay fails
  if (phase === 'failed' && firstFailedIndex.value >= 0) {
    const stepId = props.modelValue[firstFailedIndex.value]?.id
    if (stepId) expandedStepIds.value = [stepId]
  }
})

const multiSelectEnabled = computed(() =>
  !isRecording.value && !props.readonly && !isReplayRunning.value
)


// ── Recording state ────────────────────────────────────────────────────────
// All Chrome-extension messaging lives in the composable; this component only
// reflects its reactive state and merges the result into the journey on stop.
const { t } = useI18n()

// Chrome UI element names — must stay in English across all locales
// because they reference the actual Chrome browser interface.
const CHROME_UI = {
  details: 'Details',
  allowIncognito: 'Allow in Incognito',
  recorderName: 'OpenObserve Recorder',
} as const

const recorder = useSyntheticsRecorder()
const isRecording = recorder.isRecording
const capturedSteps = recorder.liveSteps
const currentUrl = recorder.currentUrl
const recordingError = recorder.error

// Emit selection state changes for the parent's sticky footer
watch([selectedCount, isRecording], ([count, recording]) => {
  emit('selection-changed', { count, isRecording: recording })
})

// ── Step validation (Continue button + save) ──────────────────────────────
const selectorErrors = ref<Set<string>>(new Set())
const firstStepError = ref(false)

function validateJourneySteps(): boolean {
  // 1. First step must be "navigate"
  const first = props.modelValue[0]
  firstStepError.value = first ? first.action !== 'navigate' : false

  // 2. Selector-requiring steps must have a selector
  const selErrs = new Set<string>()
  for (const step of props.modelValue) {
    if (
      SELECTOR_ACTIONS_CONST.includes(step.action as any) &&
      (!step.selector || step.selector.trim() === '')
    ) {
      selErrs.add(step.id)
    }
  }
  selectorErrors.value = selErrs

  // Auto-expand errored steps so the inline error is visible
  const erroredIds = [...selErrs]
  if (firstStepError.value && first) erroredIds.push(first.id)
  if (erroredIds.length > 0) {
    expandedStepIds.value = [
      ...new Set([...expandedStepIds.value, ...erroredIds]),
    ]
  }

  const valid = !firstStepError.value && selErrs.size === 0
  if (!valid) {
    // Surface the first error as a toast so the user knows why
    // navigation was blocked, then expand the step to see inline details.
    const firstErrId = erroredIds[0]
    const stepIdx = props.modelValue.findIndex((s) => s.id === firstErrId)
    const stepLabel = props.modelValue[stepIdx]?.name || t('synthetics.results.steps.step', { step: (stepIdx ?? 0) + 1 })
    if (firstStepError.value && (!first || first.id === firstErrId)) {
      toast({ variant: 'error', message: t('synthetics.validation.firstStepMustNavigate') })
    } else {
      toast({ variant: 'error', message: t('synthetics.validation.selectorRequired', { step: stepLabel }) })
    }
  }

  return valid
}

function clearSelectorError(stepId: string) {
  const next = new Set(selectorErrors.value)
  next.delete(stepId)
  selectorErrors.value = next
}

function clearFirstStepError() {
  firstStepError.value = false
}

// Expose selection state + validation for the parent's sticky footer
defineExpose({
  selectedCount,
  isRecording,
  deleteSelectedSteps,
  stopActiveRecording,
  stopActiveReplay,
  validateStepSelectors: validateJourneySteps,
})

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

/** Sync stop — called by parent's route guard before navigating away.
 *  Commits captured recording steps so they aren't lost. Returns true if
 *  anything was stopped. */
function stopActiveRecording(): boolean {
  if (!recorder.isRecording.value) return false
  const steps = recorder.stopAndForget()
  if (steps.length > 0) emit('update:modelValue', [...props.modelValue, ...steps])
  return true
}

/** Sync stop for replay — called by parent's route guard. */
function stopActiveReplay(): boolean {
  if (!isReplayRunning.value) return false
  recorder.stopReplayAndForget()
  return true
}

/** Sync fire-and-forget on tab close — prevents orphaned extension tabs. */
function handleBeforeUnload() {
  if (recorder.isRecording.value) recorder.stopAndForget()
  else if (isReplayRunning.value) recorder.stopReplayAndForget()
}

onMounted(() => {
  // Register the external-stop callback: the composable calls this synchronously
  // when recordingStopped arrives over the port, avoiding any async timing races.
  recorder.setOnExternalStop((steps: BrowserStep[]) => {
    emit('update:modelValue', [...props.modelValue, ...steps])
  })
  window.addEventListener('beforeunload', handleBeforeUnload)
  if (props.autoRecord) {
    startRecording()
    emit('auto-record-consumed')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  recorder.setOnExternalStop(null)
  recorder.cleanup()
})

// ── Step list (single flat list — one journey, one start URL) ───────────────
const filteredSteps = computed<BrowserStep[]>(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return props.modelValue
  return props.modelValue.filter((step) =>
    (step.name?.toLowerCase().includes(q)) ||
    step.action.toLowerCase().includes(q) ||
    (step.selector?.toLowerCase().includes(q)) ||
    (step.value?.toLowerCase().includes(q))
  )
})

// ── Expand / collapse ─────────────────────────────────────────────────────
const allExpanded = computed(() =>
  props.modelValue.length > 0 && props.modelValue.every((s) => expandedStepIds.value.includes(s.id))
)

function toggleExpandAll() {
  expandedStepIds.value = allExpanded.value ? [] : props.modelValue.map((s) => s.id)
}

function isStepExpanded(id: string) { return expandedStepIds.value.includes(id) }

function handleToggleExpand(row: BrowserStep) {
  if (expandedStepIds.value.includes(row.id)) {
    expandedStepIds.value = expandedStepIds.value.filter((id) => id !== row.id)
  } else {
    expandedStepIds.value = [...expandedStepIds.value, row.id]
  }
}

// ── Step CRUD — find by id and mutate ──────────────────────────────────────
function findIndex(row: BrowserStep): number {
  return props.modelValue.findIndex((s) => s.id === row.id)
}

function handleDelete(row: BrowserStep) {
  deleteConfirm.value = { show: true, step: row }
}

function confirmDelete() {
  if (!deleteConfirm.value.step) return
  const idx = findIndex(deleteConfirm.value.step)
  deleteConfirm.value = { show: false, step: null }
  if (idx < 0) return
  const next = [...props.modelValue]; next.splice(idx, 1); emit('update:modelValue', next)
}

function cancelDelete() {
  deleteConfirm.value = { show: false, step: null }
}
function handleDuplicate(row: BrowserStep) {
  const idx = findIndex(row)
  if (idx < 0) return
  const next = [...props.modelValue]
  next.splice(idx + 1, 0, { ...next[idx], id: getUUIDv7(true) })
  emit('update:modelValue', next)
}
function handleInsertBelow(row: BrowserStep) {
  const idx = findIndex(row)
  if (idx < 0) return
  const next = [...props.modelValue]
  next.splice(idx + 1, 0, { id: getUUIDv7(true), action: 'click', name: '', timeout: 30000, code: '' })
  emit('update:modelValue', next)
}
function handleRowReorder(reordered: BrowserStep[]) {
  emit('update:modelValue', reordered)
}
function handleUpdateSelected(ids: string[]) {
  selectedStepIds.value = ids
}
function handleUpdateExpanded(ids: string[]) {
  expandedStepIds.value = ids
}
function addStep() {
  emit('update:modelValue', [...props.modelValue, { id: getUUIDv7(true), action: 'click', name: '', timeout: 30000, code: '' }])
}
function duplicateCapturedStep(index: number, step: BrowserStep) {
  capturedSteps.value.splice(index + 1, 0, { ...step, id: getUUIDv7(true) })
}

// ── Dot state wrapper for JourneySteps ────────────────────────────────────
function dotStateForRow(row: BrowserStep): StepDotState | undefined {
  return stepDotState(row.id)
}

// ── Row status color: red left border for rows with validation errors ──────
function getRowStatusColor(row: BrowserStep): string | undefined {
  const first = props.modelValue[0]
  const hasFirstStepErr = firstStepError.value && first?.id === row.id
  const hasSelectorErr = selectorErrors.value.has(row.id)
  if (hasFirstStepErr || hasSelectorErr) return 'var(--color-status-error-text)'
  return undefined
}

// ── Inline editor helpers ──────────────────────────────────────────────────
const selectorActions = SELECTOR_ACTIONS_CONST
const valueActions = VALUE_ACTIONS_CONST
const selectorTypeOptions = SELECTOR_TYPE_OPTIONS

function valueActionLabel(action: string): string {
  return VALUE_LABELS[action] || t('synthetics.journey.valueFallback')
}

function valueWidthClass(action: string): string {
  return VALUE_WIDTH_MAP[action] || 'w-152!'
}

function valueTooltip(action: string): string | undefined {
  return VALUE_TOOLTIP_MAP[action]
}

function handleStepUpdate(row: BrowserStep, patch: Partial<BrowserStep>) {
  const idx = findIndex(row)
  if (idx < 0) return
  const next = [...props.modelValue]

  // Sync edits into the recorded wire step so the API receives the updated
  // values. journeyToWireSteps prefers wire over UI fields, so without this
  // sync, edits to recorded steps are silently discarded on save.
  let wire = next[idx].wire ? { ...next[idx].wire } : undefined
  if (wire) {
    if (patch.name !== undefined) wire.name = patch.name
    if (patch.selector !== undefined) wire.selector = patch.selector
    if (patch.selectorType !== undefined) wire.selector_type = patch.selectorType.toLowerCase() as WireStep['selector_type']
    if (patch.value !== undefined) wire.value = patch.value
    if (patch.timeout !== undefined) wire.timeout_ms = patch.timeout
    if (patch.action !== undefined) wire = undefined // action changed → wire metadata is no longer accurate
  }

  next[idx] = { ...next[idx], wire, ...patch }
  emit('update:modelValue', next)
}

function openChromeExtensions() {
  const url = 'chrome://extensions'
  try { window.open(url, '_blank')?.focus() } catch { /* ignore */ }
  navigator.clipboard.writeText(url).catch(() => {})
}
</script>

<template>
  <div class="flex flex-col min-h-0 w-full py-4">

    <!-- Toolbar — pl-4 mirrors the expand column (w-4) so the select-all checkbox
         aligns with the row checkboxes in the OTable below. -->
    <div class="flex items-center gap-4 mb-3 ml-5.5 px-3">
      <!-- Select-all — visibility:hidden during replay to preserve layout -->
      <OCheckbox
        :model-value="allSelected || undefined"
        size="sm"
        :class="{ 'invisible': isRecording || readonly }"
        data-test="synthetics-journey-select-all"
        @update:model-value="toggleSelectAll()"
      />
      <div class="flex">
        <h3 class="text-base font-semibold text-text-heading mr-0">{{ t('synthetics.journey.steps') }}</h3>
        <OBadge variant="default" size="sm" class="ml-1">{{ modelValue.length }}</OBadge>
      </div>
      <OInput
        v-model="filterQuery"
        :placeholder="t('synthetics.journey.filterSteps')"
        class="flex-1 min-w-32!"
        data-test="synthetics-journey-filter-input"
      />
      <!-- Fixed-width action area — buttons right-aligned, widest set (Add Step + Record + Replay/Stop) fits in 320px -->
      <div class="w-100 flex items-center gap-2 justify-end">
        <OButton
          v-if="!isRecording && !isReplayRunning"
          variant="outline"
          size="sm"
          :disabled="readonly || isRecording"
          data-test="synthetics-journey-add-step-btn"
          @click="addStep"
          icon-left="add"
        >
          {{ t('synthetics.journey.addStep') }}
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
            {{ t('synthetics.journey.replay') }}
          </OButton>
          <OButton
            v-else-if="replayPhase === 'running'"
            variant="destructive"
            size="sm"
            data-test="synthetics-journey-stop-replay-btn"
            @click="emit('stop-replay')"
            icon-left="stop"
          >
            {{ t('synthetics.journey.stop') }}
          </OButton>
          <OButton
            v-else-if="isReplayTerminal"
            variant="outline"
            size="sm"
            data-test="synthetics-journey-replay-btn"
            @click="emit('replay')"
            icon-left="replay"
          >
            {{ t('synthetics.journey.replay') }}
          </OButton>
        </template>

        <OButton
          v-if="isRecording"
          variant="outline"
          size="sm"
          data-test="synthetics-journey-cancel-btn"
          @click="cancelRecording"
        >
          {{ t('synthetics.journey.cancel') }}
        </OButton>

        <OButton
          v-if="isRecording"
          variant="destructive"
          size="sm"
          data-test="synthetics-journey-stop-btn"
          @click="stopRecording"
          icon-left="stop"
          class="w-24!"
        >
          {{ t('synthetics.journey.stop') }}
        </OButton>
        <OButton
          v-else
          variant="primary"
          size="sm"
          :disabled="readonly || isRecording || isReplayRunning"
          data-test="synthetics-journey-record-btn"
          @click="onRecordButtonClick"
          icon-left="smart-display"
          class="w-24!"
        >
          {{ t('synthetics.journey.record') }}
        </OButton>
      </div>
    </div>

    <!-- Incognito blocked warning card (pre-flight failure) -->
    <div
      v-if="blockedReason === 'incognito'"
      class="flex flex-col gap-3 px-3 py-3 mb-3 rounded-default border border-[var(--color-warning-300)] bg-warning-50"
      role="alert"
      data-test="synthetics-journey-incognito-warning"
    >
      <div class="flex items-center gap-2">
        <OIcon name="visibility-off" size="sm" class="text-warning-600" aria-hidden="true" />
        <span class="text-sm font-semibold text-text-heading">{{ t('synthetics.journey.incognitoTitle') }}</span>
      </div>
      <p class="text-xs text-text-secondary m-0">
        {{ t('synthetics.journey.incognitoDescription') }}
      </p>
      <ol class="list-decimal pl-4 text-xs text-text-body flex flex-col gap-1 m-0">
        <li>{{ t('synthetics.journey.incognitoStep1Full') }}</li>
        <li>{{ t('synthetics.journey.incognitoStep2Full', { name: CHROME_UI.recorderName }) }}</li>
        <li>{{ t('synthetics.journey.incognitoStep3Full', { button: CHROME_UI.details }) }}</li>
        <li>{{ t('synthetics.journey.incognitoStep4Full', { setting: CHROME_UI.allowIncognito }) }}</li>
        <li>{{ t('synthetics.journey.incognitoStep5Full', { button: t('synthetics.journey.retry') }) }}</li>
      </ol>
      <div class="flex items-center gap-2">
        <OButton
          variant="primary"
          size="sm"
          data-test="synthetics-journey-incognito-retry-btn"
          @click="emit('replay')"
        >
          {{ t('synthetics.journey.retry') }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          data-test="synthetics-journey-incognito-dismiss-btn"
          @click="emit('clear-results')"
        >
          {{ t('synthetics.journey.dismiss') }}
        </OButton>
        <span class="flex-1" />
        <OButton
          variant="outline"
          size="sm"
          data-test="synthetics-journey-incognito-extensions-btn"
          @click="openChromeExtensions"
        >
          {{ t('synthetics.journey.openExtensions') }}
        </OButton>
      </div>
    </div>

    <!-- Replay running banner -->
    <div
      v-if="replayPhase === 'running'"
      class="flex items-center gap-2 mx-2 px-3 py-2 mb-3 rounded-default bg-[var(--color-badge-primary-soft-bg)] border border-border-default"
      role="status"
      data-test="synthetics-journey-replay-banner"
    >
      <OIcon name="sync" size="sm" class="animate-spin text-accent" aria-hidden="true" />
      <span
        class="text-sm text-text-body"
        data-test="synthetics-journey-replay-banner-text"
      >
        {{ t('synthetics.journey.replaying') }}
      </span>
      <span class="text-sm text-text-secondary">
        {{ t('synthetics.journey.replayProgress', { current: stepResults?.size ?? 0, total: modelValue.length }) }}
      </span>
    </div>

    <!-- Replay passed banner -->
    <div
      v-else-if="replayPhase === 'passed'"
      class="flex items-center gap-2 mx-2 px-3 py-2 mb-3 rounded-default bg-[var(--color-badge-success-soft-bg)] border border-badge-success-ol-border/50"
      role="status"
      data-test="synthetics-journey-passed-banner"
    >
      <OIcon name="check-circle" size="sm" class="text-[var(--color-timeline-dot-success)]" aria-hidden="true" />
      <span class="text-sm text-badge-success-ol-text font-semi-bold">{{ t('synthetics.journey.replayPassed', { count: modelValue.length }) }}</span>
      <span class="flex-1" />
      <OButton variant="ghost" size="xs" data-test="synthetics-journey-clear-results-btn" @click="emit('clear-results')">
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Replay failed banner -->
    <div
      v-else-if="replayPhase === 'failed'"
      class="flex items-start gap-2 px-3 py-2 mb-3 rounded-default bg-[var(--color-badge-error-soft-bg)] border border-badge-error-ol-border/30"
      role="alert"
      data-test="synthetics-journey-failed-banner"
    >
      <OIcon name="error" size="sm" class="mt-0.5 text-badge-error-ol-text" aria-hidden="true" />
      <div class="flex flex-col gap-0.5 flex-1 min-w-0">
        <span class="text-sm text-badge-error-ol-text font-semibold">{{ t('synthetics.journey.replayFailed', { failed: firstFailedIndex + 1, total: modelValue.length }) }}</span>
        <span v-if="failedStepResult?.stepName" class="text-xs truncate text-badge-error-ol-text pt-1">{{ failedStepResult.stepName }}</span>
      </div>
      <OButton variant="ghost" size="xs" data-test="synthetics-journey-clear-results-btn" @click="emit('clear-results')">
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Replay stopped banner -->
    <div
      v-else-if="replayPhase === 'stopped'"
      class="flex items-center gap-2 px-3 py-2 mb-3 rounded-default bg-surface-subtle border border-border-default"
      role="status"
      data-test="synthetics-journey-stopped-banner"
    >
      <OIcon name="stop" size="sm" class="text-text-secondary" aria-hidden="true" />
      <span class="text-sm text-text-body">{{ t('synthetics.journey.replayStopped', { completed: stepResults?.size ?? 0, total: modelValue.length }) }}</span>
      <span class="flex-1" />
      <OButton variant="outline" size="xs" data-test="synthetics-journey-stopped-retry-btn" @click="emit('replay')">
        {{ t('synthetics.journey.reRun') }}
      </OButton>
      <OButton variant="ghost" size="xs" data-test="synthetics-journey-clear-results-btn" @click="emit('clear-results')">
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <!-- Recorder error (extension missing / failed to start) -->
    <div
      v-if="recordingError && !isRecording"
      class="flex items-center gap-2 px-3 py-2 mb-3 rounded-default bg-status-error-bg text-status-error-text text-sm"
      role="alert"
      data-test="synthetics-journey-record-error"
    >
      <OIcon name="error" size="sm" aria-hidden="true" />
      <span>{{ recordingError }}</span>
    </div>

    <!-- Live capture area (shown while recording) -->
    <template v-if="isRecording">
      <!-- Recording banner with current URL + controls -->
      <div class="flex items-center gap-3 px-3 py-2 mb-3 rounded-default bg-status-error-bg border border-border-default">
        <span class="flex items-center gap-1.5">
          <span class="relative inline-flex items-center justify-center w-[0.7rem] h-[0.7rem]" aria-hidden="true">
            <span class="absolute w-[0.7rem] h-[0.7rem] rounded-full bg-status-error-text z-1" />
            <span class="recording-pulse-ring absolute w-[0.7rem] h-[0.7rem] rounded-full bg-status-error-text opacity-0" />
          </span>
          <span class="text-sm font-semibold text-status-error-text pl-1.5">{{ t('synthetics.journey.recording') }}</span>
        </span>
        <span class="flex items-center gap-1 text-xs text-text-secondary truncate flex-1 min-w-0">
          <span class="truncate">{{ currentUrl }}</span>
        </span>
        <span class="text-xs text-text-muted">{{ capturedSteps.length }} {{ t('synthetics.table.stepsSuffix') }}</span>
      </div>

      <JourneySteps
        v-if="capturedSteps.length > 0"
        :data="capturedSteps"
        mode="editor"
        action-key="action"
        name-key="name"
        detail-key="selector"
        :locked="true"
        :selection-enabled="false"
        @delete="(row: BrowserStep) => capturedSteps.splice(capturedSteps.findIndex(s => s.id === row.id), 1)"
        @duplicate="(row: BrowserStep) => { const idx = capturedSteps.findIndex(s => s.id === row.id); duplicateCapturedStep(idx, row) }"
      />

      <!-- Waiting for first step -->
      <div v-else class="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <OIcon name="fiber-manual-record" size="xl" class="text-text-muted animate-pulse" aria-hidden="true" />
        <p class="text-sm text-text-secondary m-0">{{ t('synthetics.journey.waitingForActions') }}</p>
      </div>
    </template>

    <!-- Normal step list (shown when not recording) -->
    <!-- Empty state -->
    <div
      v-else-if="modelValue.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <OIcon name="open-in-browser" size="xl" class="text-text-muted" aria-hidden="true" />
      <h3 class="text-base font-semibold text-text-heading m-0">{{ t('synthetics.journey.noSteps') }}</h3>
      <div class="flex items-center gap-3">
        <OButton variant="primary" size="sm" @click="onRecordButtonClick">{{ t('synthetics.journey.recordJourney') }}</OButton>
        <OButton variant="outline" size="sm" @click="addStep">{{ t('synthetics.journey.addStepManually') }}</OButton>
      </div>
    </div>

    <!-- JourneySteps — draggable/selectable/expandable as mode permits -->
    <JourneySteps
      v-else
      :data="filterQuery ? filteredSteps : modelValue"
      mode="editor"
      action-key="action"
      name-key="name"
      detail-key="selector"
      :dot-state-fn="dotStateForRow"
      :locked="isReplayLocked"
      :readonly="readonly"
      :enable-reorder="showDragColumn"
      :disable-row-reorder="() => !dragReady"
      :filter-active="!!filterQuery.trim()"
      :selection-enabled="multiSelectEnabled"
      :selected-ids="selectedStepIds"
      :expanded-ids="expandedStepIds"
      :get-row-status-color="getRowStatusColor"
      @update:data="handleRowReorder"
      @update:selected-ids="handleUpdateSelected"
      @update:expanded-ids="handleUpdateExpanded"
      @expand="handleToggleExpand"
      @delete="handleDelete"
      @duplicate="handleDuplicate"
      @insert-below="handleInsertBelow"
      @retry-replay="emit('replay')"
    >
      <!-- Inline editor (expanded content) -->
      <template #expansion="{ row }">
        <div class="pt-3 pb-3 px-8 flex flex-col gap-3">
          <!-- Action + Step name in one row -->
          <div class="flex gap-2">
            <OSelect
              :model-value="row.action"
              :label="t('synthetics.journey.actionLabel')"
              :options="actionOptions"
              class="w-50! shrink-0"
              :error="firstStepError && props.modelValue[0]?.id === row.id"
              :error-message="firstStepError && props.modelValue[0]?.id === row.id ? t('synthetics.validation.firstStepMustNavigate') : ''"
              data-test="synthetics-journey-step-action-select"
              @update:model-value="(v: any) => { handleStepUpdate(row, { action: v as any }); clearFirstStepError() }"
            />
            <OInput
              :model-value="row.name ?? ''"
              :label="t('synthetics.journey.stepNameOptional')"
              :placeholder="t('synthetics.journey.stepNamePlaceholder')"
              class="w-100!"
              data-test="synthetics-journey-step-name-input"
              @update:model-value="(v: any) => handleStepUpdate(row, { name: v })"
            />
          </div>
          <!-- Selector type + selector (when applicable) -->
          <template v-if="selectorActions.includes(row.action)">
            <div class="flex gap-2 w-fit!">
              <OSelect
                :model-value="row.selectorType ?? 'CSS'"
                :label="t('synthetics.journey.selectorTypeLabel')"
                :options="selectorTypeOptions"
                class="w-50! shrink-0"
                data-test="synthetics-journey-step-selector-type-select"
                @update:model-value="(v: any) => handleStepUpdate(row, { selectorType: v })"
              />
              <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- CSS selector syntax example, not user-facing prose -->
              <OInput
                :model-value="row.selector ?? ''"
                :label="t('synthetics.journey.selectorLabel')"
                :placeholder="t('synthetics.journey.selectorPlaceholder')"
                class="w-100!"
                :required="true"
                :error="selectorErrors.has(row.id)"
                :error-message="selectorErrors.has(row.id) ? t('synthetics.validation.selectorRequired', { step: row.name || t('synthetics.results.steps.step', { step: props.modelValue.indexOf(row) + 1 }) }) : ''"
                data-test="synthetics-journey-step-selector-input"
                @update:model-value="(v: any) => { handleStepUpdate(row, { selector: v }); clearSelectorError(row.id) }"
              />
            </div>
          </template>
          <!-- Value (action-specific label) -->
          <OInput
            v-if="valueActions.includes(row.action)"
            :model-value="row.value ?? ''"
            :label="valueActionLabel(row.action)"
            :placeholder="valueActionLabel(row.action)"
            :class="valueWidthClass(row.action)"
            data-test="synthetics-journey-step-value-input"
            @update:model-value="(v: any) => handleStepUpdate(row, { value: v })"
          >
            <template v-if="valueTooltip(row.action)" #tooltip>
              <OTooltip :content="valueTooltip(row.action)!" />
            </template>
          </OInput>
          <!-- Timeout -->
          <OInput
            :model-value="String(row.timeout ?? '')"
            :label="t('synthetics.journey.timeoutLabel')"
            :placeholder="t('synthetics.journey.timeoutPlaceholder')"
            type="number"
            class="w-50!"
            data-test="synthetics-journey-step-timeout-input"
            @update:model-value="(v: any) => handleStepUpdate(row, { timeout: v ? Number(v) : undefined })"
          />
        </div>
      </template>
    </JourneySteps>

    <!-- Delete confirmation dialog -->
    <ConfirmDialog
      v-model:model-value="deleteConfirm.show"
      :title="t('synthetics.journey.deleteStep')"
      :message="deleteConfirmMessage"
      :ok-label="t('synthetics.journey.delete')"
      ok-color="danger"
      @update:ok="confirmDelete"
      @update:cancel="cancelDelete"
    />
  </div>
</template>

<style scoped>
/* keep(keyframes): single-consumer pulse for the recording indicator. The
   animation lives here as a class (not a template `animate-[…]` utility)
   because scoped hashes the keyframe name and only rewrites references made
   inside this block. */
.recording-pulse-ring {
  animation: recording-pulse-expand 1.5s ease-out infinite;
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
