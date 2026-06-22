<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import BrowserJourneyStep from './BrowserJourneyStep.vue'

const props = defineProps<{
  modelValue: BrowserStep[]
  readonly?: boolean
  startUrl?: string        // URL shown in the recording banner
  extensionReady?: boolean // when false, Record button triggers need-extension-setup
  autoRecord?: boolean     // if true, start recording immediately on mount
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BrowserStep[]]
  'need-extension-setup': []
}>()

// ── Filter / expand state ──────────────────────────────────────────────────
const filterQuery = ref('')
const expandedSteps = ref<Set<string>>(new Set())
const collapsedGroups = ref<Set<number>>(new Set())

// ── Recording state ────────────────────────────────────────────────────────
const isRecording = ref(false)
const capturedSteps = ref<BrowserStep[]>([])
const currentUrl = ref('')
let stepTimeouts: ReturnType<typeof setTimeout>[] = []

function clearTimer() {
  stepTimeouts.forEach(clearTimeout)
  stepTimeouts = []
}

function startRecording() {
  isRecording.value = true
  capturedSteps.value = []
  currentUrl.value = props.startUrl ?? ''

  // Simulate captured steps — real Chrome extension integration is future work
  stepTimeouts.push(
    setTimeout(() => {
      capturedSteps.value.push({ id: crypto.randomUUID(), action: 'navigate', name: 'Open start URL', value: props.startUrl, timeout: 30000 })
    }, 500),
    setTimeout(() => {
      capturedSteps.value.push({ id: crypto.randomUUID(), action: 'click', name: 'Click login button', selector: '#login-btn', selectorType: 'CSS', timeout: 30000 })
    }, 2000),
    setTimeout(() => {
      capturedSteps.value.push({ id: crypto.randomUUID(), action: 'type', name: 'Enter username', selector: '#username', selectorType: 'CSS', value: 'user@example.com', timeout: 30000 })
    }, 4000),
  )
}

function stopRecording() {
  clearTimer()
  emit('update:modelValue', [...props.modelValue, ...capturedSteps.value])
  isRecording.value = false
  capturedSteps.value = []
}

function cancelRecording() {
  clearTimer()
  capturedSteps.value = []
  isRecording.value = false
}

function onRecordButtonClick() {
  if (props.extensionReady) {
    startRecording()
  } else {
    emit('need-extension-setup')
  }
}

onMounted(() => {
  if (props.autoRecord) startRecording()
})

onUnmounted(() => clearTimer())

// ── Step grouping ──────────────────────────────────────────────────────────
interface PageGroup {
  pageIndex: number
  navigateUrl: string
  steps: { step: BrowserStep; originalIndex: number }[]
}

const pageGroups = computed<PageGroup[]>(() => {
  const groups: PageGroup[] = []
  let currentGroup: PageGroup | null = null
  let pageIndex = 0

  for (let i = 0; i < props.modelValue.length; i++) {
    const step = props.modelValue[i]
    if (step.action === 'navigate' || currentGroup === null) {
      currentGroup = { pageIndex, navigateUrl: step.action === 'navigate' ? (step.value ?? '') : '', steps: [] }
      groups.push(currentGroup)
      pageIndex++
    }
    currentGroup.steps.push({ step, originalIndex: i })
  }
  return groups
})

const filteredGroups = computed<PageGroup[]>(() => {
  if (!filterQuery.value.trim()) return pageGroups.value
  const q = filterQuery.value.toLowerCase()
  return pageGroups.value
    .map((group) => ({
      ...group,
      steps: group.steps.filter(({ step }) =>
        (step.name?.toLowerCase().includes(q)) ||
        step.action.toLowerCase().includes(q) ||
        (step.selector?.toLowerCase().includes(q)) ||
        (step.value?.toLowerCase().includes(q))
      ),
    }))
    .filter((group) => group.steps.length > 0)
})

const allExpanded = computed(() =>
  props.modelValue.length > 0 && props.modelValue.every((s) => expandedSteps.value.has(s.id))
)

function toggleExpandAll() {
  expandedSteps.value = allExpanded.value ? new Set() : new Set(props.modelValue.map((s) => s.id))
}

function toggleGroupCollapse(pageIndex: number) {
  const next = new Set(collapsedGroups.value)
  next.has(pageIndex) ? next.delete(pageIndex) : next.add(pageIndex)
  collapsedGroups.value = next
}

function isStepExpanded(id: string) { return expandedSteps.value.has(id) }

function setStepExpanded(id: string, val: boolean) {
  const next = new Set(expandedSteps.value)
  val ? next.add(id) : next.delete(id)
  expandedSteps.value = next
}

function updateStep(index: number, updated: BrowserStep) {
  const next = [...props.modelValue]; next[index] = updated; emit('update:modelValue', next)
}
function deleteStep(index: number) {
  const next = [...props.modelValue]; next.splice(index, 1); emit('update:modelValue', next)
}
function duplicateStep(index: number) {
  const next = [...props.modelValue]
  next.splice(index + 1, 0, { ...next[index], id: crypto.randomUUID() })
  emit('update:modelValue', next)
}
function insertStepBelow(index: number) {
  const next = [...props.modelValue]
  next.splice(index + 1, 0, { id: crypto.randomUUID(), action: 'click', name: '', timeout: 30000 })
  emit('update:modelValue', next)
}
function addStep() {
  emit('update:modelValue', [...props.modelValue, { id: crypto.randomUUID(), action: 'click', name: '', timeout: 30000 }])
}
function duplicateCapturedStep(index: number, step: BrowserStep) {
  capturedSteps.value.splice(index + 1, 0, { ...step, id: crypto.randomUUID() })
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-0 tw:p-2">

    <!-- Toolbar — adapts in-place to recording state, no layout shift -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
      <!-- Normal: label + filter + step actions -->
      <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">Journey</h3>
      <OBadge variant="default" size="sm">{{ modelValue.length }}</OBadge>
      <OInput
        v-model="filterQuery"
        placeholder="Filter steps..."
        class="tw:w-48"
        data-test="synthetics-journey-filter-input"
      />
      <span class="tw:flex-1" aria-hidden="true" />
      <OButton
        variant="outline"
        size="sm"
        :disabled="readonly"
        data-test="synthetics-journey-add-step-btn"
        @click="addStep"
      >
        <OIcon name="add" size="sm" class="tw:mr-1" aria-hidden="true" />
        Add Step
      </OButton>
      <OButton
        variant="primary"
        size="sm"
        :disabled="readonly"
        data-test="synthetics-journey-record-btn"
        @click="onRecordButtonClick"
      >
        <OIcon name="fiber-manual-record" size="sm" class="tw:mr-1" aria-hidden="true" />
        Record
      </OButton>
    </div>

    <!-- Live capture area (shown while recording) -->
    <template v-if="isRecording && false">
      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
        <span class="tw:text-xs tw:font-medium tw:bg-[var(--o2-status-error-subtle)] tw:text-[var(--o2-status-error)] tw:rounded-full tw:px-2 tw:py-0.5 tw:flex tw:items-center tw:gap-1">
          <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-[var(--o2-status-error)] tw:animate-pulse tw:inline-block" aria-hidden="true" />
          capturing live
        </span>
        <span class="tw:text-sm tw:text-[var(--o2-text-muted)]">({{ capturedSteps.length }} steps captured)</span>
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
      v-if="modelValue.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:py-16 tw:text-center"
    >
      <OIcon name="open-in-browser" size="xl" class="tw:text-[var(--o2-text-muted)]" aria-hidden="true" />
      <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">No steps yet</h3>
      <div class="tw:flex tw:items-center tw:gap-3">
        <OButton variant="primary" size="sm" @click="onRecordButtonClick">Record journey</OButton>
        <OButton variant="outline" size="sm" @click="addStep">Add a step manually</OButton>
      </div>
    </div>
    <!-- Step list grouped by page -->
    <div v-else class="tw:flex tw:flex-col tw:gap-1">
      <template v-for="group in filteredGroups" :key="group.pageIndex">
        <button
          type="button"
          class="tw:flex tw:items-center tw:gap-2 tw:py-1 tw:px-2 tw:bg-[var(--o2-bg-subtle)] tw:rounded tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)] tw:mb-1 tw:cursor-pointer tw:w-full tw:text-left tw:border-0"
          @click="toggleGroupCollapse(group.pageIndex)"
        >
          <OIcon :name="collapsedGroups.has(group.pageIndex) ? 'chevron-right' : 'expand-more'" size="sm" aria-hidden="true" />
          <span>PAGE {{ group.pageIndex + 1 }}</span>
          <span v-if="group.navigateUrl" class="tw:truncate tw:max-w-[16rem] tw:text-[var(--o2-text-muted)]">{{ group.navigateUrl }}</span>
          <OBadge variant="default" size="sm">{{ group.steps.length }}</OBadge>
        </button>
        <template v-if="!collapsedGroups.has(group.pageIndex)">
          <BrowserJourneyStep
            v-for="{ step, originalIndex } in group.steps"
            :key="step.id"
            :step="step"
            :index="originalIndex"
            :expanded="isStepExpanded(step.id)"
            @update:step="updateStep(originalIndex, $event)"
            @update:expanded="setStepExpanded(step.id, $event)"
            @delete="deleteStep(originalIndex)"
            @duplicate="duplicateStep(originalIndex)"
            @insert-below="insertStepBelow(originalIndex)"
          />
        </template>
      </template>
    </div>
  </div>
</template>
