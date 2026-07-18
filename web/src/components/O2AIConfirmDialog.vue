<template>
  <div v-if="visible" class="confirmation-overlay w-full mb-2">
    <div
      class="confirmation-dialog w-full pt-4 px-4 pb-3.5 rounded-default flex flex-col gap-3.5 bg-surface-base border-2 border-border-default shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
      @keydown="handleDialogKeydown"
      @click="handleDialogClick"
    >
      <div class="confirmation-header flex items-start gap-3">
        <OIcon name="help-outline" size="md" class="confirmation-icon shrink-0 mt-0.5 text-icon-color" />
        <span class="confirmation-title flex-1 text-sm font-medium leading-normal text-text-heading">{{ formattedMessage }}</span>
      </div>

      <div class="confirmation-buttons flex flex-col gap-2.5 w-full pt-3.5 mt-1 border-t border-border-default">
        <!-- For navigation actions, show 3 buttons -->
        <template v-if="isNavigationAction">
          <OButton
            ref="yesButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn w-full text-sm font-semibold rounded-default normal-case tracking-normal transition-all duration-200 text-theme-accent border-2 border-border-default bg-surface-base hover:bg-button-ghost-primary-hover-bg hover:border-theme-accent"
            :class="isFocusedYes ? 'text-white! bg-theme-accent! border-theme-accent! ring-3 ring-theme-accent/40' : ''"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          >Allow</OButton>
          <OButton
            ref="alwaysButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn w-full text-sm font-semibold rounded-default normal-case tracking-normal transition-all duration-200 text-status-positive border-2 border-border-default bg-surface-base hover:bg-button-ghost-success-hover-bg hover:border-status-positive"
            :class="isFocusedAlways ? 'text-white! bg-status-positive! border-status-positive! ring-3 ring-status-positive/40' : ''"
            tabindex="1"
            @click="handleAlwaysConfirm"
            @focus="handleAlwaysFocus"
            @blur="handleAlwaysBlur"
          >Always Allow</OButton>
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn w-full text-sm font-semibold rounded-default normal-case tracking-normal transition-all duration-200 text-text-body border-2 border-border-default bg-surface-base hover:bg-button-ghost-destructive-hover-bg hover:border-status-negative"
            :class="isFocusedNo ? 'text-white! bg-status-negative! border-status-negative! ring-3 ring-status-negative/40' : ''"
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
            class="confirmation-btn w-full text-sm font-semibold rounded-default normal-case tracking-normal transition-all duration-200 text-theme-accent border-2 border-border-default bg-surface-base hover:bg-button-ghost-primary-hover-bg hover:border-theme-accent"
            :class="isFocusedYes ? 'text-white! bg-theme-accent! border-theme-accent! ring-3 ring-theme-accent/40' : ''"
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
          >{{ confirmLabel }}</OButton>
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn w-full text-sm font-semibold rounded-default normal-case tracking-normal transition-all duration-200 text-text-body border-2 border-border-default bg-surface-base hover:bg-button-ghost-destructive-hover-bg hover:border-status-negative"
            :class="isFocusedNo ? 'text-white! bg-status-negative! border-status-negative! ring-3 ring-status-negative/40' : ''"
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

<style scoped>
/* keep(keyframes): the inline confirmation entrance is used only by this dialog.
   The `animation` is declared here, not as a template `[animation:…]` utility, so
   Vue's scoped compiler renames the keyframe and this reference together. */
.confirmation-overlay {
  animation: slide-up 0.25s ease-out;
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

