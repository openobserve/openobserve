<!-- Copyright 2025 OpenObserve Inc.

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
        @click="handleBackdropClick"
      >
        <div
          class="retry-dialog"
          ref="dialogRef"
          @click.stop
          role="dialog"
          aria-modal="true"
          :class="{ 'dark-theme': store.state.theme === 'dark' }"
        >
          <!-- Header -->
          <div class="retry-dialog-header">
            <h3 class="retry-dialog-title">Retry Enrichment Table Job</h3>
            <button
              class="retry-dialog-close"
              @click="handleCancel"
              aria-label="Close"
            >
              <q-icon name="close" size="20px" />
            </button>
          </div>

          <!-- Content -->
          <div class="retry-dialog-content">
            <div class="table-info">
              <div class="info-row">
                <span class="info-label">Table:</span>
                <span class="info-value">{{ tableName }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">URL:</span>
                <span class="info-value url-text">{{ url }}</span>
              </div>
            </div>

            <!-- Range Support Warning -->
            <div v-if="!supportsRange" class="warning-banner">
              <q-icon name="warning" size="20px" class="warning-icon" />
              <div class="warning-text">
                <strong>Range requests not supported</strong>
                <p>
                  This URL does not support resuming from the last position.
                  The job will restart from the beginning.
                </p>
              </div>
            </div>

            <!-- Retry Options (only shown if range is supported) -->
            <div v-if="supportsRange" class="retry-options">
              <p class="options-title">How would you like to retry?</p>

              <div class="option-card" :class="{ selected: !resumeFromLast }">
                <label class="option-label">
                  <input
                    type="radio"
                    name="retryOption"
                    :value="false"
                    v-model="resumeFromLast"
                    class="option-radio"
                  />
                  <div class="option-content">
                    <div class="option-header">
                      <q-icon name="refresh" size="20px" class="option-icon" />
                      <span class="option-name">Start from Beginning</span>
                    </div>
                    <p class="option-description">
                      Download the entire file from scratch. All previous progress will be discarded.
                    </p>
                  </div>
                </label>
              </div>

              <div class="option-card" :class="{ selected: resumeFromLast }">
                <label class="option-label">
                  <input
                    type="radio"
                    name="retryOption"
                    :value="true"
                    v-model="resumeFromLast"
                    class="option-radio"
                  />
                  <div class="option-content">
                    <div class="option-header">
                      <q-icon name="play_arrow" size="20px" class="option-icon" />
                      <span class="option-name">Resume from Last Position</span>
                      <span class="recommended-badge">Recommended</span>
                    </div>
                    <p class="option-description">
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
          <div class="retry-dialog-footer">
            <q-btn
              flat
              label="Cancel"
              color="grey-7"
              @click="handleCancel"
              class="footer-btn"
            />
            <q-btn
              unelevated
              label="Retry"
              color="primary"
              @click="handleConfirm"
              class="footer-btn"
            />
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

export default defineComponent({
  name: "RetryJobDialog",
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
.retry-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.retry-dialog {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.retry-dialog.dark-theme {
  background-color: #1e1e1e;
  color: #e0e0e0;
}

.retry-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #eaeaea;
}

.dark-theme .retry-dialog-header {
  border-bottom-color: #3a3a3a;
}

.retry-dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: #333;
}

.dark-theme .retry-dialog-title {
  color: #e0e0e0;
}

.retry-dialog-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  transition: background-color 0.2s;
  padding: 0;
}

.retry-dialog-close:hover {
  background-color: #f5f5f5;
  color: #333;
}

.dark-theme .retry-dialog-close {
  color: #999;
}

.dark-theme .retry-dialog-close:hover {
  background-color: #2a2a2a;
  color: #e0e0e0;
}

.retry-dialog-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.table-info {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f8f9fa;
  border-radius: 6px;
}

.dark-theme .table-info {
  background-color: #2a2a2a;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  font-weight: 600;
  min-width: 60px;
  color: #666;
}

.dark-theme .info-label {
  color: #999;
}

.info-value {
  color: #333;
  word-break: break-word;
}

.dark-theme .info-value {
  color: #e0e0e0;
}

.url-text {
  font-family: monospace;
  font-size: 13px;
}

.warning-banner {
  display: flex;
  gap: 12px;
  padding: 16px;
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  margin-bottom: 20px;
}

.dark-theme .warning-banner {
  background-color: #3d3516;
  border-color: #a67c00;
}

.warning-icon {
  color: #ff9800;
  flex-shrink: 0;
}

.warning-text {
  flex: 1;
}

.warning-text strong {
  display: block;
  margin-bottom: 4px;
  color: #d68400;
}

.dark-theme .warning-text strong {
  color: #ffb84d;
}

.warning-text p {
  margin: 0;
  font-size: 14px;
  color: #856404;
}

.dark-theme .warning-text p {
  color: #d4a86a;
}

.retry-options {
  margin-top: 20px;
}

.options-title {
  font-weight: 600;
  margin-bottom: 16px;
  color: #333;
}

.dark-theme .options-title {
  color: #e0e0e0;
}

.option-card {
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 12px;
  transition: all 0.2s;
  cursor: pointer;
}

.option-card:hover {
  border-color: #1976d2;
  background-color: #f5f9ff;
}

.dark-theme .option-card {
  border-color: #3a3a3a;
}

.dark-theme .option-card:hover {
  border-color: #1976d2;
  background-color: #1a2332;
}

.option-card.selected {
  border-color: #1976d2;
  background-color: #e3f2fd;
}

.dark-theme .option-card.selected {
  background-color: #1a2332;
}

.option-label {
  display: block;
  padding: 16px;
  cursor: pointer;
  width: 100%;
}

.option-radio {
  position: absolute;
  opacity: 0;
  cursor: pointer;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  color: #333;
}

.dark-theme .option-header {
  color: #e0e0e0;
}

.option-icon {
  color: #1976d2;
}

.option-name {
  flex: 1;
}

.recommended-badge {
  background-color: #4caf50;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.option-description {
  margin: 0;
  font-size: 14px;
  color: #666;
  line-height: 1.5;
}

.dark-theme .option-description {
  color: #999;
}

.retry-dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid #eaeaea;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.dark-theme .retry-dialog-footer {
  border-top-color: #3a3a3a;
}

.footer-btn {
  min-width: 100px;
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
