<script setup lang="ts">
import type { OStepProps, OStepSlots } from './OStep.types'
import type { StepperContext, StepperRegisterAPI } from './OStepper.types'
import { computed, inject, onMounted, onUnmounted, watch, type ComputedRef, type Component } from 'vue'
import { STEPPER_CONTEXT_KEY, STEPPER_REGISTER_KEY } from './OStepper.types'
import { Check, AlertCircle } from 'lucide-vue-next'

const props = withDefaults(defineProps<OStepProps>(), {
  done: false,
  error: false,
  navigable: undefined,
})

defineSlots<OStepSlots>()

// ── Context injection ─────────────────────────────────────────────────────
const context = inject<ComputedRef<StepperContext>>(STEPPER_CONTEXT_KEY)
const registerAPI = inject<StepperRegisterAPI>(STEPPER_REGISTER_KEY)

const isActive = computed<boolean>(() => context?.value.modelValue === props.name)
const isVertical = computed<boolean>(() => context?.value.orientation === 'vertical')
const animated = computed<boolean>(() => context?.value.animated ?? true)

const canClick = computed<boolean>(() => {
  if (!props.done) return false
  const stepNav = props.navigable
  const rootNav = context?.value.navigable ?? false
  return stepNav !== undefined ? stepNav : rootNav
})

// ── Registration ──────────────────────────────────────────────────────────
// OStep registers its metadata with OStepper so the horizontal header row
// can be rendered without requiring a separate data prop on OStepper itself.
function buildRegistration() {
  return {
    name: props.name,
    title: props.title,
    icon: props.icon ?? null,
    done: props.done ?? false,
    error: props.error ?? false,
    description: props.description,
    navigable: props.navigable,
  }
}

onMounted(() => registerAPI?.registerStep(buildRegistration()))
onUnmounted(() => registerAPI?.unregisterStep(props.name))

// Keep registered metadata in sync when reactive props change.
// `done` is the most important — it changes as the parent step counter increments.
watch(
  () => ({
    done: props.done,
    error: props.error,
    title: props.title,
    icon: props.icon,
    description: props.description,
    navigable: props.navigable,
  }),
  () => registerAPI?.updateStep(buildRegistration()),
)

// ── Navigation ────────────────────────────────────────────────────────────
function handleClick(): void {
  if (!canClick.value) return
  context?.value.onStepClick(props.name)
}

// ── Vertical indicator classes ────────────────────────────────────────────
const indicatorClasses = computed<string>(() => {
  const base = [
    'tw:flex tw:items-center tw:justify-center',
    'tw:size-8 tw:rounded-full tw:shrink-0',
    'tw:text-sm tw:font-semibold tw:leading-none',
    'tw:transition-colors tw:duration-150',
  ].join(' ')

  if (props.error) {
    return `${base} tw:bg-stepper-indicator-error tw:text-stepper-indicator-fg`
  }
  if (props.done) {
    return `${base} tw:bg-stepper-indicator-done tw:text-stepper-indicator-fg`
  }
  if (isActive.value) {
    return `${base} tw:bg-stepper-indicator-active tw:text-stepper-indicator-fg`
  }
  return `${base} tw:bg-stepper-indicator-default tw:text-stepper-indicator-default-text`
})

const titleClasses = computed<string>(() => {
  const base = 'tw:text-sm tw:font-medium tw:leading-tight'
  if (isActive.value) return `${base} tw:text-stepper-title-active`
  if (props.done) return `${base} tw:text-stepper-title-done`
  return `${base} tw:text-stepper-title-default`
})

const triggerClasses = computed<string>(() => {
  const base = [
    'tw:flex tw:items-center tw:gap-3 tw:w-full tw:text-start',
    'tw:rounded-md tw:px-1.5 tw:py-1.5 tw:outline-none tw:select-none',
    'tw:transition-colors tw:duration-150',
  ].join(' ')
  if (canClick.value) {
    return [
      base,
      'tw:cursor-pointer',
      'tw:hover:bg-stepper-trigger-hover',
      'tw:focus-visible:ring-2 tw:focus-visible:ring-stepper-trigger-focus-ring',
    ].join(' ')
  }
  return `${base} tw:cursor-default`
})
</script>

<template>
  <!--
    VERTICAL orientation: Each OStep renders its own header trigger + content panel.
    The header (indicator circle + title) is above the indented content area.
    The connecting line is the left border on the content area.
  -->
  <div v-if="isVertical" class="o-step tw:flex tw:flex-row tw:min-w-0">
    <!-- Left column: indicator + vertical connector line -->
    <div class="tw:flex tw:flex-col tw:items-center tw:me-3 tw:shrink-0">
      <!-- Indicator circle (the clickable trigger in vertical mode) -->
      <button
        type="button"
        :class="indicatorClasses"
        :disabled="!canClick"
        :aria-current="isActive ? 'step' : undefined"
        :aria-disabled="!canClick && !isActive ? true : undefined"
        :title="title"
        @click="handleClick"
      >
        <Check v-if="done && !error" class="tw:size-4" :stroke-width="2.5" />
        <AlertCircle v-else-if="error" class="tw:size-4" :stroke-width="2.5" />
        <component :is="icon as Component" v-else-if="icon" class="tw:size-4" />
        <span v-else aria-hidden="true">{{ name }}</span>
      </button>
      <!-- Vertical connector line below the indicator (hidden for the last step via CSS) -->
      <div class="tw:flex-1 tw:w-px tw:mt-1 tw:bg-stepper-connector tw:[.o-step:last-child_&]:hidden" aria-hidden="true" />
    </div>

    <!-- Right column: title button + content panel -->
    <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:pb-6">
      <!-- Title row (also clickable when navigable) -->
      <button
        type="button"
        :class="triggerClasses"
        :disabled="!canClick"
        :aria-current="isActive ? 'step' : undefined"
        @click="handleClick"
      >
        <span class="tw:flex tw:flex-col tw:items-start tw:min-w-0">
          <span :class="titleClasses">{{ title }}</span>
          <span
            v-if="description"
            class="tw:text-xs tw:text-text-secondary tw:mt-0.5 tw:leading-tight"
          >
            {{ description }}
          </span>
        </span>
      </button>

      <!-- Content panel (visible only when active) -->
      <div class="tw:mt-2 tw:min-w-0">
        <Transition v-if="animated" name="o-step-fade" mode="out-in">
          <div v-if="isActive" key="step-content">
            <slot />
          </div>
        </Transition>
        <div v-else-if="isActive">
          <slot />
        </div>
      </div>
    </div>
  </div>

  <!--
    HORIZONTAL orientation: OStep renders ONLY the content panel.
    The header indicators are rendered by OStepper from registered metadata.
  -->
  <template v-else>
    <Transition v-if="animated" name="o-step-fade" mode="out-in">
      <div
        v-if="isActive"
        key="step-content"
        class="o-step-content tw:w-full tw:min-w-0"
        role="region"
        :aria-label="`${title}`"
      >
        <slot />
      </div>
    </Transition>
    <div
      v-else-if="!animated && isActive"
      class="o-step-content tw:w-full tw:min-w-0"
      role="region"
      :aria-label="`${title}`"
    >
      <slot />
    </div>
  </template>
</template>

<style scoped>
/* Fade transition for step content panels */
.o-step-fade-enter-active,
.o-step-fade-leave-active {
  transition: opacity 0.18s ease;
}

.o-step-fade-enter-from,
.o-step-fade-leave-to {
  opacity: 0;
}
</style>
