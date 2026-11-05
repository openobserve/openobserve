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
  <OBanner
    v-if="shown"
    variant="info"
    role="status"
    inline-actions
    class="shrink-0"
    data-test="inline-helper-hint"
  >
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="break-words">{{ t("assistant.helper.hint", { language: languageName }) }}</span>
      <OText variant="meta" as="span" class="break-words" data-test="inline-helper-hint-tab">
        <i18n-t keypath="assistant.helper.tabFocusHint" tag="span">
          <template #keys><OShortcut id="editorTabFocusMode" /></template>
        </i18n-t>
      </OText>
    </span>
    <template #actions>
      <span class="flex flex-wrap items-center gap-2 max-md:w-full">
        <OButton
          variant="secondary"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="inline-helper-hint-ask"
          @click="ask"
        >
          {{ t("assistant.helper.hintAsk") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="inline-helper-hint-dismiss"
          @click="dismiss"
        >
          {{ t("assistant.helper.hintDismiss") }}
        </OButton>
      </span>
    </template>
  </OBanner>
</template>

<script lang="ts">
import type { AssistantHostAdapter } from "@/composables/assistant/pure";

export interface InlineHelperHintProps {
  /** The editor's text; read after a pause in user typing only. */
  text: string;
  language: AssistantHostAdapter["language"];
  /** False when the user cannot chat here, the door is unavailable or `helper="off"`: the detector never runs. */
  enabled: boolean;
  /** Bumped by the host on each user keystroke; programmatic writes never change it. */
  editTick: number;
  focused: boolean;
}

export interface InlineHelperHintEmits {
  (e: "ask", sentence: string): void;
}

/** The typing pause after which the buffer is read. */
export const HINT_PAUSE_MS = 1_000;

/** The hint goes this long after the editor loses focus. */
export const HINT_BLUR_MS = 10_000;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { PROPOSAL_LANGUAGE_NAMES } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import { readsAsPlainLanguage } from "./helperText";

const props = defineProps<InlineHelperHintProps>();
const emit = defineEmits<InlineHelperHintEmits>();

const { t } = useI18nTyped();
const shown = ref(false);
const dismissed = ref(false);
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
let blurTimer: ReturnType<typeof setTimeout> | null = null;

const languageName = computed(() => raw(PROPOSAL_LANGUAGE_NAMES[props.language]));

watch(
  () => props.editTick,
  () => {
    if (!props.enabled || dismissed.value) return;
    clear("pause");
    pauseTimer = setTimeout(read, HINT_PAUSE_MS);
  },
);

// While shown it stays as the user types, until the text stops reading as a sentence.
watch(
  () => props.text,
  (text) => {
    if (shown.value && !readsAsPlainLanguage(text)) shown.value = false;
  },
);

watch(
  () => props.enabled,
  (enabled) => {
    if (enabled) return;
    shown.value = false;
    clear("pause");
  },
);

watch(
  () => props.focused,
  (focused) => {
    clear("blur");
    if (!focused && shown.value) blurTimer = setTimeout(() => (shown.value = false), HINT_BLUR_MS);
  },
);

onBeforeUnmount(() => {
  clear("pause");
  clear("blur");
});

function read(): void {
  pauseTimer = null;
  if (!props.enabled || dismissed.value) return;
  shown.value = readsAsPlainLanguage(props.text);
}

function ask(): void {
  const sentence = props.text.trim();
  shown.value = false;
  emit("ask", sentence);
}

function dismiss(): void {
  dismissed.value = true;
  shown.value = false;
  clear("pause");
}

function clear(which: "pause" | "blur"): void {
  if (which === "pause" && pauseTimer) clearTimeout(pauseTimer);
  if (which === "blur" && blurTimer) clearTimeout(blurTimer);
  if (which === "pause") pauseTimer = null;
  else blurTimer = null;
}
</script>
