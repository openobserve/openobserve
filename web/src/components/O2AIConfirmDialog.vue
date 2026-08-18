<template>
  <div v-if="visible" class="confirmation-overlay mb-2 w-full">
    <div
      class="confirmation-dialog rounded-default bg-surface-base border-border-default flex w-full flex-col gap-3.5 border-2 px-4 pt-4 pb-3.5 shadow-sm dark:shadow-sm"
      @keydown="handleDialogKeydown"
      @click="handleDialogClick"
    >
      <div class="confirmation-header flex items-start gap-3">
        <OIcon
          name="help-outline"
          size="md"
          class="confirmation-icon text-icon-color mt-0.5 shrink-0"
        />
        <span
          class="confirmation-title text-text-heading flex-1 text-sm leading-normal font-medium"
          >{{ formattedMessage }}</span
        >
      </div>

      <div
        class="confirmation-buttons border-border-default mt-1 flex w-full flex-col gap-2.5 border-t pt-3.5"
      >
        <!-- For navigation actions, show 3 buttons -->
        <template v-if="isNavigationAction">
          <OButton
            ref="yesButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn rounded-default text-theme-accent border-border-default bg-surface-base hover:bg-button-ghost-primary-hover-bg hover:border-theme-accent w-full border-2 text-sm font-semibold tracking-normal normal-case transition-all duration-200"
            :class="
              isFocusedYes
                ? 'bg-theme-accent! border-theme-accent! ring-theme-accent/40 text-white! ring-3'
                : ''
            "
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
            >{{ t("aiAssistant.confirmDialog.allow") }}</OButton
          >
          <OButton
            ref="alwaysButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn rounded-default text-status-positive border-border-default bg-surface-base hover:bg-button-ghost-success-hover-bg hover:border-status-positive w-full border-2 text-sm font-semibold tracking-normal normal-case transition-all duration-200"
            :class="
              isFocusedAlways
                ? 'bg-status-positive! border-status-positive! ring-status-positive/40 text-white! ring-3'
                : ''
            "
            tabindex="1"
            @click="handleAlwaysConfirm"
            @focus="handleAlwaysFocus"
            @blur="handleAlwaysBlur"
            >{{ t("aiAssistant.confirmDialog.alwaysAllow") }}</OButton
          >
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn rounded-default text-text-body border-border-default bg-surface-base hover:bg-button-ghost-destructive-hover-bg hover:border-status-negative w-full border-2 text-sm font-semibold tracking-normal normal-case transition-all duration-200"
            :class="
              isFocusedNo
                ? 'bg-status-negative! border-status-negative! ring-status-negative/40 text-white! ring-3'
                : ''
            "
            tabindex="2"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
            >{{ t("aiAssistant.confirmDialog.no") }}</OButton
          >
        </template>

        <!-- For other actions, show 2 buttons -->
        <template v-else>
          <OButton
            ref="yesButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn rounded-default text-theme-accent border-border-default bg-surface-base hover:bg-button-ghost-primary-hover-bg hover:border-theme-accent w-full border-2 text-sm font-semibold tracking-normal normal-case transition-all duration-200"
            :class="
              isFocusedYes
                ? 'bg-theme-accent! border-theme-accent! ring-theme-accent/40 text-white! ring-3'
                : ''
            "
            tabindex="0"
            @click="handleConfirm"
            @focus="handleYesFocus"
            @blur="handleYesBlur"
            >{{ resolvedConfirmLabel }}</OButton
          >
          <OButton
            ref="noButtonRef"
            variant="outline"
            :block="true"
            class="confirmation-btn rounded-default text-text-body border-border-default bg-surface-base hover:bg-button-ghost-destructive-hover-bg hover:border-status-negative w-full border-2 text-sm font-semibold tracking-normal normal-case transition-all duration-200"
            :class="
              isFocusedNo
                ? 'bg-status-negative! border-status-negative! ring-status-negative/40 text-white! ring-3'
                : ''
            "
            tabindex="1"
            @click="handleCancel"
            @focus="handleNoFocus"
            @blur="handleNoBlur"
            >{{ resolvedCancelLabel }}</OButton
          >
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface ConfirmationData {
  tool?: string;
  args?: Record<string, any>;
  message?: I18nText;
}

interface Props {
  visible: boolean;
  confirmation: ConfirmationData | null;
  confirmLabel?: I18nText;
  cancelLabel?: I18nText;
}

const { t } = useI18nTyped();

/** Keep in sync with `aiAssistant.aiChat.entity.*`; anything absent renders raw English. */
const DELETABLE_ENTITIES = new Set([
  "alert",
  "dashboard",
  "pipeline",
  "report",
  "function",
  "stream",
  "folder",
  "panel",
  "user",
  "action",
]);

const props = withDefaults(defineProps<Props>(), {
  confirmation: null,
});

// Render-time defaults — a withDefaults literal would freeze the English text.
const resolvedConfirmLabel = computed(() => props.confirmLabel ?? t("common.yes"));
const resolvedCancelLabel = computed(() => props.cancelLabel ?? t("common.no"));

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  alwaysConfirm: [];
}>();

// Check if this is a navigation action
const isNavigationAction = computed(() => props.confirmation?.tool === "navigation_action");

// Format message based on confirmation data
const formattedMessage = computed(() => {
  if (!props.confirmation) return "";

  // Handle navigation_action
  if (isNavigationAction.value) {
    // Use the label/message from the navigation action
    const message = props.confirmation.message;
    if (message) {
      return t("aiAssistant.aiChat.allowAssistantTo", { action: message });
    }

    // Fallback: format based on target
    const target = props.confirmation.args;
    if (target?.name) {
      return t("aiAssistant.aiChat.allowAssistantNavigateTo", { name: target.name });
    }

    return t("aiAssistant.aiChat.navigateConfirmQuestion");
  }

  // Handle Delete* operations generically (DeleteAlert, DeleteDashboard, DeletePipeline, etc.)
  if (props.confirmation.tool && props.confirmation.tool.startsWith("Delete")) {
    // Extract entity type (e.g., "Alert" from "DeleteAlert")
    const entityType = props.confirmation.tool.replace("Delete", "");
    // The noun is server-supplied English, so it needs translating before it goes into
    // a translated sentence. Gated on a list, not te(): te() ignores the fallback locale,
    // so it returns false for every non-English user until the entity keys are translated.
    const lowerEntity = entityType.toLowerCase();
    const entityTypeLower = DELETABLE_ENTITIES.has(lowerEntity)
      ? t(`aiAssistant.aiChat.entity.${lowerEntity}`)
      : lowerEntity;
    const args = props.confirmation.args || {};

    // Try to find a name or title for the entity
    const name =
      args.name || args.title || args.alert_id || args.dashboard_id || args.pipeline_id || args.id;

    if (name) {
      return t("aiAssistant.aiChat.confirmDeleteNamedEntity", {
        name,
        entity: entityTypeLower,
      });
    }

    // Fallback if no identifier found
    return t("aiAssistant.aiChat.confirmDeleteEntity", { entity: entityTypeLower });
  }

  // Fallback to message property
  return props.confirmation.message || "";
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
          const isDeleteOperation = props.confirmation?.tool?.startsWith("Delete");

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
  },
);

const handleConfirm = () => {
  emit("confirm");
};

const handleCancel = () => {
  emit("cancel");
};

const handleAlwaysConfirm = () => {
  emit("alwaysConfirm");
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
  if (!target.closest(".confirmation-btn")) {
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
  if (event.key === "Enter") {
    event.preventDefault();
    if (isFocusedYes.value) {
      handleConfirm();
    } else if (isFocusedAlways.value) {
      handleAlwaysConfirm();
    } else if (isFocusedNo.value) {
      handleCancel();
    }
  } else if (event.key === "ArrowDown" || event.key === "Down") {
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
  } else if (event.key === "ArrowUp" || event.key === "Up") {
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
        if (e.key === "Enter") {
          e.preventDefault();
          handleConfirm();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (isNavigationAction.value) {
            focusAlways();
          } else {
            focusNo();
          }
        }
      };
      yesBtnEl.addEventListener("keydown", yesBtnHandler);
    }

    if (alwaysBtnEl) {
      alwaysBtnHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAlwaysConfirm();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          focusNo();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusYes();
        }
      };
      alwaysBtnEl.addEventListener("keydown", alwaysBtnHandler);
    }

    if (noBtnEl) {
      noBtnHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleCancel();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (isNavigationAction.value) {
            focusAlways();
          } else {
            focusYes();
          }
        }
      };
      noBtnEl.addEventListener("keydown", noBtnHandler);
    }
  });
});

onUnmounted(() => {
  if (yesBtnEl && yesBtnHandler) {
    yesBtnEl.removeEventListener("keydown", yesBtnHandler);
  }
  if (alwaysBtnEl && alwaysBtnHandler) {
    alwaysBtnEl.removeEventListener("keydown", alwaysBtnHandler);
  }
  if (noBtnEl && noBtnHandler) {
    noBtnEl.removeEventListener("keydown", noBtnHandler);
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
