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
  expanded: false,
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
  expanded: props.expanded ?? false,
  onStepClick,
}))

provide(STEPPER_CONTEXT_KEY, context)

// ΓöÇΓöÇ Layout ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const isHorizontal = computed(() => props.orientation !== 'vertical')

// ΓöÇΓöÇ Horizontal header classes ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function indicatorClasses(step: StepRegistration): string {
  const base = [
    'flex items-center justify-center',
    'size-8 rounded-full shrink-0',
    'text-sm font-semibold leading-none',
    'transition-colors duration-150',
  ].join(' ')

  if (step.error) {
    return `${base} bg-stepper-indicator-error text-stepper-indicator-fg`
  }
  if (step.done) {
    return `${base} bg-stepper-indicator-done text-stepper-indicator-fg`
  }
  if (step.name === props.modelValue) {
    return `${base} bg-stepper-indicator-active text-stepper-indicator-fg`
  }
  return `${base} bg-stepper-indicator-default text-stepper-indicator-default-text`
}

function titleClasses(step: StepRegistration): string {
  if (step.name === props.modelValue) return 'text-xs font-medium text-stepper-title-active'
  if (step.done) return 'text-xs font-medium text-stepper-title-done'
  return 'text-xs font-medium text-stepper-title-default'
}

function triggerClasses(step: StepRegistration): string {
  const base = [
    'flex flex-row items-center gap-2 px-2 py-1.5',
    'rounded-default outline-none select-none',
    'transition-colors duration-150',
  ].join(' ')
  if (canNavigateTo(step)) {
    return [
      base,
      'cursor-pointer',
      'hover:bg-stepper-trigger-hover',
      'focus-visible:ring-2 focus-visible:ring-stepper-trigger-focus-ring',
    ].join(' ')
  }
  return `${base} cursor-default`
}
</script>

<template>
  <div
    role="group"
    aria-label="Steps"
    class="o-stepper flex flex-col"
  >
    <!--
      Horizontal header bar ΓÇö rendered from registered step metadata.
      OStep children register themselves on mount; this flex re-renders
      reactively whenever a step's done/error state changes.
    -->
    <div
      v-if="isHorizontal"
      role="list"
      aria-label="Steps"
      class="sticky top-0 z-10 flex items-start w-full pb-2 bg-surface-base!"
    >
      <template v-for="(step, index) in sortedSteps" :key="step.name">
        <!-- Step trigger (indicator circle + title) -->
        <div role="listitem" class="flex flex-col items-center shrink-0">
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
              <OIcon name="check" size="sm" v-if="step.done && !step.error" class="size-4" :stroke-width="2.5" />
              <OIcon name="error-outline" size="sm" v-else-if="step.error" class="size-4" :stroke-width="2.5" />
              <OIcon v-else-if="typeof step.icon === 'string'" :name="(step.icon as any)" class="size-4" />
              <component
                :is="step.icon as Component"
                v-else-if="step.icon"
                class="size-4"
              />
              <span v-else>{{ step.name }}</span>
            </span>
            <!-- Title + Description (stacked vertically, right of indicator) -->
            <span class="flex flex-col items-start min-w-0">
              <span :class="titleClasses(step)">{{ step.title }}</span>
              <span
                v-if="step.description"
                class="text-2xs text-text-secondary mt-0.5 leading-tight"
              >
                {{ step.description }}
              </span>
            </span>
          </button>
        </div>

        <!-- Connector line between consecutive steps -->
        <div
          v-if="index < sortedSteps.length - 1"
          class="h-px flex-1 shrink mt-5.5 mx-1 min-w-2"
          :class="step.done ? 'bg-stepper-connector-done' : 'bg-stepper-connector'"
          aria-hidden="true"
        />
      </template>
    </div>

    <!-- Step content panels (OStep children render here for both orientations) -->
    <div :class="isHorizontal ? 'flex-1 min-w-0' : 'flex flex-col gap-0'">
      <slot />
    </div>
  </div>
</template>
