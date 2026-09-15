<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import RichTextInput, { type ReferenceChip } from "@/components/RichTextInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

type PendingImage = { filename: string; mimeType: string; data: string; size: number };

defineProps<{
  modelValue: string;
  autoNavigation: boolean;
  pendingImages: PendingImage[];
  placeholder: I18nText;
  isLoading: boolean;
  theme: "light" | "dark";
  references: ReferenceChip[];
}>();

// dragover/drop/paste stay undeclared so they fall through to the root as native listeners.
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:autoNavigation", value: boolean): void;
  (e: "update:references", refs: ReferenceChip[]): void;
  (e: "input-ref", instance: Element | ComponentPublicInstance | null): void;
  (e: "keydown", event: KeyboardEvent): void;
  (e: "send"): void;
  (e: "cancel"): void;
  (e: "trigger-image-upload"): void;
  (e: "remove-image", index: number): void;
}>();

const { t } = useI18nTyped();

// A function ref, unlike a string ref, still reports null during unmount after this scope has stopped.
const forwardChatInput = (instance: Element | ComponentPublicInstance | null) => emit("input-ref", instance);
</script>

<template>
  <div
    class="unified-input-box rounded-default bg-surface-base border-border-default focus-within:ring-accent flex flex-col gap-3 border px-2 py-1 transition-all duration-200 focus-within:border-transparent focus-within:ring-2"
  >
    <!-- Image preview strip -->
    <div
      v-if="pendingImages.length > 0"
      class="image-preview-strip mb-2 flex flex-wrap gap-2 py-2"
    >
      <div
        v-for="(img, index) in pendingImages"
        :key="index"
        class="image-preview-item relative inline-block"
      >
        <img
          :src="'data:' + img.mimeType + ';base64,' + img.data"
          :alt="img.filename"
          class="preview-image rounded-default border-border-default h-16 w-16 border object-cover [transition:transform_0.2s_ease] hover:scale-105"
        />
        <OButton
          variant="ghost"
          size="icon-xs-circle"
          class="image-remove-btn bg-status-negative! hover:bg-status-negative! absolute! -top-1.5! -right-1.5! z-10 h-5! min-h-5! w-5! min-w-5! p-0!"
          @click.stop="emit('remove-image', index)"
        >
          <OIcon name="close" size="xs" />
        </OButton>
        <OTooltip
          :content="
            t('common.fileWithSize', {
              name: img.filename,
              size: (img.size / 1024).toFixed(0),
            })
          "
        />
      </div>
    </div>

    <RichTextInput
      :ref="forwardChatInput"
      :model-value="modelValue"
      @update:model-value="(value: string) => emit('update:modelValue', value)"
      :placeholder="placeholder"
      :disabled="isLoading"
      :theme="theme"
      :references="references"
      :borderless="true"
      @keydown="(e: KeyboardEvent) => emit('keydown', e)"
      @submit="emit('send')"
      @update:references="(refs: ReferenceChip[]) => emit('update:references', refs)"
    />

    <!-- Bottom bar with buttons -->
    <div class="input-bottom-bar flex items-center justify-between pt-2">
      <div class="flex items-center gap-2">
        <!-- Image upload button -->
        <OButton
          v-if="!isLoading"
          @click.stop="emit('trigger-image-upload')"
          variant="ghost"
          size="icon-sm"
          class="image-upload-btn opacity-70 transition-opacity duration-200 hover:opacity-100"
        >
          <OIcon name="image" size="sm" class="text-icon-color" />
          <OTooltip :content="t('aiAssistant.attachImageTooltip')" />
        </OButton>
        <div v-else class="w-8"></div>

        <!-- Auto navigation toggle button -->
        <OButton
          v-if="!isLoading"
          @click.stop="emit('update:autoNavigation', !autoNavigation)"
          variant="ghost"
          size="sm"
          class="auto-nav-toggle-btn rounded-default hover:bg-surface-subtle flex items-center gap-1.5 px-2 py-1 transition-all duration-200"
        >
          <OIcon
            :name="autoNavigation ? 'check-circle' : 'radio-button-unchecked'"
            size="sm"
            :class="[
              'auto-nav-icon',
              autoNavigation ? 'text-theme-accent!' : 'text-icon-color',
            ]"
          />
          <span
            class="auto-nav-label ms-1 text-xs font-medium"
            :class="autoNavigation ? 'text-theme-accent' : 'text-text-secondary'"
            >{{ t("aiAssistant.autoNavigation.label") }}</span
          >
          <OTooltip
            :content="
              autoNavigation
                ? t('aiAssistant.autoNavigation.enabledTooltip')
                : t('aiAssistant.autoNavigation.disabledTooltip')
            "
          />
        </OButton>
      </div>

      <div class="flex items-center gap-2">
        <!-- Send button - shown when not loading -->
        <OButton
          v-if="!isLoading"
          :disabled="!modelValue.trim() && pendingImages.length === 0"
          @click="emit('send')"
          variant="primary"
          size="icon-xs-circle"
          class="send-button hover:bg-gradient-ai!"
        >
          <OIcon name="arrow-upward" size="sm" />
        </OButton>

        <!-- Stop button - shown when loading/streaming -->
        <OButton
          v-if="isLoading"
          @click="emit('cancel')"
          variant="ghost"
          size="icon-xs-circle"
          class="stop-button shadow-status-negative/30! hover:shadow-status-negative/40! active:shadow-status-negative/30! bg-gradient-danger! hover:bg-gradient-danger-hover! shadow-lg! [transition:all_0.3s_ease]! hover:-translate-y-px! hover:shadow-lg! active:translate-y-0! active:shadow-md!"
        >
          <OIcon name="stop" size="sm" />
        </OButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* keep(complex-state): .send-button's :not(.disabled):not([disabled]):not(:disabled)
   guard has no utility equivalent (`enabled:` covers :disabled, not the .disabled class). */

/* ============================================================
   keep(complex-state) — send button.
   The enabled guard is a .disabled CLASS plus [disabled] plus :disabled;
   Tailwind's `enabled:` variant only covers the last two.
   ============================================================ */
.send-button:hover:not(.disabled):not([disabled]):not(:disabled) {
  /* The hover gradient is `hover:bg-gradient-ai!` on the button itself. It used to
     be restated here, then dropped when the template briefly carried the gradient
     unconditionally — and main later moved the button back to variant="primary",
     so between the two changes the gradient stopped painting at all. */
  box-shadow: var(--shadow-glow-xl-geom) color-mix(in srgb, var(--color-ai-accent) 40%, transparent) !important;
  transform: translateY(-0.0625rem) !important;
}
.send-button:active:not(.disabled):not([disabled]):not(:disabled) {
  transform: translateY(0) !important;
  /* Pressed keeps the accent, dimmer than hover — NOT --shadow-glow, which is a
     neutral black ring and turns the press state grey. */
  box-shadow: var(--shadow-glow-press-geom)
    color-mix(in srgb, var(--color-ai-accent) 30%, transparent) !important;
}

/* ============================================================
   keep(generated-content) — RichTextInput is a child component, so its
   internals carry no scope attribute of ours.
   ============================================================ */
.unified-input-box :deep(.rich-text-input-wrapper) {
  width: 100%;
  min-height: 2.5rem;
}
.unified-input-box :deep(.rich-text-input) {
  padding: 0.25rem 0;
}
</style>
