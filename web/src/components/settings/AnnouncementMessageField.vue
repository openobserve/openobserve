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
  <div class="announcement-message-field">
    <div class="announcement-message-toolbar" data-test="announcement-editor-message-toolbar">
      <q-btn
        v-for="action in FORMAT_ACTIONS"
        :key="action.format"
        flat
        dense
        size="sm"
        :icon="action.icon"
        :title="t(`announcements.editor.${action.format}`)"
        :aria-label="t(`announcements.editor.${action.format}`)"
        :data-test="`announcement-editor-format-${action.format}`"
        @click="format(action.format)"
      />
      <q-btn
        flat
        dense
        size="sm"
        icon="add_reaction"
        :title="t('announcements.editor.emoji')"
        :aria-label="t('announcements.editor.emoji')"
        data-test="announcement-editor-format-emoji"
      >
        <q-menu anchor="bottom left" self="top left">
          <div class="announcement-emoji-grid" data-test="announcement-editor-emoji-menu">
            <button
              v-for="emoji in EMOJIS"
              :key="emoji"
              v-close-popup
              type="button"
              class="announcement-emoji"
              :data-test="`announcement-editor-emoji-${emoji}`"
              @click="insert(emoji)"
            >
              {{ emoji }}
            </button>
          </div>
        </q-menu>
      </q-btn>
    </div>

    <q-input
      ref="inputRef"
      :model-value="modelValue"
      type="textarea"
      rows="3"
      borderless
      dense
      hide-bottom-space
      class="announcement-message-input"
      :placeholder="t('announcements.editor.messagePlaceholder')"
      :error="!!error"
      :error-message="error"
      data-test="announcement-editor-message"
      @update:model-value="emit('update:modelValue', String($event ?? ''))"
    />

    <div class="announcement-message-footer">
      <span>{{ t("announcements.editor.messageHelp") }}</span>
      <span
        :class="{ 'announcement-message-count--over': isLong }"
        data-test="announcement-editor-message-count"
      >
        {{ t("announcements.editor.messageCount", { count: modelValue.length, max: SOFT_LIMIT }) }}
      </span>
    </div>
    <div
      v-if="isLong"
      class="announcement-message-long"
      data-test="announcement-editor-message-long"
    >
      {{ t("announcements.editor.messageLong") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";

import {
  applyMarkdownFormat,
  insertAtCaret,
  type FormatResult,
  type MarkdownFormat,
} from "@/utils/announcementMarkdown";

const props = defineProps<{ modelValue: string; error?: string }>();

const emit = defineEmits<{ (_e: "update:modelValue", _value: string): void }>();

const SOFT_LIMIT = 300;

const FORMAT_ACTIONS: { format: MarkdownFormat; icon: string }[] = [
  { format: "bold", icon: "format_bold" },
  { format: "italic", icon: "format_italic" },
  { format: "code", icon: "code" },
  { format: "link", icon: "link" },
];

const EMOJIS = ["🚨", "🔥", "⚠️", "✅", "❌", "📈", "🔔", "⏱️", "🎉", "🛠️", "📣", "ℹ️"];

const { t } = useI18n();

const inputRef = ref<{ getNativeElement: () => HTMLTextAreaElement } | null>(null);

const isLong = computed(() => props.modelValue.length > SOFT_LIMIT);

const selection = () => {
  const native = inputRef.value?.getNativeElement();
  const end = props.modelValue.length;
  return {
    native,
    start: native?.selectionStart ?? end,
    end: native?.selectionEnd ?? end,
  };
};

const apply = async (result: FormatResult, native?: HTMLTextAreaElement) => {
  emit("update:modelValue", result.value);
  await nextTick();
  native?.focus();
  native?.setSelectionRange(result.selectionStart, result.selectionEnd);
};

const format = (kind: MarkdownFormat) => {
  const { native, start, end } = selection();
  void apply(applyMarkdownFormat(props.modelValue, start, end, kind), native);
};

const insert = (text: string) => {
  const { native, start, end } = selection();
  void apply(insertAtCaret(props.modelValue, start, end, text), native);
};
</script>

<style scoped lang="scss">
.announcement-message-field {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
}

.announcement-message-toolbar {
  display: flex;
  gap: 0.125rem;
  padding: 0.25rem;
  border-bottom: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-message-input :deep(textarea.q-field__native) {
  padding: 0.5rem;
  resize: vertical;
}

.announcement-message-footer {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-message-count--over {
  color: var(--q-warning);
  font-weight: 600;
}

.announcement-message-long {
  padding: 0 0.5rem 0.375rem;
  font-size: 0.75rem;
  color: var(--q-warning);
}

.announcement-emoji-grid {
  display: grid;
  grid-template-columns: repeat(6, 2rem);
  gap: 0.25rem;
  padding: 0.5rem;
}

.announcement-emoji {
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 0.25rem;
  background: transparent;
  font-size: 1.125rem;
  cursor: pointer;

  &:hover {
    background: rgba(128, 128, 128, 0.15);
  }
}
</style>
