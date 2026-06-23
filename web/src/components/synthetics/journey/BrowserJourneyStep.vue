<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserStep, StepAction, SelectorType } from '@/types/synthetics'
import type { IconName } from '@/lib/core/Icon/OIcon.icons'
import OButton from '@/lib/core/Button/OButton.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'

const props = defineProps<{
  step: BrowserStep
  index: number
  expanded?: boolean
}>()

const emit = defineEmits<{
  'update:step': [value: BrowserStep]
  'update:expanded': [value: boolean]
  'delete': []
  'duplicate': []
  'insert-below': []
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
  emit('update:step', { ...props.step, ...patch })
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

function toggleExpanded() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div class="tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-1">
    <!-- Compact row -->
    <div
      class="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:h-9 tw:min-h-9 tw:group"
      :class="{ 'tw:border-b tw:border-[var(--o2-border-color)]': expanded }"
    >
      <!-- Drag handle -->
      <span
        class="tw:cursor-grab tw:text-[var(--o2-text-muted)] tw:select-none tw:text-base tw:leading-none"
        data-test="synthetics-journey-step-drag-handle"
        aria-hidden="true"
      >⠿</span>

      <!-- Step number -->
      <span class="tw:w-6 tw:text-right tw:text-sm tw:tabular-nums tw:text-[var(--o2-text-muted)] tw:shrink-0">
        {{ index + 1 }}
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
        class="tw:font-mono tw:text-xs tw:text-[var(--o2-text-secondary)] tw:truncate tw:max-w-[11.25rem] tw:shrink-0"
      >
        {{ selectorPreview }}
      </span>

      <!-- Row actions -->
      <div class="tw:flex tw:items-center tw:gap-0.5 tw:shrink-0">
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
          @click="emit('insert-below')"
        >
          <OIcon name="add" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          variant="ghost"
          size="xs"
          aria-label="Duplicate step"
          data-test="synthetics-journey-step-duplicate-btn"
          @click="emit('duplicate')"
        >
          <OIcon name="content-copy" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          variant="ghost"
          size="xs"
          aria-label="Delete step"
          data-test="synthetics-journey-step-delete-btn"
          class="tw:hover:text-[var(--o2-status-error)]"
          @click="emit('delete')"
        >
          <OIcon name="delete" size="sm" aria-hidden="true" />
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
