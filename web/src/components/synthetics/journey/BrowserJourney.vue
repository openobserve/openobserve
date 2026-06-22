<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import type { BrowserStep } from '@/types/synthetics'
import OButton from '@/lib/core/Button/OButton.vue'
import OInput from '@/lib/forms/Input/OInput.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import BrowserJourneyStep from './BrowserJourneyStep.vue'

const props = defineProps<{
  modelValue: BrowserStep[]
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BrowserStep[]]
  'record': []
}>()

const filterQuery = ref('')
const expandedSteps = ref<Set<string>>(new Set())
const collapsedGroups = ref<Set<number>>(new Set())

// Group steps by page (a navigate step starts a new group)
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
      currentGroup = {
        pageIndex,
        navigateUrl: step.action === 'navigate' ? (step.value ?? '') : '',
        steps: [],
      }
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

const allExpanded = computed(() => {
  return props.modelValue.length > 0 &&
    props.modelValue.every((s) => expandedSteps.value.has(s.id))
})

function toggleExpandAll() {
  if (allExpanded.value) {
    expandedSteps.value = new Set()
  } else {
    expandedSteps.value = new Set(props.modelValue.map((s) => s.id))
  }
}

function toggleGroupCollapse(pageIndex: number) {
  const next = new Set(collapsedGroups.value)
  if (next.has(pageIndex)) {
    next.delete(pageIndex)
  } else {
    next.add(pageIndex)
  }
  collapsedGroups.value = next
}

function isStepExpanded(id: string) {
  return expandedSteps.value.has(id)
}

function setStepExpanded(id: string, val: boolean) {
  const next = new Set(expandedSteps.value)
  if (val) {
    next.add(id)
  } else {
    next.delete(id)
  }
  expandedSteps.value = next
}

function updateStep(index: number, updated: BrowserStep) {
  const next = [...props.modelValue]
  next[index] = updated
  emit('update:modelValue', next)
}

function deleteStep(index: number) {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

function duplicateStep(index: number) {
  const next = [...props.modelValue]
  const copy: BrowserStep = { ...next[index], id: crypto.randomUUID() }
  next.splice(index + 1, 0, copy)
  emit('update:modelValue', next)
}

function insertStepBelow(index: number) {
  const next = [...props.modelValue]
  const newStep: BrowserStep = {
    id: crypto.randomUUID(),
    action: 'click',
    name: '',
    timeout: 30000,
  }
  next.splice(index + 1, 0, newStep)
  emit('update:modelValue', next)
}

function addStep() {
  const newStep: BrowserStep = {
    id: crypto.randomUUID(),
    action: 'click',
    name: '',
    timeout: 30000,
  }
  emit('update:modelValue', [...props.modelValue, newStep])
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-0">
    <!-- Toolbar -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3 tw:flex-wrap">
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
        variant="ghost"
        size="sm"
        :disabled="readonly || modelValue.length === 0"
        data-test="synthetics-journey-expand-all-btn"
        @click="toggleExpandAll"
      >
        {{ allExpanded ? 'Collapse all' : 'Expand all' }}
      </OButton>

      <OButton
        variant="outline"
        size="sm"
        :disabled="readonly"
        data-test="synthetics-journey-add-step-btn"
        @click="addStep"
      >
        <span class="material-icons-outlined tw:text-base tw:leading-none tw:mr-1" aria-hidden="true">add</span>
        Add Step
      </OButton>

      <OButton
        variant="primary"
        size="sm"
        :disabled="readonly"
        data-test="synthetics-journey-record-btn"
        @click="emit('record')"
      >
        <span class="material-icons-outlined tw:text-base tw:leading-none tw:mr-1" aria-hidden="true">fiber_manual_record</span>
        Record
      </OButton>
    </div>

    <!-- Empty state -->
    <div
      v-if="modelValue.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:py-16 tw:text-center"
    >
      <span class="material-icons-outlined tw:text-6xl tw:text-[var(--o2-text-muted)]" aria-hidden="true">open_in_browser</span>
      <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:m-0">No steps yet</h3>
      <div class="tw:flex tw:items-center tw:gap-3">
        <OButton
          variant="primary"
          size="sm"
          @click="emit('record')"
        >
          Record journey
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          @click="addStep"
        >
          Add a step manually
        </OButton>
      </div>
    </div>

    <!-- Step list grouped by page -->
    <div v-else class="tw:flex tw:flex-col tw:gap-1">
      <template v-for="group in filteredGroups" :key="group.pageIndex">
        <!-- Page group header -->
        <button
          type="button"
          class="tw:flex tw:items-center tw:gap-2 tw:py-1 tw:px-2 tw:bg-[var(--o2-bg-subtle)] tw:rounded tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)] tw:mb-1 tw:cursor-pointer tw:w-full tw:text-left tw:border-0"
          @click="toggleGroupCollapse(group.pageIndex)"
        >
          <span class="material-icons-outlined tw:text-base tw:leading-none" aria-hidden="true">
            {{ collapsedGroups.has(group.pageIndex) ? 'chevron_right' : 'expand_more' }}
          </span>
          <span>PAGE {{ group.pageIndex + 1 }}</span>
          <span v-if="group.navigateUrl" class="tw:truncate tw:max-w-[16rem] tw:text-[var(--o2-text-muted)]">
            {{ group.navigateUrl }}
          </span>
          <OBadge variant="default" size="sm">{{ group.steps.length }}</OBadge>
        </button>

        <!-- Steps in group -->
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
