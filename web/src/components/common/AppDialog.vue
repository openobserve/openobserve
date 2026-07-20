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
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="modelValue"
        data-test="common-app-dialog-backdrop"
        class="fixed inset-0 bg-black/50 flex justify-center items-center z-9999"
        @click="handleBackdropClick"
      >
        <div
          data-test="common-app-dialog"
          class="bg-white rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.15)] w-[90%] max-w-150 max-h-[90vh] flex flex-col overflow-hidden"
          ref="dialogRef"
          @click.stop
          role="dialog"
          aria-modal="true"
        >
          <div data-test="common-app-dialog-content" class="overflow-y-auto flex-1">
            <slot></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";

export default defineComponent({
  name: "AppDialog",
  props: {
    // Using modelValue for v-model compatibility
    modelValue: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: "",
    },
    closeOnBackdropClick: {
      type: Boolean,
      default: true,
    },
    closeOnEsc: {
      type: Boolean,
      default: true,
    },
  },
  emits: ["update:modelValue", "close"],
  setup(props, { emit }) {
    const dialogRef = ref<HTMLElement | null>(null);

    // Handler for ESC key
    const handleEscKey = (event: KeyboardEvent) => {
      if (props.closeOnEsc && props.modelValue && event.key === "Escape") {
        handleClose();
      }
    };

    // Close dialog handler
    const handleClose = () => {
      emit("update:modelValue", false);
      emit("close");
    };

    // Handle backdrop click
    const handleBackdropClick = () => {
      if (props.closeOnBackdropClick) {
        handleClose();
      }
    };

    // Trap focus inside dialog
    const trapFocus = (event: KeyboardEvent) => {
      if (!props.modelValue || !dialogRef.value || event.key !== "Tab") return;

      const focusableElements = dialogRef.value.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[
        focusableElements.length - 1
      ] as HTMLElement;

      // If shift+tab on first element, move to last element
      if (event.shiftKey && document.activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      }
      // If tab on last element, move to first element
      else if (!event.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    };

    // Prevent scrolling of the background when dialog is open
    watch(
      () => props.modelValue,
      (isOpen) => {
        if (isOpen) {
          document.body.style.overflow = "hidden";
          // Focus the dialog after it's shown
          nextTick(() => {
            const focusable = dialogRef.value?.querySelector(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ) as HTMLElement;
            focusable?.focus();
          });
        } else {
          // Remove overflow from body when dialog is closed
          document.body.style.overflow = "";
        }
      },
    );

    onMounted(() => {
      // Add event listeners
      document.addEventListener("keydown", handleEscKey);
      document.addEventListener("keydown", trapFocus);
    });

    onBeforeUnmount(() => {
      // Clean up event listeners to prevent memory leaks
      document.removeEventListener("keydown", handleEscKey);
      document.removeEventListener("keydown", trapFocus);

      // Reset body overflow if component is destroyed while dialog is open
      if (props.modelValue) {
        document.body.style.overflow = "";
      }
    });

    return {
      dialogRef,
      handleClose,
      handleBackdropClick,
    };
  },
});
</script>

<style>
/* Transition effects */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
