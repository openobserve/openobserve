<template>
  <div v-if="visible" class="confirmation-overlay">
    <div
      class="confirmation-dialog"
      :class="theme === 'dark' ? 'dark-mode' : 'light-mode'"
      @keydown="handleDialogKeydown"
      @click="handleDialogClick"
    >
      <div class="confirmation-header">
        <q-icon name="help_outline" size="20px" class="confirmation-icon" />
        <span class="confirmation-title">{{ formattedMessage }}</span>
      </div>

      <div class="confirmation-buttons">
        <!-- For navigation actions, show 3 buttons -->
        <template v-if="isNavigationAction">
          <q-btn
            ref="yesButtonRef"
            unelevated
            no-caps
            label="Allow"
            class="confirmation-btn confirm-btn"
            :class="{ 'btn-focused': isFocusedYes }"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          />
          <q-btn
            ref="alwaysButtonRef"
            unelevated
            no-caps
            label="Always Allow"
            class="confirmation-btn always-btn"
            :class="{ 'btn-focused': isFocusedAlways }"
            tabindex="1"
            @click="handleAlwaysConfirm"
            @focus="handleAlwaysFocus"
            @blur="handleAlwaysBlur"
          />
          <q-btn
            ref="noButtonRef"
            unelevated
            no-caps
            outline
            label="No"
            class="confirmation-btn cancel-btn"
            :class="{ 'btn-focused': isFocusedNo }"
            tabindex="2"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
          />
        </template>

        <!-- For other actions, show 2 buttons -->
        <template v-else>
          <q-btn
            ref="yesButtonRef"
            unelevated
            no-caps
            :label="confirmLabel"
            class="confirmation-btn confirm-btn"
            :class="{ 'btn-focused': isFocusedYes }"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          />
          <q-btn
            ref="noButtonRef"
            unelevated
            no-caps
            outline
            :label="cancelLabel"
            class="confirmation-btn cancel-btn"
            :class="{ 'btn-focused': isFocusedNo }"
            tabindex="1"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';

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

// Auto-focus Yes button when dialog appears
watch(
  () => props.visible,
  (newValue) => {
    if (newValue) {
      nextTick(() => {
        setTimeout(() => {
          const button = yesButtonRef.value?.$el;
          if (button) {
            button.focus();
            isFocusedYes.value = true;
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
  console.log('Key pressed:', event.key);

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

// Add native keyboard listeners to buttons
onMounted(() => {
  nextTick(() => {
    const yesBtn = yesButtonRef.value?.$el;
    const noBtn = noButtonRef.value?.$el;
    const alwaysBtn = alwaysButtonRef.value?.$el;

    if (yesBtn) {
      yesBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        console.log('Yes button key:', e.key);
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
      });
    }

    if (alwaysBtn) {
      alwaysBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        console.log('Always button key:', e.key);
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
      });
    }

    if (noBtn) {
      noBtn.addEventListener('keydown', (e: KeyboardEvent) => {
        console.log('No button key:', e.key);
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
      });
    }
  });
});
</script>

<style scoped lang="scss">
.confirmation-overlay {
  width: 100%;
  margin-bottom: 8px;
  animation: slideUp 0.25s ease-out;
}

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

.confirmation-dialog {
  width: 100%;
  padding: 16px 16px 14px 16px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);

  &.light-mode {
    background: #ffffff;
    border: 2px solid #e4e7ec;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  &.dark-mode {
    background: #1e1e1e;
    border: 2px solid #323232;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
}

.confirmation-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;

  .confirmation-icon {
    flex-shrink: 0;
    margin-top: 2px;

    .light-mode & {
      color: #6b7280;
    }
    .dark-mode & {
      color: #9ca3af;
    }
  }

  .confirmation-title {
    flex: 1;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.5;

    .light-mode & {
      color: #1f2937;
    }
    .dark-mode & {
      color: #f3f4f6;
    }
  }
}

.confirmation-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding-top: 14px;
  margin-top: 4px;

  .light-mode & {
    border-top: 1px solid #e5e7eb;
  }
  .dark-mode & {
    border-top: 1px solid #374151;
  }

  .confirmation-btn {
    width: 100%;
    font-size: 14px;
    font-weight: 600;
    // padding: 11px 20px;
    border-radius: 6px;
    text-transform: none;
    letter-spacing: 0;
    transition: all 0.2s ease;

    &.confirm-btn {
      .light-mode & {
        color: var(--q-primary);
        border: 2px solid #d1d5db;
        background: #ffffff;

        &:hover {
          background: #eff6ff;
          border-color: var(--q-primary);
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: var(--q-primary) !important;
          border-color: var(--q-primary) !important;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.4) !important;
        }
      }

      .dark-mode & {
        color: var(--q-primary);
         border: 2px solid #4b5563;
        background: transparent;

        &:hover {
          background: rgba(59, 130, 246, 0.1);
          border-color: var(--q-primary);
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: var(--q-primary) !important;
          border-color: var(--q-primary) !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4) !important;
        }
      }
    }

    &.always-btn {
      .light-mode & {
        color: #059669;
        border: 2px solid #d1d5db;
        background: #ffffff;

        &:hover {
          background: #f0fdf4;
          border-color: #34d399;
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: #059669 !important;
          border-color: #059669 !important;
          box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.4) !important;
        }
      }

      .dark-mode & {
        color: #34d399;
        border: 2px solid #4b5563;
        background: transparent;

        &:hover {
          background: rgba(5, 150, 105, 0.1);
          border-color: #34d399;
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: #059669 !important;
          border-color: #059669 !important;
          box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.4) !important;
        }
      }
    }

    &.cancel-btn {
      .light-mode & {
        color: #374151;
        border: 2px solid #d1d5db;
        background: #ffffff;

        &:hover {
          background: #fef2f2;
          border-color: #fca5a5;
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: #ef4444 !important;
          border-color: #ef4444 !important;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.4) !important;
        }
      }

      .dark-mode & {
        color: #e5e7eb;
        border: 2px solid #4b5563;
        background: transparent;

        &:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: #f87171;
        }

        &.btn-focused {
          color: #ffffff !important;
          background-color: #dc2626 !important;
          border-color: #dc2626 !important;
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.4) !important;
        }
      }
    }
  }
}

// Target Quasar's focus helper
.confirmation-btn {
  :deep(.q-focus-helper) {
    display: none !important;
  }
}
</style>
