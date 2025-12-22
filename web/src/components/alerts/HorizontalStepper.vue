<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="horizontal-stepper" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="stepper-container">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item"
        :class="{
          'step-active': currentStep === step.id,
          'step-completed': completedSteps.includes(step.id),
          'step-disabled': !canNavigateToStep(step.id),
          'step-error': step.hasError
        }"
        @click="handleStepClick(step.id)"
      >
        <!-- Step indicator -->
        <div class="step-indicator-wrapper">
          <div class="step-indicator">
            <q-icon
              v-if="completedSteps.includes(step.id) && currentStep !== step.id"
              name="check"
              size="18px"
              class="step-icon-check"
            />
            <q-icon
              v-else-if="step.hasError"
              name="error_outline"
              size="18px"
              class="step-icon-error"
            />
            <span v-else class="step-number">{{ index + 1 }}</span>
          </div>
          <!-- Connector line -->
          <div
            v-if="index < steps.length - 1"
            class="step-connector"
            :class="{
              'connector-active': completedSteps.includes(step.id)
            }"
          ></div>
        </div>

        <!-- Step label -->
        <div class="step-label">
          <div class="step-title">{{ step.label }}</div>
          <div v-if="step.description" class="step-description">
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

export interface Step {
  id: number;
  label: string;
  description?: string;
  hasError?: boolean;
}

export default defineComponent({
  name: "HorizontalStepper",
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

<style scoped lang="scss">
.horizontal-stepper {
  width: 100%;
  padding: 1.5rem 0;

  .stepper-container {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1rem;
  }

  .step-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    position: relative;
    cursor: pointer;
    transition: all 0.3s ease;

    &.step-disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    &:hover:not(.step-disabled) {
      .step-indicator {
        transform: scale(1.1);
      }
    }
  }

  .step-indicator-wrapper {
    display: flex;
    align-items: center;
    width: 100%;
    position: relative;
  }

  .step-indicator {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 16px;
    transition: all 0.3s ease;
    position: relative;
    z-index: 2;
    flex-shrink: 0;
  }

  .step-connector {
    flex: 1;
    height: 2px;
    margin: 0 0.5rem;
    transition: all 0.3s ease;
  }

  .step-label {
    margin-top: 0.75rem;
    text-align: center;
    max-width: 150px;
  }

  .step-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .step-description {
    font-size: 12px;
    opacity: 0.7;
  }

  // Dark mode styles
  &.dark-mode {
    .step-indicator {
      background-color: #424242;
      color: #9e9e9e;
      border: 2px solid #616161;
    }

    .step-connector {
      background-color: #616161;
    }

    .step-active .step-indicator {
      background-color: #1976d2;
      color: #ffffff;
      border-color: #1976d2;
      box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .step-completed .step-indicator {
      background-color: #2e7d32;
      color: #ffffff;
      border-color: #2e7d32;
    }

    .step-completed .step-connector {
      background-color: #2e7d32;
    }

    .step-error .step-indicator {
      background-color: #d32f2f;
      color: #ffffff;
      border-color: #d32f2f;
    }

    .step-title {
      color: #e0e0e0;
    }

    .step-description {
      color: #bdbdbd;
    }

    .step-active .step-title {
      color: #ffffff;
    }
  }

  // Light mode styles
  &.light-mode {
    .step-indicator {
      background-color: #f5f5f5;
      color: #757575;
      border: 2px solid #e0e0e0;
    }

    .step-connector {
      background-color: #e0e0e0;
    }

    .step-active .step-indicator {
      background-color: #1976d2;
      color: #ffffff;
      border-color: #1976d2;
      box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.1);
    }

    .step-completed .step-indicator {
      background-color: #2e7d32;
      color: #ffffff;
      border-color: #2e7d32;
    }

    .step-completed .step-connector {
      background-color: #2e7d32;
    }

    .step-error .step-indicator {
      background-color: #d32f2f;
      color: #ffffff;
      border-color: #d32f2f;
    }

    .step-title {
      color: #424242;
    }

    .step-description {
      color: #757575;
    }

    .step-active .step-title {
      color: #1976d2;
      font-weight: 700;
    }
  }

  .step-icon-check,
  .step-icon-error {
    color: #ffffff;
  }
}

// Responsive design
@media (max-width: 1024px) {
  .horizontal-stepper {
    .step-label {
      max-width: 100px;
    }

    .step-title {
      font-size: 12px;
    }

    .step-description {
      font-size: 10px;
    }

    .step-indicator {
      width: 36px;
      height: 36px;
      font-size: 14px;
    }
  }
}

@media (max-width: 768px) {
  .horizontal-stepper {
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
}
</style>
