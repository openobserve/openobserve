<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'
import type { BrowserStep, SelectorType, StepReplayResult, WireStep } from '@/types/synthetics'
import {
  ACTION_ICONS,
  ACTION_LABELS,
  SELECTOR_ACTIONS,
  VALUE_ACTIONS,
  VALUE_LABELS,
  SELECTOR_TYPE_OPTIONS,
  actionOptions,
} from '@/constants/synthetics'

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
import OSpinner from '@/lib/feedback/Spinner/OSpinner.vue'

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

// ── Computed from shared constants ──────────────────────────────────
const selectorTypeOptions = SELECTOR_TYPE_OPTIONS
const actionIcon = computed(() => ACTION_ICONS[props.step.action])
const actionLabel = computed(() => ACTION_LABELS[props.step.action])
const displayName = computed(() => props.step.name || actionLabel.value)
const selectorPreview = computed(() => props.step.selector || props.step.value || '')
const showSelector = computed(() => SELECTOR_ACTIONS.includes(props.step.action))
const showValue = computed(() => VALUE_ACTIONS.includes(props.step.action))
const valueLabel = computed(() => VALUE_LABELS[props.step.action] || 'Value')

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

// Computed getters/setters for inline editor fields
const actionComputed = computed({
  get: () => props.step.action,
  set: (v: BrowserStep['action']) => update({ action: v }),
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
  if (!props.replayDotState) return 'w-6! text-center text-sm tabular-nums text-[var(--o2-text-muted)]'
  switch (props.replayDotState) {
    case 'active':
      return 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-primary-soft-bg)] text-[var(--color-badge-primary-soft-text)] border border-[var(--color-badge-primary-soft-text)] text-white text-xs font-semi-bold'
    case 'pass':
      return 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-success-soft-bg)] text-[var(--color-badge-success-soft-text)] border border-[var(--color-badge-success-soft-text)] text-xs font-semi-bold'
    case 'fail':
      return 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-error-soft-bg)] text-[var(--color-badge-error-soft-text)] border border-[var(--color-badge-error-soft-text)]  text-xs font-semi-bold'
    case 'skip':
      return 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-default-soft-bg)] text-[var(--color-badge-default-soft-text)] border border-[var(--color-badge-default-soft-text)]  text-xs font-semi-bold'
    default:
      return 'w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-[var(--o2-border)] text-[var(--o2-text-muted)] border border-[var(--o2-text-muted)]  text-xs font-semi-bold'
  }
})

/** Show spinner indicator on the step number when active. */
const stepNumberSpinning = computed(() => props.replayDotState === 'active')

/** opacity for the whole row when skipped. */
const rowOpacityClass = computed(() =>
  props.replayDotState === 'skip' ? 'opacity-50' : ''
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
    case 'TimeoutError': return 'Timeout Error'
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

const showStackTrace = ref(false)

function toggleStackTrace() {
  showStackTrace.value = !showStackTrace.value
}

function copyStackTrace() {
  const stack = se.value?.stack
  if (stack) copyToClipboard(stack)
}

function toggleExpanded() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div class="rounded border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] mb-1">
    <!-- Compact row -->
    <div
      class="flex items-center gap-2 px-2 h-9 min-h-9 group relative"
      :class="[rowOpacityClass, { 'border-b border-[var(--o2-border-color)]': expanded }, showErrorCard && 'bg-[var(--color-badge-error-soft-bg)]']"

    >
      <!-- Drag handle — visibility:hidden during replay to preserve layout -->
      <span
        class="cursor-grab text-[var(--o2-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 absolute left-[-0.1rem]"
        :class="{ 'invisible': replayDotState }"
        data-test="synthetics-journey-step-drag-handle"
        aria-hidden="true"
      >
        <OIcon name="drag-indicator" size="sm" aria-hidden="true" />
      </span>

      <!-- Leading slot: checkbox (edit) + step number — fixed combined width for no shift -->
      <span class="flex items-center gap-1 w-12 shrink-0">
        <OCheckbox
          :model-value="selected ? true : false"
          size="xs"
          class="pl-1"
          :data-test="`synthetics-journey-step-checkbox-${index}`"
          @update:model-value="emit('toggle-select')"
        />

        <!-- Step number (colored status circle during replay) -->
        <span
          :class="stepNumberClass"
          class="ml-1"
          :data-test="replayDotState ? `synthetics-journey-step-dot-${index}` : undefined"
          :aria-label="replayDotState ? `Step ${index + 1} ${replayDotState}` : undefined"
        >
          <OSpinner v-if="stepNumberSpinning" variant="ring" size="xs" class="text-[var(--o2-primary-color)]" />
          <template v-else>{{ index + 1 }}</template>
        </span>
      </span>

      <!-- Action icon chip -->
      <span class="bg-[var(--o2-primary-50)] rounded p-1 shrink-0 flex items-center">
        <OIcon :name="actionIcon" size="sm" class="text-[var(--o2-primary-color)]" aria-hidden="true" />
      </span>

      <!-- Action label badge -->
      <OBadge variant="default" size="sm">{{ actionLabel }}</OBadge>

      <!-- Step display name -->
      <span class="text-sm text-[var(--o2-text-body)] flex-1 truncate min-w-0">
        {{ displayName }}
      </span>

      <!-- Selector/value preview -->
      <span
        v-if="selectorPreview"
        class="font-mono text-xs text-[var(--o2-text-secondary)] truncate max-w-[25%] shrink-0"
      >
        {{ selectorPreview }}
      </span>

      <!-- Row actions — hidden during replay (space reserved via visibility) -->
      <div
        class="flex items-center gap-0.5 shrink-0"
        :class="{ 'invisible': replayLocked }"
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
          class="hover:text-[var(--o2-status-error)]"
          @click="emit('delete')"
        >
          <OIcon name="delete" size="sm" aria-hidden="true" />
        </OButton>
      </div>
    </div>

    <!-- Inline error card (shown when a step fails during replay) -->
    <div
      v-if="showErrorCard"
      class="border border-badge-error-ol-border/30 rounded-lg mx-6 my-2 overflow-hidden"
      data-test="synthetics-journey-step-error-card"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 px-3 py-2 bg-[var(--color-badge-error-soft-bg)]">
        <OIcon :name="errorIconName" size="sm" class="text-[var(--o2-status-error)]" aria-hidden="true" />
        <span class="text-xs font-semibold text-[var(--o2-text-heading)] flex-1">{{ errorLabel }}</span>
        <span class="text-xs font-mono text-[var(--o2-text-secondary)]">{{ exitReasonTag }} · {{ errorDurationFormatted }}</span>
      </div>

      <!-- Error message -->
      <div class="px-3 py-3">
        <p class="text-[12.5px] text-[var(--o2-text-body)] m-0">
          {{ se?.message || props.replayResult?.error }}
        </p>
      </div>

      <!-- Stack trace (collapsible) -->
      <div v-if="se?.stack && false" class="px-3 pb-3">
        <button
          type="button"
          class="text-xs text-[var(--o2-text-link)] bg-transparent border-0 cursor-pointer p-0 flex items-center gap-1"
          @click="toggleStackTrace"
          data-test="synthetics-journey-step-stack-toggle"
        >
          <OIcon :name="showStackTrace ? 'expand-less' : 'expand-more'" size="xs" />
          {{ showStackTrace ? 'Hide' : 'Show' }} stack trace
          <OButton
            v-if="showStackTrace"
            variant="ghost"
            size="xs"
            class="ml-1"
            data-test="synthetics-journey-step-stack-copy"
            @click.stop="copyStackTrace"
          >
            <OIcon name="content-copy" size="xs" />
          </OButton>
        </button>
        <pre
          v-if="showStackTrace"
          class="mt-2 bg-[var(--o2-code-bg)] rounded p-3 overflow-x-auto max-h-[300px] overflow-y-auto text-xs font-mono leading-relaxed m-0"
          data-test="synthetics-journey-step-stack-content"
        >{{ se.stack }}</pre>
      </div>

      <!-- Info boxes -->
      <div v-if="se?.selector" class="flex gap-4 px-3 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-[11px] font-medium text-[var(--o2-text-label)]">Selector (Test ID)</span>
          <span class="text-xs font-mono text-[var(--o2-status-error)]">{{ se.selector }}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-[11px] font-medium text-[var(--o2-text-label)]">Waited</span>
          <span class="text-xs font-mono text-[var(--o2-text-secondary)]">{{ errorDurationFormatted }} · {{ exitReasonTag }}</span>
        </div>
      </div>

      <!-- Error card actions -->
      <div class="flex items-center gap-2 px-3 pb-3">
        <OButton
          variant="outline"
          size="xs"
          data-test="synthetics-journey-error-retry-btn"
          @click="emit('retry-replay')"
          icon-left="replay"
        >
          Re-run
        </OButton>
      </div>
    </div>

    <!-- Inline editor (expanded) -->
    <div
      v-if="expanded"
      class="pt-3 pb-3 px-8 flex flex-col gap-3 w-32!"
    >
      <!-- Action select -->
      <OSelect
        v-model="actionComputed"
        label="Action"
        :options="actionOptions"
        class="w-[25rem]!"
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
        <div class="flex gap-2">
          <OSelect
            v-model="selectorTypeComputed"
            label="Selector type"
            :options="selectorTypeOptions"
            class="w-[25rem]! shrink-0"
            data-test="synthetics-journey-step-selector-type-select"
          />
          <OInput
            v-model="selectorComputed"
            label="Selector"
            placeholder="#my-button or .class-name"
            class="flex-1"
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
