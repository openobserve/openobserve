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
  <div ref="rootEl" class="min-w-0">
    <OInput
      data-test="date-time-range-input"
      :model-value="modelValue"
      :placeholder="placeholder"
      :aria-label="t('common.rangeInputLabel')"
      :aria-describedby="describedBy"
      :error="error"
      autocomplete="off"
      spellcheck="false"
      @update:model-value="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
    >
      <template #icon-right>
        <span
          v-if="showHint"
          data-test="date-time-range-hint"
          class="text-text-secondary text-xs whitespace-nowrap"
          aria-hidden="true"
          ><span class="max-sm:hidden">{{ t("common.rangeInputHint") }}</span
          ><span class="sm:hidden">{{ t("common.rangeInputHintShort") }}</span></span
        >
        <OPopover v-model:open="helpOpen" side="bottom" align="end" :z-index="10002">
          <template #trigger>
            <OButton
              data-test="date-time-range-help-btn"
              variant="ghost"
              size="icon-xs-sq"
              icon-left="help-outline"
              :aria-label="t('common.rangeHelpTitle')"
            />
          </template>
          <div data-test="date-time-range-help" class="flex w-80 flex-col gap-2 p-3 text-xs">
            <div class="text-text-heading text-sm font-semibold">
              {{ t("common.rangeHelpTitle") }}
            </div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <template v-for="row in helpRows" :key="row.example">
                <dt class="text-text-heading font-mono whitespace-nowrap">{{ row.example }}</dt>
                <dd class="text-text-secondary">{{ row.text }}</dd>
              </template>
            </dl>
            <p class="text-text-secondary">{{ t("common.rangeHelpLanguage") }}</p>
          </div>
        </OPopover>
        <template v-if="!hideClipboard">
          <OTooltip :content="t('common.copyRange')">
            <OButton
              data-test="date-time-copy-btn"
              variant="ghost"
              size="icon-xs-sq"
              icon-left="content-copy"
              :aria-label="t('common.copyRange')"
              @click="emit('copy')"
            />
          </OTooltip>
          <OTooltip :content="t('common.pasteRange')">
            <OButton
              data-test="date-time-paste-btn"
              variant="ghost"
              size="icon-xs-sq"
              icon-left="content-paste"
              :aria-label="t('common.pasteRange')"
              @click="emit('paste')"
            />
          </OTooltip>
        </template>
      </template>
    </OInput>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const PARSE_DEBOUNCE_MS = 150;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: I18nText;
    /** The hint stays while the field holds the applied or draft value, never while typing or on error. */
    showHint?: boolean;
    error?: boolean;
    hideClipboard?: boolean;
    describedBy?: string;
    /** Lists the relative forms in the help. */
    relative?: boolean;
    /** Lists the calendar words in the help. */
    calendar?: boolean;
  }>(),
  {
    placeholder: undefined,
    showHint: false,
    error: false,
    hideClipboard: false,
    describedBy: undefined,
    relative: true,
    calendar: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  /** The debounced text to read as a draft. */
  draft: [text: string];
  /** Enter: the text, read at once. */
  submit: [text: string];
  /** A paste replaced the text; it is read at once and counts as a deliberate edit. */
  "paste-text": [text: string];
  copy: [];
  paste: [];
}>();

const { t } = useI18nTyped();
const rootEl = ref<HTMLElement | null>(null);
const helpOpen = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let pasting = false;

const helpRows = computed(() => {
  const rows: { example: I18nText; text: I18nText }[] = [];
  if (props.relative) {
    rows.push({ example: raw("15m · 90m · 2d · 1M"), text: t("common.rangeHelpRelative") });
  }
  rows.push(
    { example: raw("Nov 4, 13:00 - 15:00"), text: t("common.rangeHelpTwoTimes") },
    { example: raw("2:15 PM to 2:40 PM IST"), text: t("common.rangeHelp12h") },
  );
  if (props.calendar) {
    rows.push(
      { example: raw("yesterday 09:00 - 17:00"), text: t("common.rangeHelpPeriodHours") },
      { example: raw("today · last week"), text: t("common.rangeHelpCalendar") },
    );
  }
  rows.push(
    { example: raw("2026-11-04T08:17:03Z"), text: t("common.rangeHelpInstant") },
    { example: raw("1762244223"), text: t("common.rangeHelpEpoch") },
  );
  return rows;
});

const clearTimer = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

const onInput = (value: string | number) => {
  const text = String(value);
  emit("update:modelValue", text);
  clearTimer();
  if (pasting) {
    pasting = false;
    emit("paste-text", text);
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    emit("draft", text);
  }, PARSE_DEBOUNCE_MS);
};

// The input event that follows a paste carries the whole new text, which is what gets read.
const onPaste = () => {
  pasting = true;
  // A paste that inserts nothing fires no input event, so the latch must not outlive this task.
  setTimeout(() => {
    pasting = false;
  });
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  clearTimer();
  emit("submit", props.modelValue);
};

const inputEl = () => rootEl.value?.querySelector<HTMLInputElement>("input") ?? null;

/** Focuses the field with its text selected, so typing replaces it. */
const focusAndSelect = () => {
  const input = inputEl();
  input?.focus();
  input?.select();
};

/** Drops a pending debounced read, for a text the picker has just replaced. */
const cancelPending = () => {
  clearTimer();
  pasting = false;
};

onBeforeUnmount(clearTimer);

defineExpose({ focusAndSelect, cancelPending, inputEl });
</script>
