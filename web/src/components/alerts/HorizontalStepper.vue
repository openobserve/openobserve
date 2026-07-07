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
    <div class="flex justify-between items-start relative max-w-[1200px] mx-auto px-4 stepper-container">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item flex flex-col items-center flex-1 relative cursor-pointer transition-all duration-300 ease-in-out"
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
        <div class="step-indicator-wrapper flex items-center w-full relative">
          <div
            class="step-indicator w-[40px] h-[40px] rounded-full flex items-center justify-center font-semibold text-base transition-all duration-300 ease-in-out relative z-[2] shrink-0 border-2"
            :class="
              step.hasError
                ? 'bg-[#d32f2f] text-white border-[#d32f2f]'
                : completedSteps.includes(step.id) && currentStep !== step.id
                  ? 'bg-[#2e7d32] text-white border-[#2e7d32]'
                  : currentStep === step.id
                    ? isDarkMode
                      ? 'bg-[#1976d2] text-white border-[#1976d2] shadow-[0_0_0_4px_rgba(25,118,210,0.2)]'
                      : 'bg-[#1976d2] text-white border-[#1976d2] shadow-[0_0_0_4px_rgba(25,118,210,0.1)]'
                    : isDarkMode
                      ? 'bg-[#424242] text-[#9e9e9e] border-[#616161]'
                      : 'bg-[#f5f5f5] text-[#757575] border-[var(--o2-border)]'
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
            class="step-connector flex-1 h-[2px] mx-2 transition-all duration-300 ease-in-out"
            :class="
              completedSteps.includes(step.id)
                ? 'bg-[#2e7d32]'
                : isDarkMode
                  ? 'bg-[#616161]'
                  : 'bg-[var(--o2-border)]'
            "
          ></div>
        </div>

        <!-- Step label -->
        <div class="step-label mt-3 text-center max-w-[150px]">
          <div
            class="text-sm font-semibold mb-1"
            :class="
              currentStep === step.id
                ? isDarkMode
                  ? 'text-white'
                  : 'text-[#1976d2] font-bold'
                : isDarkMode
                  ? 'text-[var(--o2-border)]'
                  : 'text-[#424242]'
            "
          >{{ step.label }}</div>
          <div
            v-if="step.description"
            class="text-xs opacity-70"
            :class="isDarkMode ? 'text-[#bdbdbd]' : 'text-[#757575]'"
          >
            {{ step.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";
import { useStore } from "vuex";
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
    const store = useStore();

    const isDarkMode = computed(() => store.state.theme === "dark");

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
      isDarkMode,
      canNavigateToStep,
      handleStepClick,
    };
  },
});
</script>

<style>
.step-item:hover:not(.step-disabled) .step-indicator {
  transform: scale(1.1);
}

/* Responsive design */
@media (max-width: 1024px) {
  .step-label {
    max-width: 100px;
  }

  .step-indicator {
    width: 36px;
    height: 36px;
    font-size: 14px;
  }
}

@media (max-width: 768px) {
  .stepper-container {
    flex-direction: column;
    gap: 1rem;
  }

  .step-item {
    flex-direction: row;
    width: 100%;
    align-items: center;
    justify-content: flex-start;
  }

  .step-indicator-wrapper {
    flex-direction: column;
    width: auto;
  }

  .step-connector {
    width: 2px;
    height: 30px;
    margin: 0.5rem 0;
  }

  .step-label {
    margin-top: 0;
    margin-left: 1rem;
    text-align: left;
    max-width: none;
  }
}
</style>
