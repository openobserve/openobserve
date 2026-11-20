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
const forwardChatInput = (instance: Element | ComponentPublicInstance | null) =>
  emit("input-ref", instance);
</script>

<template>
  <div
    class="unified-input-box rounded-default bg-surface-base border-border-default focus-within:ring-accent flex flex-col gap-3 border px-2 py-1 transition-all duration-200 focus-within:border-transparent focus-within:ring-2"
  >
    <!-- Image preview strip -->
    <div v-if="pendingImages.length > 0" class="image-preview-strip mb-2 flex flex-wrap gap-2 py-2">
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
          icon-only
          :aria-label="t('common.remove')"
          variant="ghost"
          size="xs"
          class="image-remove-btn bg-status-negative! hover:bg-status-negative! absolute! -top-1.5! -right-1.5! z-10"
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

    <!-- Bottom bar: every control is the same sm size, so the row reads as one bar (S2). -->
    <div class="input-bottom-bar flex items-center justify-between pt-1">
      <div class="flex items-center gap-1">
        <OButton
          v-if="!isLoading"
          icon-only
          icon="image"
          variant="ghost"
          size="sm"
          :label="t('aiAssistant.attachImageTooltip')"
          class="image-upload-btn"
          @click.stop="emit('trigger-image-upload')"
        />
        <OButton
          v-if="!isLoading"
          variant="ghost"
          size="sm"
          :pressed="autoNavigation"
          class="auto-nav-toggle-btn"
          @click.stop="emit('update:autoNavigation', !autoNavigation)"
        >
          {{ t("aiAssistant.autoNavigation.label") }}
          <OTooltip
            :content="
              autoNavigation
                ? t('aiAssistant.autoNavigation.enabledTooltip')
                : t('aiAssistant.autoNavigation.disabledTooltip')
            "
          />
        </OButton>
      </div>

      <OButton
        v-if="!isLoading"
        icon-only
        icon="arrow-upward"
        variant="primary"
        size="sm"
        :label="t('common.send')"
        :disabled="!modelValue.trim() && pendingImages.length === 0"
        class="send-button"
        @click="emit('send')"
      />
      <OButton
        v-else
        icon-only
        icon="stop"
        variant="secondary"
        size="sm"
        :label="t('common.stopGenerating')"
        class="stop-button"
        @click="emit('cancel')"
      />
    </div>
  </div>
</template>

<style scoped>
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
