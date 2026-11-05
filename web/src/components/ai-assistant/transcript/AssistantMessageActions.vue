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
  <div
    role="group"
    :aria-label="t('assistant.message.actionsName')"
    :class="[
      'flex shrink-0 items-center gap-1',
      isLast
        ? ''
        : 'sr-only group-focus-within/message:not-sr-only group-hover/message:not-sr-only pointer-coarse:not-sr-only',
    ]"
    data-test="assistant-msg-actions"
  >
    <AssistantIconButton
      :label="copied ? t('common.copied') : t('assistant.message.copyAnswer')"
      :icon="copied ? assistantGlyph.copied : assistantGlyph.copy"
      data-test="assistant-msg-copy-answer"
      @click="copyAnswer"
    />
    <AssistantIconButton
      v-if="fresh && rerunShown"
      :label="
        fresh.range
          ? t('assistant.footer.rerunFor', { range: fresh.range })
          : t('assistant.turn.rerun')
      "
      :icon="assistantGlyph.regenerate"
      :disabled="!!lockedReason"
      :disabled-reason="lockedReason ?? undefined"
      data-test="assistant-rerun"
      @click="rerunFresh"
    />
    <AssistantIconButton
      v-else-if="rerunShown"
      :label="t('assistant.turn.rerun')"
      :icon="assistantGlyph.regenerate"
      :disabled="!!lockedReason"
      :disabled-reason="lockedReason ?? undefined"
      data-test="assistant-msg-regenerate"
      @click="rerun"
    />
  </div>
</template>

<script lang="ts">
import type { ChatMessage } from "@/ts/interfaces/chat";
import type { I18nText } from "@/types/i18n";

export interface AssistantMessageActionsProps {
  sid: string;
  message: ChatMessage;
  isLast: boolean;
  /** The user message an answer replies to; Re-run resends it. */
  prompt?: ChatMessage | null;
  /** False when the turn failed: its outcome's own retry is the one place to act (`30` §8.3). */
  canRegenerate?: boolean;
  /** A stale answer's Re-run asks again over its range moved to now instead of regenerating it. */
  fresh?: { turnId: string; range: I18nText | null } | null;
}

/** How long a copy button shows its check (EB-09 AC 5). */
export const COPIED_MS = 2_000;
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { announceComposer } from "@/components/ai-assistant/composer/composerUi";
import { useAssistantCapability, useAssistantStore } from "@/composables/assistant";
import { assistantTranscriptHostKey, turnLockKey, useTurnLock } from "@/composables/assistant/pure";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import { markdownToPlainText } from "./markdown";

const props = withDefaults(defineProps<AssistantMessageActionsProps>(), {
  prompt: null,
  canRegenerate: true,
  fresh: null,
});

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const host = inject(assistantTranscriptHostKey, null);
const turnLock = useTurnLock(() => props.sid);

// Without B-12 a version replaces the latest answer only, so older turns never offer Re-run.
const rerunShown = computed(
  () => props.isLast && !!props.prompt && (props.canRegenerate || !!props.fresh),
);
const lockedReason = computed(() => {
  if (turnLock.value) return t(turnLockKey(turnLock.value));
  return capability.value.creditMode === "exhausted" ? t("assistant.message.creditsUsedUp") : null;
});

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// Each block through the same worker path as its render; a block already rendered answers from cache, synchronously.
function answerText(): string | Promise<string> {
  const texts = (props.message.contentBlocks ?? [])
    .filter((block) => block.type === "text" && block.text?.trim())
    .map((block) => block.text!);
  const plains = (texts.length ? texts : [String(props.message.content ?? "")]).map(
    markdownToPlainText,
  );
  const join = (all: string[]) => all.filter(Boolean).join("\n\n");
  if (plains.every((plain) => typeof plain === "string")) return join(plains as string[]);
  return Promise.all(plains).then(join);
}

async function copyAnswer(): Promise<void> {
  const content = answerText();
  const text = typeof content === "string" ? content : await content;
  const ok = await copyToClipboard(text, t, { silent: true });
  if (!ok) return void announceComposer(props.sid, t("assistant.client.copyManually"));
  copied.value = true;
  announceComposer(props.sid, t("common.copied"));
  trackAssistant("ai_thread_action", { action: "copy_answer" });
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
}

function rerun(): void {
  trackAssistant("ai_thread_action", { action: "regenerate" });
  void store.regenerate(props.sid);
  host?.focusComposer();
}

function rerunFresh(): void {
  if (!props.fresh || lockedReason.value) return;
  void store.dispatch(props.sid, { kind: "rerun_now", turnId: props.fresh.turnId });
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
