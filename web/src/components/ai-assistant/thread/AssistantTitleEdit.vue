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
  <div class="flex min-w-0 items-center" :data-test="dataTest">
    <input
      v-if="editing"
      ref="field"
      v-model="draft"
      type="text"
      :maxlength="maxlength"
      :aria-label="t('assistant.thread.renameLabel')"
      :class="[
        'bg-input-bg text-input-text ring-input-border-focus rounded-default -mx-1.5 w-full min-w-0 px-1.5 ring-1 outline-none ring-inset',
        textClasses,
      ]"
      :data-test="`${dataTest}-input`"
      @keydown="onKeydown"
      @blur="commit(false)"
    />
    <span v-else-if="readonly" :class="['truncate', textClasses]" :data-test="`${dataTest}-value`">
      {{ title }}
    </span>
    <button
      v-else
      ref="trigger"
      type="button"
      :aria-describedby="hintId"
      :aria-busy="pending ? 'true' : undefined"
      :class="[
        'focus-visible:outline-accent/40 rounded-default min-w-0 cursor-text truncate text-start outline-offset-2 focus-visible:outline-2',
        'max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        textClasses,
        pending ? 'text-text-secondary' : '',
      ]"
      :data-test="`${dataTest}-trigger`"
      @click="start"
      @keydown.f2.prevent="start"
    >
      {{ title }}
    </button>
    <span v-if="!editing && !readonly" :id="hintId" class="sr-only">{{
      t("assistant.thread.renameChat")
    }}</span>
  </div>
</template>

<script lang="ts">
export interface AssistantTitleEditProps {
  title: string;
  readonly?: boolean;
  /** A rename is saving; the title stays clickable so a second one queues behind it. */
  pending?: boolean;
  maxlength?: number;
  dataTest?: string;
  /** `lg` heads a full page; `sm` sits in a panel or window bar. */
  size?: "lg" | "sm";
}

// Same size and weight in both modes, so the title never jumps as it turns into a field.
const TEXT_CLASSES = {
  lg: "text-text-heading text-lg leading-[1.45] font-semibold tracking-[-0.02em]",
  sm: "text-text-heading text-sm leading-normal font-medium",
} as const;
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";

import { editableTitle } from "@/components/ai-assistant/history/chatStatus";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantTitleEditProps>(), {
  readonly: false,
  pending: false,
  maxlength: undefined,
  dataTest: "assistant-thread-heading-edit",
  size: "lg",
});

const emit = defineEmits<{
  (_e: "commit", _value: string): void;
  (_e: "edit-start"): void;
  (_e: "cancel"): void;
}>();

const { t } = useI18nTyped();
const editing = ref(false);
const draft = ref("");
const field = ref<HTMLInputElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const hintId = `assistant-title-${useId()}-hint`;
const textClasses = computed(() => TEXT_CLASSES[props.size]);

async function start(): Promise<void> {
  if (props.readonly || editing.value) return;
  draft.value = editableTitle(props.title);
  editing.value = true;
  emit("edit-start");
  await nextTick();
  field.value?.focus();
  field.value?.select();
}

// Enter and Escape hand focus back to the title; a blur already moved focus on purpose.
async function close(refocus: boolean): Promise<void> {
  editing.value = false;
  if (!refocus) return;
  await nextTick();
  trigger.value?.focus();
}

function commit(refocus: boolean): void {
  if (!editing.value) return;
  emit("commit", draft.value.trim());
  void close(refocus);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commit(true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (editing.value) emit("cancel");
    void close(true);
  }
}

defineExpose({ focus: start });
</script>
