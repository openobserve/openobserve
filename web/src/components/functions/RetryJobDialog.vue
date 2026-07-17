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
        class="retry-dialog-backdrop fixed top-0 left-0 w-full h-full bg-dialog-overlay flex justify-center items-center z-[9999]"
        @click="handleBackdropClick"
      >
        <div
          class="retry-dialog bg-dialog-bg text-text-body rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.15)] w-[90%] max-w-150 max-h-[90vh] flex flex-col overflow-hidden"
          ref="dialogRef"
          @click.stop
          role="dialog"
          aria-modal="true"
        >
          <!-- Header -->
          <div
            class="retry-dialog-header flex justify-between items-center py-5 px-6 border-b border-border-default"
          >
            <h3
              class="retry-dialog-title text-lg font-semibold m-0 text-text-body"
            >Retry Enrichment Table Job</h3>
            <OButton
              variant="ghost"
              size="icon"
              icon-left="close"
              @click="handleCancel"
              aria-label="Close"
            />
          </div>

          <!-- Content -->
          <div
            class="retry-dialog-content p-6 overflow-y-auto flex-1"
          >
            <div
              class="table-info mb-5 p-4 bg-surface-subtle rounded-md"
            >
              <div
                class="info-row flex mb-2 last:mb-0"
              >
                <span class="font-semibold min-w-15 text-text-secondary"
                >Table:</span>
                <span class="text-text-body break-words"
                >{{ tableName }}</span>
              </div>
              <div
                class="info-row flex mb-2 last:mb-0"
              >
                <span class="font-semibold min-w-15 text-text-secondary"
                >URL:</span>
                <span class="text-text-body break-words font-mono text-compact"
                >{{ url }}</span>
              </div>
            </div>

            <!-- Range Support Warning -->
            <div
              v-if="!supportsRange"
              class="warning-banner flex gap-3 p-4 bg-banner-warning-bg border border-banner-warning-border rounded-md mb-5"
            >
              <OIcon name="warning" size="sm" class="text-banner-warning-text shrink-0" />
              <div
                class="warning-text flex-1"
              >
                <strong class="block mb-1 text-banner-warning-text">Range requests not supported</strong>
                <p class="m-0 text-sm text-banner-warning-text">
                  This URL does not support resuming from the last position.
                  The job will restart from the beginning.
                </p>
              </div>
            </div>

            <!-- Retry Options (only shown if range is supported) -->
            <div
              v-if="supportsRange"
              class="mt-5"
            >
              <p
                class="options-title font-semibold mb-4 text-text-body"
              >How would you like to retry?</p>

              <div
                class="option-card border-2 border-border-default rounded-lg mb-3 transition-all duration-200 cursor-pointer hover:border-accent hover:bg-interactive-hover-bg"
                :class="[
                  { selected: !resumeFromLast },
                  !resumeFromLast ? 'border-accent! bg-surface-accent!' : ''
                ]"
              >
                <label
                  class="block p-4 cursor-pointer w-full"
                >
                  <input
                    type="radio"
                    name="retryOption"
                    :value="false"
                    v-model="resumeFromLast"
                   class="absolute opacity-0 cursor-pointer"
                  />
                  <div
                    class="flex flex-col gap-2"
                  >
                    <div
                      class="option-header flex items-center gap-2.5 font-semibold text-text-body"
                    >
                      <OIcon name="refresh" size="sm" class="text-accent" />
                      <span class="flex-1">Start from Beginning</span>
                    </div>
                    <p
                      class="m-0 text-sm text-text-secondary leading-normal"
                    >
                      Download the entire file from scratch. All previous progress will be discarded.
                    </p>
                  </div>
                </label>
              </div>

              <div
                class="option-card border-2 border-border-default rounded-lg mb-3 transition-all duration-200 cursor-pointer hover:border-accent hover:bg-interactive-hover-bg"
                :class="[
                  { selected: resumeFromLast },
                  resumeFromLast ? 'border-accent! bg-surface-accent!' : ''
                ]"
              >
                <label
                  class="block p-4 cursor-pointer w-full"
                >
                  <input
                    type="radio"
                    name="retryOption"
                    :value="true"
                    v-model="resumeFromLast"
                    class="absolute opacity-0 cursor-pointer"
                  />
                  <div
                    class="flex flex-col gap-2"
                  >
                    <div
                      class="option-header flex items-center gap-2.5 font-semibold text-text-body"
                    >
                      <OIcon name="play-arrow" size="sm" class="text-accent" />
                      <span class="flex-1">Resume from Last Position</span>
                      <span
                        class="bg-badge-success-solid-bg text-badge-success-solid-text py-0.5 px-2 rounded-full text-2xs font-semibold uppercase"
                      >Recommended</span>
                    </div>
                    <p
                      class="m-0 text-sm text-text-secondary leading-normal"
                    >
                      Continue downloading from where it stopped.
                      <span v-if="lastBytePosition > 0">
                        Already processed: {{ formatBytes(lastBytePosition) }}
                      </span>
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div
            class="retry-dialog-footer py-4 px-6 border-t border-border-default flex justify-end gap-3"
          >
            <OButton
              variant="outline"
              size="sm-action"
              @click="handleCancel"
              class="min-w-25"
            >
              Cancel
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              @click="handleConfirm"
              class="min-w-25"
            >
              Retry
            </OButton>
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
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "RetryJobDialog",
  components: { OButton, OIcon },
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    tableName: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    supportsRange: {
      type: Boolean,
      default: false,
    },
    lastBytePosition: {
      type: Number,
      default: 0,
    },
  },
  emits: ["update:modelValue", "confirm", "cancel"],
  setup(props, { emit }) {
    const store = useStore();
    const dialogRef = ref<HTMLElement | null>(null);
    const resumeFromLast = ref(props.supportsRange); // Default to resume if supported

    // Format bytes to human-readable format
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
    };

    // Handler for ESC key
    const handleEscKey = (event: KeyboardEvent) => {
      if (props.modelValue && event.key === "Escape") {
        handleCancel();
      }
    };

    // Close dialog handler
    const handleCancel = () => {
      emit("update:modelValue", false);
      emit("cancel");
    };

    // Handle backdrop click
    const handleBackdropClick = () => {
      handleCancel();
    };

    // Handle confirm
    const handleConfirm = () => {
      emit("update:modelValue", false);
      emit("confirm", resumeFromLast.value);
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
          // Reset to default when opening
          resumeFromLast.value = props.supportsRange;
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
      store,
      dialogRef,
      resumeFromLast,
      formatBytes,
      handleCancel,
      handleBackdropClick,
      handleConfirm,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): the <Transition name="fade"> enter/leave pair and the
   slide-up / slide-down dialog animations it drives. `slide-up` / `slide-down`
   are referenced ONLY from the CSS in this block (never from a template
   `[animation:…]` utility), so `scoped` is safe and correct here: Vue renames
   the @keyframes and the `animation:` shorthands together, which also hashes
   these otherwise-generic names out of the global namespace. That is why they
   do NOT belong in styles/keyframes.css. Every selector below is this
   component's own element. */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-active .retry-dialog {
  animation: slide-up 0.3s ease;
}

.fade-leave-active .retry-dialog {
  animation: slide-down 0.2s ease;
}

@keyframes slide-up {
  from {
    transform: translateY(1.875rem);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes slide-down {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(1.875rem);
    opacity: 0;
  }
}
</style>
