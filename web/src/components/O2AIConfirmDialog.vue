<template>
  <div v-if="visible" class="confirmation-overlay w-full mb-2 [animation:slideUp_0.25s_ease-out]">
    <div
      class="confirmation-dialog w-full pt-4 px-4 pb-[14px] rounded-xl flex flex-col gap-[14px] shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
      :class="theme === 'dark' ? 'dark-mode bg-[#1e1e1e] border-2 border-[#323232] shadow-[0_2px_8px_rgba(0,0,0,0.3)]' : 'light-mode bg-white border-2 border-[#e4e7ec] shadow-[0_2px_8px_rgba(0,0,0,0.1)]'"
      @keydown="handleDialogKeydown"
      @click="handleDialogClick"
    >
      <div class="confirmation-header flex items-start gap-3">
        <OIcon name="help-outline" size="md" class="confirmation-icon shrink-0 mt-[2px]" :class="theme === 'dark' ? 'text-[#9ca3af]' : 'text-[#6b7280]'" />
        <span class="confirmation-title flex-1 text-[15px] font-medium leading-normal" :class="theme === 'dark' ? 'text-[#f3f4f6]' : 'text-[#1f2937]'">{{ formattedMessage }}</span>
      </div>

      <div class="confirmation-buttons flex flex-col gap-[10px] w-full pt-[14px] mt-1" :class="theme === 'dark' ? 'border-t border-[#374151]' : 'border-t border-[#e5e7eb]'">
        <!-- For navigation actions, show 3 buttons -->
        <template v-if="isNavigationAction">
          <OButton
            ref="yesButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn confirm-btn w-full text-sm font-semibold rounded-md normal-case tracking-normal transition-all duration-200 text-[var(--q-primary)] border-2 border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-transparent hover:bg-[#eff6ff] hover:border-[var(--q-primary)] dark:hover:bg-[rgba(59,130,246,0.1)] dark:hover:border-[var(--q-primary)]"
            :class="{ 'btn-focused': isFocusedYes }"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          >Allow</OButton>
          <OButton
            ref="alwaysButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn always-btn w-full text-sm font-semibold rounded-md normal-case tracking-normal transition-all duration-200 text-[#059669] dark:text-[#34d399] border-2 border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-transparent hover:bg-[#f0fdf4] hover:border-[#34d399] dark:hover:bg-[rgba(5,150,105,0.1)] dark:hover:border-[#34d399]"
            :class="{ 'btn-focused': isFocusedAlways }"
            tabindex="1"
            @click="handleAlwaysConfirm"
            @focus="handleAlwaysFocus"
            @blur="handleAlwaysBlur"
          >Always Allow</OButton>
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn cancel-btn w-full text-sm font-semibold rounded-md normal-case tracking-normal transition-all duration-200 text-[#374151] dark:text-[#e5e7eb] border-2 border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-transparent hover:bg-[#fef2f2] hover:border-[#fca5a5] dark:hover:bg-[rgba(239,68,68,0.1)] dark:hover:border-[#f87171]"
            :class="{ 'btn-focused': isFocusedNo }"
            tabindex="2"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
          >No</OButton>
        </template>

        <!-- For other actions, show 2 buttons -->
        <template v-else>
          <OButton
            ref="yesButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn confirm-btn w-full text-sm font-semibold rounded-md normal-case tracking-normal transition-all duration-200 text-[var(--q-primary)] border-2 border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-transparent hover:bg-[#eff6ff] hover:border-[var(--q-primary)] dark:hover:bg-[rgba(59,130,246,0.1)] dark:hover:border-[var(--q-primary)]"
            :class="{ 'btn-focused': isFocusedYes }"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          >{{ confirmLabel }}</OButton>
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn cancel-btn w-full text-sm font-semibold rounded-md normal-case tracking-normal transition-all duration-200 text-[#374151] dark:text-[#e5e7eb] border-2 border-[#d1d5db] dark:border-[#4b5563] bg-white dark:bg-transparent hover:bg-[#fef2f2] hover:border-[#fca5a5] dark:hover:bg-[rgba(239,68,68,0.1)] dark:hover:border-[#f87171]"
            :class="{ 'btn-focused': isFocusedNo }"
            tabindex="1"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
          >{{ cancelLabel }}</OButton>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import OButton from '@/lib/core/Button/OButton.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface ConfirmationData {
  tool?: string;
  args?: Record<string, any>;
  message?: string;
}

interface Props {
  visible: boolean;
  confirmation: ConfirmationData | null;
  confirmLabel?: string;
  cancelLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: 'Yes',
  cancelLabel: 'No',
  confirmation: null,
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  alwaysConfirm: [];
}>();

const store = useStore();
const theme = computed(() => store.state.theme);

// Check if this is a navigation action
const isNavigationAction = computed(() => props.confirmation?.tool === 'navigation_action');

// Format message based on confirmation data
const formattedMessage = computed(() => {
  if (!props.confirmation) return '';

  // Handle navigation_action
  if (isNavigationAction.value) {
    // Use the label/message from the navigation action
    const message = props.confirmation.message;
    if (message) {
      return `Allow O2 Assistant to ${message}?`;
    }

    // Fallback: format based on target
    const target = props.confirmation.args;
    if (target?.name) {
      return `Allow O2 Assistant to navigate to ${target.name}?`;
    }

    return 'Allow O2 Assistant to navigate?';
  }

  // Handle Delete* operations generically (DeleteAlert, DeleteDashboard, DeletePipeline, etc.)
  if (props.confirmation.tool && props.confirmation.tool.startsWith('Delete')) {
    // Extract entity type (e.g., "Alert" from "DeleteAlert")
    const entityType = props.confirmation.tool.replace('Delete', '');
    const entityTypeLower = entityType.toLowerCase();
    const args = props.confirmation.args || {};

    // Try to find a name or title for the entity
    const name = args.name || args.title || args.alert_id || args.dashboard_id || args.pipeline_id || args.id;

    if (name) {
      return `Do you really want to delete the "${name}" ${entityTypeLower}?`;
    }

    // Fallback if no identifier found
    return `Do you really want to delete this ${entityTypeLower}?`;
  }

  // Fallback to message property
  return props.confirmation.message || '';
});

const yesButtonRef = ref<any>(null);
const noButtonRef = ref<any>(null);
const alwaysButtonRef = ref<any>(null);
const isFocusedYes = ref(false);
const isFocusedNo = ref(false);
const isFocusedAlways = ref(false);

// Auto-focus button when dialog appears
// For delete operations, focus "No" button by default to prevent accidental deletions
// For other operations, focus "Yes" button
watch(
  () => props.visible,
  (newValue) => {
    if (newValue) {
      nextTick(() => {
        setTimeout(() => {
          // Check if this is a delete operation
          const isDeleteOperation = props.confirmation?.tool?.startsWith('Delete');

          if (isDeleteOperation) {
            // Focus "No" button for delete operations
            const button = noButtonRef.value?.$el;
            if (button) {
              button.focus();
              isFocusedNo.value = true;
            }
          } else {
            // Focus "Yes" button for other operations
            const button = yesButtonRef.value?.$el;
            if (button) {
              button.focus();
              isFocusedYes.value = true;
            }
          }
        }, 100);
      });
    }
  }
);

const handleConfirm = () => {
  emit('confirm');
};

const handleCancel = () => {
  emit('cancel');
};

const handleAlwaysConfirm = () => {
  emit('alwaysConfirm');
};

const focusYes = () => {
  const button = yesButtonRef.value?.$el;
  if (button) {
    button.focus();
  }
};

const focusNo = () => {
  const button = noButtonRef.value?.$el;
  if (button) {
    button.focus();
  }
};

const focusAlways = () => {
  const button = alwaysButtonRef.value?.$el;
  if (button) {
    button.focus();
  }
};

const handleYesFocus = () => {
  isFocusedYes.value = true;
  isFocusedNo.value = false;
  isFocusedAlways.value = false;
};

const handleYesBlur = () => {
  isFocusedYes.value = false;
};

const handleNoFocus = () => {
  isFocusedNo.value = true;
  isFocusedYes.value = false;
  isFocusedAlways.value = false;
};

const handleNoBlur = () => {
  isFocusedNo.value = false;
};

const handleAlwaysFocus = () => {
  isFocusedAlways.value = true;
  isFocusedYes.value = false;
  isFocusedNo.value = false;
};

const handleAlwaysBlur = () => {
  isFocusedAlways.value = false;
};

const handleDialogClick = (event: MouseEvent) => {
  // If click is not on a button, refocus the last focused button
  const target = event.target as HTMLElement;
  if (!target.closest('.confirmation-btn')) {
    nextTick(() => {
      if (isFocusedNo.value) {
        focusNo();
      } else if (isFocusedAlways.value) {
        focusAlways();
      } else {
        focusYes();
      }
    });
  }
};

const handleDialogKeydown = (event: KeyboardEvent) => {

  if (event.key === 'Enter') {
    event.preventDefault();
    if (isFocusedYes.value) {
      handleConfirm();
    } else if (isFocusedAlways.value) {
      handleAlwaysConfirm();
    } else if (isFocusedNo.value) {
      handleCancel();
    }
  } else if (event.key === 'ArrowDown' || event.key === 'Down') {
    event.preventDefault();
    if (isNavigationAction.value) {
      // For navigation: Allow -> Always Allow -> No -> Allow
      if (isFocusedYes.value) {
        focusAlways();
      } else if (isFocusedAlways.value) {
        focusNo();
      } else {
        focusYes();
      }
    } else {
      // For other actions: Yes -> No -> Yes
      focusNo();
    }
  } else if (event.key === 'ArrowUp' || event.key === 'Up') {
    event.preventDefault();
    if (isNavigationAction.value) {
      // For navigation: No -> Always Allow -> Allow -> No
      if (isFocusedNo.value) {
        focusAlways();
      } else if (isFocusedAlways.value) {
        focusYes();
      } else {
        focusNo();
      }
    } else {
      // For other actions: No -> Yes -> No
      focusYes();
    }
  }
};

// Named handler references so they can be removed in onUnmounted
let yesBtnHandler: ((e: KeyboardEvent) => void) | null = null;
let alwaysBtnHandler: ((e: KeyboardEvent) => void) | null = null;
let noBtnHandler: ((e: KeyboardEvent) => void) | null = null;
let yesBtnEl: HTMLElement | null = null;
let alwaysBtnEl: HTMLElement | null = null;
let noBtnEl: HTMLElement | null = null;

// Add native keyboard listeners to buttons
onMounted(() => {
  nextTick(() => {
    yesBtnEl = yesButtonRef.value?.$el;
    noBtnEl = noButtonRef.value?.$el;
    alwaysBtnEl = alwaysButtonRef.value?.$el;

    if (yesBtnEl) {
      yesBtnHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleConfirm();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (isNavigationAction.value) {
            focusAlways();
          } else {
            focusNo();
          }
        }
      };
      yesBtnEl.addEventListener('keydown', yesBtnHandler);
    }

    if (alwaysBtnEl) {
      alwaysBtnHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAlwaysConfirm();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusNo();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusYes();
        }
      };
      alwaysBtnEl.addEventListener('keydown', alwaysBtnHandler);
    }

    if (noBtnEl) {
      noBtnHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCancel();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (isNavigationAction.value) {
            focusAlways();
          } else {
            focusYes();
          }
        }
      };
      noBtnEl.addEventListener('keydown', noBtnHandler);
    }
  });
});

onUnmounted(() => {
  if (yesBtnEl && yesBtnHandler) {
    yesBtnEl.removeEventListener('keydown', yesBtnHandler);
  }
  if (alwaysBtnEl && alwaysBtnHandler) {
    alwaysBtnEl.removeEventListener('keydown', alwaysBtnHandler);
  }
  if (noBtnEl && noBtnHandler) {
    noBtnEl.removeEventListener('keydown', noBtnHandler);
  }
});
</script>

<style>
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.confirmation-btn.confirm-btn.btn-focused {
  color: #ffffff !important;
  background-color: var(--q-primary) !important;
  border-color: var(--q-primary) !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.4) !important;
}

.dark .confirmation-btn.confirm-btn.btn-focused {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4) !important;
}

.confirmation-btn.always-btn.btn-focused {
  color: #ffffff !important;
  background-color: #059669 !important;
  border-color: #059669 !important;
  box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.4) !important;
}

.confirmation-btn.cancel-btn.btn-focused {
  color: #ffffff !important;
  background-color: #ef4444 !important;
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.4) !important;
}

.dark .confirmation-btn.cancel-btn.btn-focused {
  background-color: #dc2626 !important;
  border-color: #dc2626 !important;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.4) !important;
}
</style>
