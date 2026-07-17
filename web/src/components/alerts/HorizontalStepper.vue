<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="w-full py-6">
    <div class="flex justify-between items-start relative max-w-300 mx-auto px-4 stepper-container max-md:flex-col max-md:gap-4">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item flex flex-col items-center flex-1 relative cursor-pointer transition-all duration-300 ease-in-out max-md:flex-row max-md:w-full max-md:justify-start"
        :class="{
          'step-active': currentStep === step.id,
          'step-completed': completedSteps.includes(step.id),
          'step-disabled': !canNavigateToStep(step.id),
          'step-error': step.hasError,
          'cursor-not-allowed opacity-50': !canNavigateToStep(step.id)
        }"
        @click="handleStepClick(step.id)"
      >
        <!-- Step indicator -->
        <div class="step-indicator-wrapper flex items-center w-full relative max-md:flex-col max-md:w-auto">
          <div
            class="step-indicator w-10 h-10 rounded-full flex items-center justify-center font-semibold text-base transition-all duration-300 ease-in-out relative z-2 shrink-0 border-2 max-lg:w-9 max-lg:h-9 max-lg:text-sm"
            :class="
              step.hasError
                ? 'bg-stepper-indicator-error text-stepper-indicator-fg border-stepper-indicator-error'
                : completedSteps.includes(step.id) && currentStep !== step.id
                  ? 'bg-stepper-indicator-done text-stepper-indicator-fg border-stepper-indicator-done'
                  : currentStep === step.id
                    ? 'bg-stepper-indicator-active text-stepper-indicator-fg border-stepper-indicator-active shadow-[0_0_0_4px_rgba(25,118,210,0.15)]'
                    : 'bg-stepper-indicator-default text-stepper-indicator-default-text border-border-default'
            "
          >
            <OIcon
              v-if="completedSteps.includes(step.id) && currentStep !== step.id"
              name="check"
              size="sm"
              class="text-white"
            />
            <OIcon
              v-else-if="step.hasError"
              name="error-outline"
              size="sm"
              class="text-white"
            />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <!-- Connector line -->
          <div
            v-if="index < steps.length - 1"
            class="step-connector flex-1 h-0.5 mx-2 transition-all duration-300 ease-in-out max-md:w-0.5 max-md:h-7.5 max-md:mx-0 max-md:my-2"
            :class="
              completedSteps.includes(step.id)
                ? 'bg-stepper-connector-done'
                : 'bg-stepper-connector'
            "
          ></div>
        </div>

        <!-- Step label -->
        <div class="step-label mt-3 text-center max-w-37.5 max-lg:max-w-25 max-md:mt-0 max-md:ml-4 max-md:text-left max-md:max-w-none">
          <div
            class="text-sm font-semibold mb-1"
            :class="
              currentStep === step.id
                ? 'text-stepper-title-active font-bold'
                : 'text-stepper-title-default'
            "
          >{{ step.label }}</div>
          <div
            v-if="step.description"
            class="text-xs opacity-70 text-text-secondary"
          >
            {{ step.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export interface Step {
  id: number;
  label: string;
  description?: string;
  hasError?: boolean;
}

export default defineComponent({
  name: "HorizontalStepper",
  components: {
    OIcon,
  },
  props: {
    currentStep: {
      type: Number,
      required: true,
    },
    completedSteps: {
      type: Array as PropType<number[]>,
      default: () => [],
    },
    steps: {
      type: Array as PropType<Step[]>,
      required: true,
    },
  },
  emits: ["update:currentStep"],
  setup(props, { emit }) {
    const canNavigateToStep = (stepId: number): boolean => {
      // Can always navigate to completed steps or current step
      if (props.completedSteps.includes(stepId) || stepId === props.currentStep) {
        return true;
      }
      // Can navigate to next step if current step is completed
      if (stepId === props.currentStep + 1 && props.completedSteps.includes(props.currentStep)) {
        return true;
      }
      return false;
    };

    const handleStepClick = (stepId: number) => {
      if (canNavigateToStep(stepId)) {
        emit("update:currentStep", stepId);
      }
    };

    return {
      canNavigateToStep,
      handleStepClick,
    };
  },
});
</script>

<style scoped>
/* keep(complex-state): parent :hover (excluding disabled) scales a child indicator */
.step-item:hover:not(.step-disabled) .step-indicator {
  transform: scale(1.1);
}
</style>
