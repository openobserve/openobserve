<script setup lang="ts">
import type {
  OStepperProps,
  OStepperEmits,
  OStepperSlots,
  StepperContext,
  StepperRegisterAPI,
  StepRegistration,
} from './OStepper.types'
import { computed, provide, reactive } from 'vue'
import { STEPPER_CONTEXT_KEY, STEPPER_REGISTER_KEY } from './OStepper.types'
import type { Component } from 'vue'

import OIcon from "@/lib/core/Icon/OIcon.vue";
const props = withDefaults(defineProps<OStepperProps>(), {
  orientation: 'horizontal',
  animated: true,
  navigable: false,
})

const emit = defineEmits<OStepperEmits>()

defineSlots<OStepperSlots>()

// ΓöÇΓöÇ Step registration ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// OStep children register their metadata here so OStepper can render
// the horizontal header row without coupling the template structure.
const registeredSteps = reactive<Map<number, StepRegistration>>(new Map())

const registerAPI: StepperRegisterAPI = {
  registerStep(step) { registeredSteps.set(step.name, step) },
  unregisterStep(name) { registeredSteps.delete(name) },
  updateStep(step) {
    if (registeredSteps.has(step.name)) registeredSteps.set(step.name, step)
  },
}

provide(STEPPER_REGISTER_KEY, registerAPI)

const sortedSteps = computed<StepRegistration[]>(() =>
  [...registeredSteps.values()].sort((a, b) => a.name - b.name),
)

// ΓöÇΓöÇ Navigation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function onStepClick(name: number): void {
  emit('update:modelValue', name)
  emit('change', name)
}

function canNavigateTo(step: StepRegistration): boolean {
  if (!step.done) return false
  return step.navigable !== undefined ? step.navigable : props.navigable
}

// ΓöÇΓöÇ Context (provided to all OStep descendants) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const context = computed<StepperContext>(() => ({
  modelValue: props.modelValue,
  orientation: props.orientation ?? 'horizontal',
  navigable: props.navigable ?? false,
  animated: props.animated ?? true,
  onStepClick,
}))

provide(STEPPER_CONTEXT_KEY, context)

// ΓöÇΓöÇ Layout ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const isHorizontal = computed(() => props.orientation !== 'vertical')

// ΓöÇΓöÇ Horizontal header classes ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function indicatorClasses(step: StepRegistration): string {
  const base = [
    'tw:flex tw:items-center tw:justify-center',
    'tw:size-8 tw:rounded-full tw:shrink-0',
    'tw:text-sm tw:font-semibold tw:leading-none',
    'tw:transition-colors tw:duration-150',
  ].join(' ')

  if (step.error) {
    return `${base} tw:bg-stepper-indicator-error tw:text-stepper-indicator-fg`
  }
  if (step.done) {
    return `${base} tw:bg-stepper-indicator-done tw:text-stepper-indicator-fg`
  }
  if (step.name === props.modelValue) {
    return `${base} tw:bg-stepper-indicator-active tw:text-stepper-indicator-fg`
  }
  return `${base} tw:bg-stepper-indicator-default tw:text-stepper-indicator-default-text`
}

function titleClasses(step: StepRegistration): string {
  if (step.name === props.modelValue) return 'tw:text-xs tw:font-medium tw:text-stepper-title-active'
  if (step.done) return 'tw:text-xs tw:font-medium tw:text-stepper-title-done'
  return 'tw:text-xs tw:font-medium tw:text-stepper-title-default'
}

function triggerClasses(step: StepRegistration): string {
  const base = [
    'tw:flex tw:flex-row tw:items-center tw:gap-2 tw:px-2 tw:py-1.5',
    'tw:rounded-md tw:outline-none tw:select-none',
    'tw:transition-colors tw:duration-150',
  ].join(' ')
  if (canNavigateTo(step)) {
    return [
      base,
      'tw:cursor-pointer',
      'tw:hover:bg-stepper-trigger-hover',
      'tw:focus-visible:ring-2 tw:focus-visible:ring-stepper-trigger-focus-ring',
    ].join(' ')
  }
  return `${base} tw:cursor-default`
}
</script>

<template>
  <div
    role="group"
    aria-label="Steps"
    class="o-stepper tw:flex tw:flex-col"
  >
    <!--
      Horizontal header bar ΓÇö rendered from registered step metadata.
      OStep children register themselves on mount; this row re-renders
      reactively whenever a step's done/error state changes.
    -->
    <div
      v-if="isHorizontal"
      role="list"
      aria-label="Steps"
      class="tw:flex tw:items-start tw:w-full tw:mb-6"
    >
      <template v-for="(step, index) in sortedSteps" :key="step.name">
        <!-- Step trigger (indicator circle + title) -->
        <div role="listitem" class="tw:flex tw:flex-col tw:items-center tw:flex-1 tw:min-w-0">
          <button
            type="button"
            :class="triggerClasses(step)"
            :disabled="!canNavigateTo(step)"
            :aria-current="step.name === modelValue ? 'step' : undefined"
            :aria-disabled="!canNavigateTo(step) && step.name !== modelValue ? true : undefined"
            @click="canNavigateTo(step) && onStepClick(step.name)"
          >
            <!-- Indicator circle -->
            <span :class="indicatorClasses(step)" aria-hidden="true">
              <OIcon name="check" size="sm" v-if="step.done && !step.error" class="tw:size-4" :stroke-width="2.5" />
              <OIcon name="error-outline" size="sm" v-else-if="step.error" class="tw:size-4" :stroke-width="2.5" />
              <component
                :is="step.icon as Component"
                v-else-if="step.icon"
                class="tw:size-4"
              />
              <span v-else>{{ step.name }}</span>
            </span>
            <!-- Title + Description (stacked vertically, right of indicator) -->
            <span class="tw:flex tw:flex-col tw:items-start tw:min-w-0">
              <span :class="titleClasses(step)">{{ step.title }}</span>
              <span
                v-if="step.description"
                class="tw:text-[11px] tw:text-text-secondary tw:mt-0.5 tw:leading-tight"
              >
                {{ step.description }}
              </span>
            </span>
          </button>
        </div>

        <!-- Connector line between consecutive steps -->
        <div
          v-if="index < sortedSteps.length - 1"
          class="tw:h-px tw:flex-1 tw:shrink tw:mt-4 tw:mx-1 tw:min-w-[8px]"
          :class="step.done ? 'tw:bg-stepper-connector-done' : 'tw:bg-stepper-connector'"
          aria-hidden="true"
        />
      </template>
    </div>

    <!-- Step content panels (OStep children render here for both orientations) -->
    <div :class="isHorizontal ? 'tw:flex-1 tw:min-w-0' : 'tw:flex tw:flex-col tw:gap-0'">
      <slot />
    </div>
  </div>
</template>
