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
  <div class="horizontal-stepper tw:w-full tw:py-6" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="stepper-container tw:flex tw:justify-between tw:items-start tw:relative tw:max-w-[1200px] tw:mx-auto tw:px-4">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item tw:flex tw:flex-col tw:items-center tw:flex-1 tw:relative tw:cursor-pointer tw:transition-all tw:duration-300 tw:ease-in-out"
        :class="{
          'step-active': currentStep === step.id,
          'step-completed': completedSteps.includes(step.id),
          'step-disabled': !canNavigateToStep(step.id),
          'step-error': step.hasError
        }"
        @click="handleStepClick(step.id)"
      >
        <!-- Step indicator -->
        <div class="step-indicator-wrapper tw:flex tw:items-center tw:w-full tw:relative">
          <div class="step-indicator tw:w-[40px] tw:h-[40px] tw:rounded-full tw:flex tw:items-center tw:justify-center tw:font-semibold tw:text-base tw:transition-all tw:duration-300 tw:ease-in-out tw:relative tw:z-[2] tw:shrink-0">
            <OIcon
              v-if="completedSteps.includes(step.id) && currentStep !== step.id"
              name="check"
              size="sm"
              class="step-icon-check tw:text-white"
            />
            <OIcon
              v-else-if="step.hasError"
              name="error-outline"
              size="sm"
              class="step-icon-error tw:text-white"
            />
            <span v-else class="step-number">{{ index + 1 }}</span>
          </div>
          <!-- Connector line -->
          <div
            v-if="index < steps.length - 1"
            class="step-connector tw:flex-1 tw:h-[2px] tw:mx-2 tw:transition-all tw:duration-300 tw:ease-in-out"
            :class="{
              'connector-active': completedSteps.includes(step.id)
            }"
          ></div>
        </div>

        <!-- Step label -->
        <div class="step-label tw:mt-3 tw:text-center tw:max-w-[150px]">
          <div class="step-title tw:text-sm tw:font-semibold tw:mb-1">{{ step.label }}</div>
          <div v-if="step.description" class="step-description tw:text-xs tw:opacity-70">
            {{ step.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
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
      store,
      canNavigateToStep,
      handleStepClick,
    };
  },
});
</script>

<style>
.horizontal-stepper .step-item.step-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.horizontal-stepper .step-item:hover:not(.step-disabled) .step-indicator {
  transform: scale(1.1);
}

/* Dark mode styles */
.horizontal-stepper.dark-mode .step-indicator {
  background-color: #424242;
  color: #9e9e9e;
  border: 2px solid #616161;
}

.horizontal-stepper.dark-mode .step-connector {
  background-color: #616161;
}

.horizontal-stepper.dark-mode .step-active .step-indicator {
  background-color: #1976d2;
  color: #ffffff;
  border-color: #1976d2;
  box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
}

.horizontal-stepper.dark-mode .step-completed .step-indicator {
  background-color: #2e7d32;
  color: #ffffff;
  border-color: #2e7d32;
}

.horizontal-stepper.dark-mode .step-completed .step-connector {
  background-color: #2e7d32;
}

.horizontal-stepper.dark-mode .step-error .step-indicator {
  background-color: #d32f2f;
  color: #ffffff;
  border-color: #d32f2f;
}

.horizontal-stepper.dark-mode .step-title {
  color: var(--o2-border);
}

.horizontal-stepper.dark-mode .step-description {
  color: #bdbdbd;
}

.horizontal-stepper.dark-mode .step-active .step-title {
  color: #ffffff;
}

/* Light mode styles */
.horizontal-stepper.light-mode .step-indicator {
  background-color: #f5f5f5;
  color: #757575;
  border: 2px solid var(--o2-border);
}

.horizontal-stepper.light-mode .step-connector {
  background-color: var(--o2-border);
}

.horizontal-stepper.light-mode .step-active .step-indicator {
  background-color: #1976d2;
  color: #ffffff;
  border-color: #1976d2;
  box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.1);
}

.horizontal-stepper.light-mode .step-completed .step-indicator {
  background-color: #2e7d32;
  color: #ffffff;
  border-color: #2e7d32;
}

.horizontal-stepper.light-mode .step-completed .step-connector {
  background-color: #2e7d32;
}

.horizontal-stepper.light-mode .step-error .step-indicator {
  background-color: #d32f2f;
  color: #ffffff;
  border-color: #d32f2f;
}

.horizontal-stepper.light-mode .step-title {
  color: #424242;
}

.horizontal-stepper.light-mode .step-description {
  color: #757575;
}

.horizontal-stepper.light-mode .step-active .step-title {
  color: #1976d2;
  font-weight: 700;
}

/* Responsive design */
@media (max-width: 1024px) {
  .horizontal-stepper .step-label {
    max-width: 100px;
  }

  .horizontal-stepper .step-title {
    font-size: 12px;
  }

  .horizontal-stepper .step-description {
    font-size: 10px;
  }

  .horizontal-stepper .step-indicator {
    width: 36px;
    height: 36px;
    font-size: 14px;
  }
}

@media (max-width: 768px) {
  .horizontal-stepper .stepper-container {
    flex-direction: column;
    gap: 1rem;
  }

  .horizontal-stepper .step-item {
    flex-direction: row;
    width: 100%;
    align-items: center;
    justify-content: flex-start;
  }

  .horizontal-stepper .step-indicator-wrapper {
    flex-direction: column;
    width: auto;
  }

  .horizontal-stepper .step-connector {
    width: 2px;
    height: 30px;
    margin: 0.5rem 0;
  }

  .horizontal-stepper .step-label {
    margin-top: 0;
    margin-left: 1rem;
    text-align: left;
    max-width: none;
  }
}
</style>
