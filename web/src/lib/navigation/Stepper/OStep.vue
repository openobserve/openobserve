<script setup lang="ts">
import type { OStepProps, OStepSlots } from "./OStep.types";
import type { StepperContext, StepperRegisterAPI } from "./OStepper.types";
import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  watch,
  type ComputedRef,
  type Component,
} from "vue";
import { STEPPER_CONTEXT_KEY, STEPPER_REGISTER_KEY } from "./OStepper.types";

import OIcon from "@/lib/core/Icon/OIcon.vue";
const props = withDefaults(defineProps<OStepProps>(), {
  done: false,
  error: false,
  navigable: undefined,
});

defineSlots<OStepSlots>();

// ΓöÇΓöÇ Context injection ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const context = inject<ComputedRef<StepperContext>>(STEPPER_CONTEXT_KEY);
const registerAPI = inject<StepperRegisterAPI>(STEPPER_REGISTER_KEY);

const isActive = computed<boolean>(() => context?.value.modelValue === props.name);
const isVertical = computed<boolean>(() => context?.value.orientation === "vertical");
const animated = computed<boolean>(() => context?.value.animated ?? true);
/** Checklist mode (from OStepper): render every step's panel, not just the
 *  active one. */
const expanded = computed<boolean>(() => context?.value.expanded ?? false);

// ── Height transition hooks (like OCollapsible) ─────────────────────────
function onBeforeEnter(el: Element) {
  const htmlEl = el as HTMLElement;
  htmlEl.style.height = "0";
  htmlEl.style.opacity = "0";
  htmlEl.style.overflow = "hidden";
}

function onEnter(el: Element, done: () => void) {
  const htmlEl = el as HTMLElement;
  const height = htmlEl.scrollHeight;
  htmlEl.style.transition = "height 0.25s ease-out, opacity 0.25s ease-out";
  requestAnimationFrame(() => {
    if (!htmlEl.isConnected) {
      done();
      return;
    }
    htmlEl.style.height = `${height}px`;
    htmlEl.style.opacity = "1";
  });
  htmlEl.addEventListener(
    "transitionend",
    () => {
      htmlEl.style.height = "";
      htmlEl.style.overflow = "";
      htmlEl.style.transition = "";
      done();
    },
    { once: true },
  );
}

function onLeave(el: Element, done: () => void) {
  const htmlEl = el as HTMLElement;
  htmlEl.style.height = `${htmlEl.scrollHeight}px`;
  htmlEl.style.overflow = "hidden";
  htmlEl.style.transition = "height 0.2s ease-out, opacity 0.2s ease-out";
  requestAnimationFrame(() => {
    if (!htmlEl.isConnected) {
      done();
      return;
    }
    htmlEl.style.height = "0";
    htmlEl.style.opacity = "0";
  });
  htmlEl.addEventListener(
    "transitionend",
    () => {
      htmlEl.style.opacity = "";
      done();
    },
    { once: true },
  );
}

const canClick = computed<boolean>(() => {
  if (!props.done) return false;
  const stepNav = props.navigable;
  const rootNav = context?.value.navigable ?? false;
  return stepNav !== undefined ? stepNav : rootNav;
});

// ΓöÇΓöÇ Registration ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// OStep registers its metadata with OStepper so the horizontal header "row"
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
  };
}

onMounted(() => registerAPI?.registerStep(buildRegistration()));
onUnmounted(() => registerAPI?.unregisterStep(props.name));

// Keep registered metadata in sync when reactive props change.
// `done` is the most important ΓÇö it changes as the parent step counter increments.
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
);

// ΓöÇΓöÇ Navigation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function handleClick(): void {
  if (!canClick.value) return;
  context?.value.onStepClick(props.name);
}

// ΓöÇΓöÇ Vertical indicator classes ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const indicatorClasses = computed<string>(() => {
  const base = [
    "flex items-center justify-center",
    "size-8 rounded-full shrink-0",
    "text-sm font-semibold leading-none",
    "transition-colors duration-150",
  ].join(" ");

  const cursor = canClick.value ? "cursor-pointer" : "cursor-default";

  if (props.error) {
    return `${base} ${cursor} bg-stepper-indicator-error text-stepper-indicator-fg`;
  }
  if (props.done) {
    return `${base} ${cursor} bg-stepper-indicator-done text-stepper-indicator-fg`;
  }
  if (isActive.value) {
    return `${base} ${cursor} bg-stepper-indicator-active text-stepper-indicator-fg`;
  }
  return `${base} ${cursor} bg-stepper-indicator-default text-stepper-indicator-default-text`;
});

const titleClasses = computed<string>(() => {
  const base = "text-sm font-medium leading-tight";
  if (isActive.value) return `${base} text-stepper-title-active`;
  if (props.done) return `${base} text-stepper-title-done`;
  return `${base} text-stepper-title-default`;
});

const triggerClasses = computed<string>(() => {
  const base = [
    "flex items-center gap-3 w-full text-start",
    "rounded-default px-1.5 py-1.5 outline-none select-none",
    "transition-colors duration-150",
  ].join(" ");
  if (canClick.value) {
    return [
      base,
      "cursor-pointer",
      "hover:bg-stepper-trigger-hover",
      "focus-visible:ring-2 focus-visible:ring-stepper-trigger-focus-ring",
    ].join(" ");
  }
  return `${base} cursor-default`;
});
</script>

<template>
  <!--
    VERTICAL orientation: Each OStep renders its own header trigger + content panel.
    The header (indicator circle + title) is above the indented content area.
    The connecting line is the left border on the content area.
  -->
  <div v-if="isVertical" class="o-step flex flex-row min-w-0">
    <!-- Left column: indicator + vertical connector line -->
    <div class="flex flex-col items-center me-3 shrink-0">
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
        <OIcon name="check" size="sm" v-if="done && !error" class="size-4" :stroke-width="2.5" />
        <OIcon
          name="error-outline"
          size="sm"
          v-else-if="error"
          class="size-4"
          :stroke-width="2.5"
        />
        <OIcon v-else-if="typeof icon === 'string'" :name="icon as any" class="size-4" />
        <component :is="icon as Component" v-else-if="icon" class="size-4" />
        <span v-else aria-hidden="true">{{ name }}</span>
      </button>
      <!-- Vertical connector line below the indicator (hidden for the last step
           via CSS). Turns "done" once this step is complete, so a checklist
           shows progress flowing down the rail. -->
      <div
        class="flex-1 w-px mt-1 [.o-step:last-child_&]:hidden"
        :class="done ? 'bg-stepper-connector-done' : 'bg-stepper-connector'"
        aria-hidden="true"
      />
    </div>

    <!-- Right column: title button + content panel -->
    <div class="flex flex-col flex-1 min-w-0 pb-6">
      <!-- Title row (also clickable when navigable) -->
      <button
        type="button"
        :class="triggerClasses"
        :disabled="!canClick"
        :aria-current="isActive ? 'step' : undefined"
        @click="handleClick"
      >
        <span class="flex flex-col items-start min-w-0">
          <span class="flex items-center gap-2 flex-wrap">
            <span :class="titleClasses">{{ title }}</span>
            <slot name="title-suffix" />
          </span>
          <span v-if="description" class="text-xs text-text-secondary mt-0.5 leading-tight">
            {{ description }}
          </span>
        </span>
      </button>

      <!-- Content panel. Expanded (checklist) mode: always rendered, no
           transition. Wizard mode: only the active step, animated. -->
      <div class="mt-2 min-w-0">
        <div v-if="expanded">
          <slot />
        </div>
        <template v-else>
          <Transition
            v-if="animated"
            :css="false"
            @before-enter="onBeforeEnter"
            @enter="onEnter"
            @leave="onLeave"
            mode="out-in"
          >
            <div v-if="isActive" :key="name">
              <slot />
            </div>
          </Transition>
          <div v-else-if="isActive">
            <slot />
          </div>
        </template>
      </div>
    </div>
  </div>

  <!--
    HORIZONTAL orientation: OStep renders ONLY the content panel.
    The header indicators are rendered by OStepper from registered metadata.
  -->
  <template v-else>
    <!-- Expanded (checklist) mode: always rendered, no transition. -->
    <div
      v-if="expanded"
      class="o-step-content w-full min-w-0"
      role="region"
      :aria-label="`${title}`"
    >
      <slot />
    </div>
    <template v-else>
      <Transition
        v-if="animated"
        :css="false"
        @before-enter="onBeforeEnter"
        @enter="onEnter"
        @leave="onLeave"
        mode="out-in"
      >
        <div
          v-if="isActive"
          :key="name"
          class="o-step-content w-full min-w-0"
          role="region"
          :aria-label="`${title}`"
        >
          <slot />
        </div>
      </Transition>
      <div
        v-else-if="!animated && isActive"
        class="o-step-content w-full min-w-0"
        role="region"
        :aria-label="`${title}`"
      >
        <slot />
      </div>
    </template>
  </template>
</template>
