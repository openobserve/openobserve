<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserStep, StepAction, SelectorType, StepReplayResult, WireStep } from '@/types/synthetics'
import type { IconName } from '@/lib/core/Icon/OIcon.icons'

/**
 * Replay status dot states.
 * - When replay is active, each step shows a dot instead of a checkbox.
 * - `undefined` / omitted → normal edit mode (checkbox).
 */
export type StepDotState = 'pending' | 'active' | 'pass' | 'fail' | 'skip'
import OButton from '@/lib/core/Button/OButton.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue'

const props = defineProps<{
  step: BrowserStep
  index: number
  expanded?: boolean
  selected?: boolean
  selectionEnabled?: boolean
  /** Replay status dot state. When set, replaces the checkbox column. */
  replayDotState?: StepDotState
  /** When true, hide row actions (delete, duplicate, insert) during replay. */
  replayLocked?: boolean
  /** Per-step replay result (for inline error card on failed steps). */
  replayResult?: StepReplayResult
}>()

const emit = defineEmits<{
  'update:step': [value: BrowserStep]
  'update:expanded': [value: boolean]
  'delete': []
  'duplicate': []
  'insert-below': []
  'toggle-select': []
  'retry-replay': []
}>()

// Action icon map — all values must be valid IconName keys
const ACTION_ICON_MAP: Record<StepAction, IconName> = {
  navigate: 'open-in-browser',
  click: 'ads-click',
  type: 'keyboard',
  select: 'checklist',
  press: 'keyboard',
  hover: 'touch-app',
  scroll: 'swap-vert',
  wait: 'hourglass-empty',
  assert: 'fact-check',
  screenshot: 'photo-camera',
}

const ACTION_LABEL_MAP: Record<StepAction, string> = {
  navigate: 'NAVIGATE',
  click: 'CLICK',
  type: 'TYPE',
  select: 'SELECT',
  press: 'PRESS',
  hover: 'HOVER',
  scroll: 'SCROLL',
  wait: 'WAIT',
  assert: 'ASSERT',
  screenshot: 'SCREENSHOT',
}

const ACTION_VALUE_LABEL_MAP: Record<string, string> = {
  navigate: 'URL',
  type: 'Text to type',
  select: 'Option',
  press: 'Key',
  scroll: 'To (px or selector)',
  wait: 'Duration (ms)',
  assert: 'Expected',
}

const SELECTOR_ACTIONS: StepAction[] = ['click', 'type', 'select', 'hover', 'assert']
const VALUE_ACTIONS: StepAction[] = ['navigate', 'type', 'select', 'press', 'scroll', 'wait', 'assert']

const actionOptions = (Object.keys(ACTION_LABEL_MAP) as StepAction[]).map((a) => ({
  label: ACTION_LABEL_MAP[a],
  value: a,
}))

const selectorTypeOptions: { label: string; value: SelectorType }[] = [
  { label: 'CSS', value: 'CSS' },
  { label: 'XPath', value: 'XPath' },
  { label: 'Text', value: 'Text' },
  { label: 'TestID', value: 'TestID' },
  { label: 'Role', value: 'Role' },
]

function update(patch: Partial<BrowserStep>) {
  // Patch edited fields into wire instead of clearing it, so replay still has
  // the original extension metadata (framePath, pageAlias, position, snapshot).
  // Action changes clear wire since the step type fundamentally changed.
  let wire = props.step.wire ? { ...props.step.wire } : undefined
  if (wire) {
    if (patch.name !== undefined) wire.name = patch.name
    if (patch.selector !== undefined) wire.selector = patch.selector
    if (patch.selectorType !== undefined) wire.selector_type = patch.selectorType.toLowerCase() as WireStep['selector_type']
    if (patch.value !== undefined) wire.value = patch.value
    if (patch.timeout !== undefined) wire.timeout_ms = patch.timeout
    if (patch.action !== undefined) wire = undefined // action changed — wire metadata is no longer accurate
  }
  emit('update:step', { ...props.step, wire, ...patch })
}

const actionIcon = computed(() => ACTION_ICON_MAP[props.step.action])
const actionLabel = computed(() => ACTION_LABEL_MAP[props.step.action])
const displayName = computed(() => props.step.name || actionLabel.value)
const selectorPreview = computed(() => props.step.selector || props.step.value || '')
const showSelector = computed(() => SELECTOR_ACTIONS.includes(props.step.action))
const showValue = computed(() => VALUE_ACTIONS.includes(props.step.action))
const valueLabel = computed(() => ACTION_VALUE_LABEL_MAP[props.step.action] || 'Value')

// Computed getters/setters for inline editor fields
const actionComputed = computed({
  get: () => props.step.action,
  set: (v: StepAction) => update({ action: v }),
})

const nameComputed = computed({
  get: () => props.step.name ?? '',
  set: (v: string) => update({ name: v }),
})

const selectorTypeComputed = computed({
  get: () => props.step.selectorType ?? 'CSS',
  set: (v: string | number | boolean | null | undefined) => update({ selectorType: (v as SelectorType) ?? undefined }),
})

const selectorComputed = computed({
  get: () => props.step.selector ?? '',
  set: (v: string) => update({ selector: v }),
})

const valueComputed = computed({
  get: () => props.step.value ?? '',
  set: (v: string) => update({ value: v }),
})

const timeoutComputed = computed({
  get: () => String(props.step.timeout ?? ''),
  set: (v: string) => update({ timeout: v ? Number(v) : undefined }),
})

// ── Status dot visual mapping (combines with step number during replay) ─────
/** Tailwind classes for the step number badge (replay = colored circle). */
const stepNumberClass = computed(() => {
  if (!props.replayDotState) return 'tw:w-6! tw:text-center tw:text-sm tw:tabular-nums tw:text-[var(--o2-text-muted)]'
  switch (props.replayDotState) {
    case 'active':
      return 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[var(--color-timeline-dot-primary)] tw:text-white tw:text-xs tw:font-bold'
    case 'pass':
      return 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[var(--color-timeline-dot-success)] tw:text-white tw:text-xs tw:font-bold'
    case 'fail':
      return 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[var(--color-timeline-dot-destructive)] tw:text-white tw:text-xs tw:font-bold'
    case 'skip':
      return 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:text-[var(--o2-text-muted)] tw:text-xs tw:font-bold'
    default:
      return 'tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:border tw:border-[var(--o2-border)] tw:text-[var(--o2-text-muted)] tw:text-xs tw:font-bold'
  }
})

/** Show spinner indicator on the step number when active. */
const stepNumberSpinning = computed(() => props.replayDotState === 'active')

/** opacity for the whole row when skipped. */
const rowOpacityClass = computed(() =>
  props.replayDotState === 'skip' ? 'tw:opacity-50' : ''
)

// ── Inline error card (shown when a step fails during replay) ───────────────
const showErrorCard = computed(() =>
  props.replayDotState === 'fail' && props.replayResult?.error
)

const se = computed(() => props.replayResult?.structuredError)

/** Map structuredError.name to icon name. */
const errorIconName = computed<string>(() => {
  switch (se.value?.name) {
    case 'TimeoutError': return 'timer-off'
    case 'TargetClosedError': return 'visibility-off'
    default: return 'error'
  }
})

/** Map structuredError.name to human label. */
const errorLabel = computed<string>(() => {
  switch (se.value?.name) {
    case 'TimeoutError': return 'Timeout'
    case 'TargetClosedError': return 'Tab closed'
    default: return 'Error'
  }
})

/** Exit reason tag (e.g. "hit timeout", "tab closed"). */
const exitReasonTag = computed<string>(() => {
  const name = se.value?.name
  if (name === 'TimeoutError') return 'hit timeout'
  if (name === 'TargetClosedError') return 'tab closed'
  return 'exit'
})

/** Formatted duration for the error card info box. */
const errorDurationFormatted = computed<string>(() => {
  const ms = props.replayResult?.durationMs ?? 0
  return `${(ms / 1000).toFixed(1)} s`
})

function toggleExpanded() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-1">
    <!-- Compact row -->
    <div
      class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:h-9 tw:min-h-9 tw:group tw:relative"
      :class="[rowOpacityClass, { 'tw:border-b tw:border-[var(--o2-border-color)]': expanded }]"
    >

      <!-- Drag handle — visibility:hidden during replay to preserve layout -->
      <span
        class="tw:cursor-grab tw:text-[var(--o2-text-muted)] tw:opacity-0 tw:group-hover:opacity-100 tw:transition-opacity tw:shrink-0 tw:absolute tw:left-[-0.1rem]"
        :class="{ 'tw:invisible': replayDotState }"
        data-test="synthetics-journey-step-drag-handle"
        aria-hidden="true"
      >
        <OIcon name="drag-indicator" size="sm" aria-hidden="true" />
      </span>

      <!-- Leading slot: checkbox (edit) + step number — fixed combined width for no shift -->
      <span class="tw:flex tw:items-center tw:gap-1 tw:w-12 tw:shrink-0">
        <OCheckbox
          :model-value="selected ? true : false"
          size="xs"
          class="tw:pl-1"
          :data-test="`synthetics-journey-step-checkbox-${index}`"
          @update:model-value="emit('toggle-select')"
        />

        <!-- Step number (colored status circle during replay) -->
        <span
          :class="stepNumberClass"
          class="tw:ml-1"
          :data-test="replayDotState ? `synthetics-journey-step-dot-${index}` : undefined"
          :aria-label="replayDotState ? `Step ${index + 1} ${replayDotState}` : undefined"
        >
          <span v-if="stepNumberSpinning" class="tw:animate-spin tw:inline-block" aria-hidden="true">⟳</span>
          <template v-else>{{ index + 1 }}</template>
        </span>
      </span>

      <!-- Action icon chip -->
      <span class="tw:bg-[var(--o2-primary-50)] tw:rounded tw:p-1 tw:shrink-0 tw:flex tw:items-center">
        <OIcon :name="actionIcon" size="sm" class="tw:text-[var(--o2-primary-color)]" aria-hidden="true" />
      </span>

      <!-- Action label badge -->
      <OBadge variant="default" size="sm">{{ actionLabel }}</OBadge>

      <!-- Step display name -->
      <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:flex-1 tw:truncate tw:min-w-0">
        {{ displayName }}
      </span>

      <!-- Selector/value preview -->
      <span
        v-if="selectorPreview"
        class="tw:font-mono tw:text-xs tw:text-[var(--o2-text-secondary)] tw:truncate tw:max-w-[25%] tw:shrink-0"
      >
        {{ selectorPreview }}
      </span>

      <!-- Row actions — hidden during replay (space reserved via visibility) -->
      <div
        class="tw:flex tw:items-center tw:gap-0.5 tw:shrink-0"
        :class="{ 'tw:invisible': replayLocked }"
      >
        <OButton
          variant="ghost"
          size="xs"
          :aria-label="expanded ? 'Collapse step' : 'Expand step'"
          data-test="synthetics-journey-step-expand-btn"
          @click="toggleExpanded"
        >
          <OIcon :name="expanded ? 'expand-less' : 'expand-more'" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          variant="ghost"
          size="xs"
          aria-label="Insert step below"
          data-test="synthetics-journey-step-insert-btn"
          :disabled="replayLocked"
          @click="emit('insert-below')"
        >
          <OIcon name="add" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          variant="ghost"
          size="xs"
          aria-label="Duplicate step"
          data-test="synthetics-journey-step-duplicate-btn"
          :disabled="replayLocked"
          @click="emit('duplicate')"
        >
          <OIcon name="content-copy" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          variant="ghost"
          size="xs"
          aria-label="Delete step"
          data-test="synthetics-journey-step-delete-btn"
          :disabled="replayLocked"
          class="tw:hover:text-[var(--o2-status-error)]"
          @click="emit('delete')"
        >
          <OIcon name="delete" size="sm" aria-hidden="true" />
        </OButton>
      </div>
    </div>

    <!-- Inline error card (shown when a step fails during replay) -->
    <div
      v-if="showErrorCard"
      class="tw:border tw:border-[var(--o2-error-300)] tw:rounded-lg tw:mx-2 tw:mb-2 tw:overflow-hidden"
      data-test="synthetics-journey-step-error-card"
    >
      <!-- Header -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:bg-[var(--o2-status-error-subtle)]">
        <OIcon :name="errorIconName" size="sm" class="tw:text-[var(--o2-status-error)]" aria-hidden="true" />
        <span class="tw:text-xs tw:font-semibold tw:text-[var(--o2-text-heading)] tw:flex-1">{{ errorLabel }}</span>
        <span class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)]">{{ exitReasonTag }} · {{ errorDurationFormatted }}</span>
      </div>

      <!-- Error message -->
      <div class="tw:px-3 tw:py-3">
        <p class="tw:text-[12.5px] tw:text-[var(--o2-text-body)] tw:m-0">
          {{ se.value?.message || props.replayResult?.error }}
        </p>
      </div>

      <!-- Info boxes -->
      <div v-if="se.value?.selector" class="tw:flex tw:gap-4 tw:px-3 tw:pb-3">
        <div class="tw:flex tw:flex-col tw:gap-1">
          <span class="tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-label)]">Selector (Test ID)</span>
          <span class="tw:text-xs tw:font-mono tw:text-[var(--o2-status-error)]">{{ se.value.selector }}</span>
        </div>
        <div class="tw:flex tw:flex-col tw:gap-1">
          <span class="tw:text-[11px] tw:font-medium tw:text-[var(--o2-text-label)]">Waited</span>
          <span class="tw:text-xs tw:font-mono tw:text-[var(--o2-text-secondary)]">{{ errorDurationFormatted }} · {{ exitReasonTag }}</span>
        </div>
      </div>

      <!-- Error card actions -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:pb-3">
        <OButton variant="primary" size="sm" data-test="synthetics-journey-error-retry-btn" @click="emit('retry-replay')">
          Retry replay
        </OButton>
        <OButton variant="ghost" size="sm" disabled title="Coming soon">
          Re-record from here
        </OButton>
      </div>
    </div>

    <!-- Inline editor (expanded) -->
    <div
      v-if="expanded"
      class="tw:pt-3 tw:pb-3 tw:px-8 tw:flex tw:flex-col tw:gap-3"
    >
      <!-- Action select -->
      <OSelect
        v-model="actionComputed"
        label="Action"
        :options="actionOptions"
        data-test="synthetics-journey-step-action-select"
      />

      <!-- Step name -->
      <OInput
        v-model="nameComputed"
        label="Step name (optional)"
        placeholder="Enter a descriptive name"
        data-test="synthetics-journey-step-name-input"
      />

      <!-- Selector type + selector (when applicable) -->
      <template v-if="showSelector">
        <div class="tw:flex tw:gap-2">
          <OSelect
            v-model="selectorTypeComputed"
            label="Selector type"
            :options="selectorTypeOptions"
            class="tw:w-32! tw:shrink-0"
            data-test="synthetics-journey-step-selector-type-select"
          />
          <OInput
            v-model="selectorComputed"
            label="Selector"
            placeholder="#my-button or .class-name"
            class="tw:flex-1"
            data-test="synthetics-journey-step-selector-input"
          />
        </div>
      </template>

      <!-- Value (action-specific label) -->
      <OInput
        v-if="showValue"
        v-model="valueComputed"
        :label="valueLabel"
        :placeholder="valueLabel"
        data-test="synthetics-journey-step-value-input"
      />

      <!-- Timeout -->
      <OInput
        v-model="timeoutComputed"
        label="Timeout (ms)"
        placeholder="30000"
        type="number"
        data-test="synthetics-journey-step-timeout-input"
      />
    </div>
  </div>
</template>
