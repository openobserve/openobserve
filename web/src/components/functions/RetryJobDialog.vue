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
        class="retry-dialog-backdrop"
        tw:fixed tw:top-0 tw:left-0 tw:w-full tw:h-full tw:bg-[rgba(0,0,0,0.5)] tw:flex tw:justify-center tw:items-center tw:z-[9999]
        @click="handleBackdropClick"
      >
        <div
          class="retry-dialog"
          tw:bg-white tw:rounded-lg tw:shadow-[0_4px_20px_rgba(0,0,0,0.15)] tw:w-[90%] tw:max-w-[600px] tw:max-h-[90vh] tw:flex tw:flex-col tw:overflow-hidden
          ref="dialogRef"
          @click.stop
          role="dialog"
          aria-modal="true"
          :class="{ 'dark-theme': store.state.theme === 'dark' }"
        >
          <!-- Header -->
          <div
            class="retry-dialog-header"
            tw:flex tw:justify-between tw:items-center tw:py-5 tw:px-6 tw:border-b tw:border-[#eaeaea]
          >
            <h3
              class="retry-dialog-title"
              tw:text-lg tw:font-semibold tw:m-0 tw:text-[#333]
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
            class="retry-dialog-content"
            tw:p-6 tw:overflow-y-auto tw:flex-1
          >
            <div
              class="table-info"
              tw:mb-5 tw:p-4 tw:bg-[#f8f9fa] tw:rounded-md
            >
              <div
                class="info-row"
                tw:flex tw:mb-2
              >
                <span
                  tw:font-semibold tw:min-w-[60px] tw:text-[#666]
                >Table:</span>
                <span
                  tw:text-[#333] tw:break-words
                >{{ tableName }}</span>
              </div>
              <div
                class="info-row"
                tw:flex tw:mb-2
              >
                <span
                  tw:font-semibold tw:min-w-[60px] tw:text-[#666]
                >URL:</span>
                <span
                  tw:text-[#333] tw:break-words tw:font-mono tw:text-[13px]
                >{{ url }}</span>
              </div>
            </div>

            <!-- Range Support Warning -->
            <div
              v-if="!supportsRange"
              class="warning-banner"
              tw:flex tw:gap-3 tw:p-4 tw:bg-[#fff3cd] tw:border tw:border-[#ffc107] tw:rounded-md tw:mb-5
            >
              <OIcon name="warning" size="sm" tw:text-[#ff9800] tw:shrink-0 />
              <div
                class="warning-text"
                tw:flex-1
              >
                <strong>Range requests not supported</strong>
                <p>
                  This URL does not support resuming from the last position.
                  The job will restart from the beginning.
                </p>
              </div>
            </div>

            <!-- Retry Options (only shown if range is supported) -->
            <div
              v-if="supportsRange"
              tw:mt-5
            >
              <p
                class="options-title"
                tw:font-semibold tw:mb-4 tw:text-[#333]
              >How would you like to retry?</p>

              <div
                class="option-card"
                tw:border-2 tw:border-(--o2-border) tw:rounded-lg tw:mb-3 tw:transition-all tw:duration-200 tw:cursor-pointer tw:hover:border-[#1976d2] tw:hover:bg-[#f5f9ff]
                :class="[
                  { selected: !resumeFromLast },
                  !resumeFromLast ? 'tw:border-[#1976d2]! tw:bg-[#e3f2fd]!' : ''
                ]"
              >
                <label
                  tw:block tw:p-4 tw:cursor-pointer tw:w-full
                >
                  <input
                    type="radio"
                    name="retryOption"
                    :value="false"
                    v-model="resumeFromLast"
                    tw:absolute tw:opacity-0 tw:cursor-pointer
                  />
                  <div
                    tw:flex tw:flex-col tw:gap-2
                  >
                    <div
                      class="option-header"
                      tw:flex tw:items-center tw:gap-[10px] tw:font-semibold tw:text-[#333]
                    >
                      <OIcon name="refresh" size="sm" tw:text-[#1976d2] />
                      <span tw:flex-1>Start from Beginning</span>
                    </div>
                    <p
                      tw:m-0 tw:text-sm tw:text-[#666] tw:leading-normal
                    >
                      Download the entire file from scratch. All previous progress will be discarded.
                    </p>
                  </div>
                </label>
              </div>

              <div
                class="option-card"
                tw:border-2 tw:border-(--o2-border) tw:rounded-lg tw:mb-3 tw:transition-all tw:duration-200 tw:cursor-pointer tw:hover:border-[#1976d2] tw:hover:bg-[#f5f9ff]
                :class="[
                  { selected: resumeFromLast },
                  resumeFromLast ? 'tw:border-[#1976d2]! tw:bg-[#e3f2fd]!' : ''
                ]"
              >
                <label
                  tw:block tw:p-4 tw:cursor-pointer tw:w-full
                >
                  <input
                    type="radio"
                    name="retryOption"
                    :value="true"
                    v-model="resumeFromLast"
                    tw:absolute tw:opacity-0 tw:cursor-pointer
                  />
                  <div
                    tw:flex tw:flex-col tw:gap-2
                  >
                    <div
                      class="option-header"
                      tw:flex tw:items-center tw:gap-[10px] tw:font-semibold tw:text-[#333]
                    >
                      <OIcon name="play-arrow" size="sm" tw:text-[#1976d2] />
                      <span tw:flex-1>Resume from Last Position</span>
                      <span
                        tw:bg-[#4caf50] tw:text-white tw:py-[2px] tw:px-2 tw:rounded-full tw:text-[11px] tw:font-semibold tw:uppercase
                      >Recommended</span>
                    </div>
                    <p
                      tw:m-0 tw:text-sm tw:text-[#666] tw:leading-normal
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
            class="retry-dialog-footer"
            tw:py-4 tw:px-6 tw:border-t tw:border-[#eaeaea] tw:flex tw:justify-end tw:gap-3
          >
            <OButton
              variant="outline"
              size="sm-action"
              @click="handleCancel"
              tw:min-w-[100px]
            >
              Cancel
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              @click="handleConfirm"
              tw:min-w-[100px]
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

<style>
/* Dark theme overrides — descendant selectors cannot be inlined */
.dark-theme .retry-dialog-header {
  border-bottom-color: #3a3a3a;
}

.dark-theme .retry-dialog-title {
  color: var(--o2-border);
}

.dark-theme .table-info {
  background-color: #2a2a2a;
}

.dark-theme .info-label {
  color: #999;
}

.dark-theme .info-value {
  color: var(--o2-border);
}

.dark-theme .warning-banner {
  background-color: #3d3516;
  border-color: #a67c00;
}

.dark-theme .warning-text strong {
  color: #ffb84d;
}

.dark-theme .warning-text p {
  color: #d4a86a;
}

.dark-theme .options-title {
  color: var(--o2-border);
}

.dark-theme .option-card {
  border-color: #3a3a3a;
}

.dark-theme .option-card:hover {
  border-color: #1976d2;
  background-color: #1a2332;
}

.dark-theme .option-card.selected {
  background-color: #1a2332;
}

.dark-theme .option-header {
  color: var(--o2-border);
}

.dark-theme .option-description {
  color: #999;
}

.dark-theme .retry-dialog-footer {
  border-top-color: #3a3a3a;
}

/* info-row last-child reset — :last-child pseudo-class cannot be inlined */
.info-row:last-child {
  margin-bottom: 0;
}

/* warning-text child element selectors */
.warning-text strong {
  display: block;
  margin-bottom: 4px;
  color: #d68400;
}

.warning-text p {
  margin: 0;
  font-size: 14px;
  color: #856404;
}

/* dark-theme dialog background — applied via :class binding on .retry-dialog */
.retry-dialog.dark-theme {
  background-color: #1e1e1e;
  color: var(--o2-border);
}

/* Transition effects */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Ensure dialog slides in when it appears */
.fade-enter-active .retry-dialog {
  animation: slide-up 0.3s ease;
}

.fade-leave-active .retry-dialog {
  animation: slide-down 0.2s ease;
}

@keyframes slide-up {
  from {
    transform: translateY(30px);
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
    transform: translateY(30px);
    opacity: 0;
  }
}
</style>
