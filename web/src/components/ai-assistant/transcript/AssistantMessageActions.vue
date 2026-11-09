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
      'relative flex shrink-0 items-center gap-1',
      isLast
        ? ''
        : 'opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100',
    ]"
    :data-variant="variant"
    data-test="assistant-msg-actions"
  >
    <AssistantIconButton
      :label="copied ? t('common.copied') : copyName"
      :icon="copied ? assistantGlyph.copied : assistantGlyph.copy"
      :data-test="variant === 'prompt' ? 'assistant-msg-copy-prompt' : 'assistant-msg-copy-answer'"
      @click="copyText"
    />
    <AssistantIconButton
      v-if="variant === 'prompt' && editable"
      :label="t('assistant.message.edit')"
      :icon="assistantGlyph.edit"
      data-test="assistant-msg-edit"
      @click="editPrompt"
    />
    <template v-if="variant === 'answer'">
      <AssistantIconButton
        v-if="reader.supported"
        :label="reading ? t('assistant.message.pauseReading') : t('assistant.message.readAloud')"
        :icon="reading ? assistantGlyph.pause : assistantGlyph.readAloud"
        :on="reading"
        data-test="assistant-msg-read-aloud"
        @click="toggleReading"
      />
      <AssistantIconButton
        v-if="turnId"
        :label="t('assistant.message.shareAnswer')"
        :icon="assistantGlyph.shareLink"
        :done="linkCopied ? t('assistant.message.linkCopied') : undefined"
        confirms
        data-test="assistant-msg-share-link"
        @click="copyLink"
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
      <slot name="versions" />
      <AssistantIconButton
        v-if="turnId"
        :label="t('assistant.message.branch')"
        :icon="assistantGlyph.branch"
        :loading="branching.pending.value"
        :disabled="!!lockedReason"
        :disabled-reason="lockedReason ?? undefined"
        data-test="assistant-msg-branch"
        @click="branch"
      />
    </template>
    <div
      v-if="reader.state.value !== 'idle'"
      class="pointer-events-none absolute inset-x-0 top-full"
      data-test="assistant-msg-read-progress-slot"
    >
      <OProgressBar
        :value="reader.progress.value / 100"
        size="xs"
        :aria-label="t('assistant.message.readingAloud')"
        data-test="assistant-msg-read-progress"
      />
    </div>
  </div>
</template>

<script lang="ts">
import type { ChatMessage } from "@/ts/interfaces/chat";
import type { I18nText } from "@/types/i18n";

export interface AssistantMessageActionsProps {
  sid: string;
  message: ChatMessage;
  isLast: boolean;
  /** `prompt` is the sent message's Copy and Edit; `answer` is the full answer row. */
  variant?: "answer" | "prompt";
  /** The transcript's turn id; Share link and Branch act on it, and neither renders without it. */
  turnId?: string | null;
  /** The answer version shown, sent with Branch when the turn has more than one. */
  version?: { current: number; count: number } | null;
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
import {
  useAssistantCapability,
  useAssistantSession,
  useAssistantStore,
} from "@/composables/assistant";
import {
  assistantTranscriptHostKey,
  footerOf,
  type FindingsData,
  turnLockKey,
  useTurnLock,
} from "@/composables/assistant/pure";
import { queryClient } from "@/composables/query/queryClient";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { chatSharesQuery } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import { activeShareUrl, answerLink } from "./answerLink";
import { markdownToPlainText } from "./markdown";
import { useBranchChat } from "./useBranchChat";
import { useReadAloud } from "./useReadAloud";

const props = withDefaults(defineProps<AssistantMessageActionsProps>(), {
  variant: "answer",
  turnId: null,
  version: null,
  prompt: null,
  canRegenerate: true,
  fresh: null,
});

defineSlots<{ versions?: () => unknown }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const host = inject(assistantTranscriptHostKey, null);
const turnLock = useTurnLock(() => props.sid);
const view = useAssistantSession(() => props.sid);
const org = () => view.session.value?.org ?? "";
const branching = useBranchChat(org);
const reader = useReadAloud(() => answerText());

// Without B-12 a version replaces the latest answer only, so older turns never offer Re-run.
const rerunShown = computed(
  () => props.isLast && !!props.prompt && (props.canRegenerate || !!props.fresh),
);
const lockedReason = computed(() => {
  if (turnLock.value) return t(turnLockKey(turnLock.value));
  return capability.value.creditMode === "exhausted" ? t("assistant.message.creditsUsedUp") : null;
});
// Edit puts the words back in the composer; a locked turn has no composer to take them.
const editable = computed(() => !turnLock.value);
const copyName = computed(() =>
  props.variant === "prompt"
    ? t("assistant.message.copyPrompt")
    : t("assistant.message.copyAnswer"),
);
const reading = computed(() => reader.state.value === "playing");

const copied = ref(false);
const linkCopied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let linkTimer: ReturnType<typeof setTimeout> | null = null;

// Each block through the same worker path as its render; a block already rendered answers from cache, synchronously.
function answerText(): string | Promise<string> {
  const blocks = props.message.contentBlocks ?? [];
  const texts = blocks
    .filter((block) => block.type === "text" && block.text?.trim())
    .map((block) => block.text!);
  // A findings-only answer has no prose, so its card's words are what Copy and Read aloud carry.
  if (!texts.length) texts.push(...blocks.flatMap((block) => findingsText(block.findings)));
  const plains = (texts.length ? texts : [String(props.message.content ?? "")]).map(
    markdownToPlainText,
  );
  const join = (all: string[]) => all.filter(Boolean).join("\n\n");
  if (plains.every((plain) => typeof plain === "string")) return join(plains as string[]);
  return Promise.all(plains).then(join);
}

async function copyText(): Promise<void> {
  const content = props.variant === "prompt" ? String(props.message.content ?? "") : answerText();
  const text = typeof content === "string" ? content : await content;
  const ok = await copyToClipboard(text, t, { silent: true });
  if (!ok) return void announceComposer(props.sid, t("assistant.client.copyManually"));
  copied.value = true;
  announceComposer(props.sid, t("common.copied"));
  if (props.variant === "answer") trackAssistant("ai_thread_action", { action: "copy_answer" });
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
}

async function copyLink(): Promise<void> {
  if (!props.turnId) return;
  const turnId = footerOf(props.message)?.serverTurnId ?? props.turnId;
  // The cached list only: a network read here would cost the click's clipboard permission.
  const shares = queryClient.getQueryData(chatSharesQuery(org(), props.sid).queryKey);
  const session = view.session.value;
  const lastSeq = session?.record.cachedLastSeq ?? session?.turnMeta.lastSeq ?? null;
  const shareUrl = activeShareUrl(shares, lastSeq);
  const link = answerLink({ org: org(), sid: props.sid, turnId, shareUrl });
  const ok = await copyToClipboard(link, t, { silent: true });
  trackAssistant("ai_answer_link", { result: ok ? "copied" : "failed" });
  if (!ok) return void announceComposer(props.sid, t("assistant.client.copyManually"));
  linkCopied.value = true;
  if (linkTimer) clearTimeout(linkTimer);
  linkTimer = setTimeout(() => (linkCopied.value = false), COPIED_MS);
}

// The shown answer's own server id names its version; a stored record without it names the group and the version shown.
function branch(): void {
  if (!props.turnId || lockedReason.value) return;
  const own = footerOf(props.message)?.serverTurnId;
  if (own) return void branching.branch({ sid: props.sid, turnId: own });
  const version = props.version && props.version.count > 1 ? props.version.current : undefined;
  void branching.branch({
    sid: props.sid,
    turnId: props.turnId,
    ...(version !== undefined && { version }),
  });
}

// Pause counts as a stop: the reader chose to end it; reaching the end of the text is not tracked.
async function toggleReading(): Promise<void> {
  const before = reader.state.value;
  await reader.toggle();
  if (before === "playing") trackAssistant("ai_read_aloud", { action: "stop" });
  else if (before === "idle" && reader.state.value === "playing")
    trackAssistant("ai_read_aloud", { action: "start" });
}

function editPrompt(): void {
  store.stage(props.sid, {
    text: String(props.message.content ?? ""),
    chips: props.message.chips ?? [],
    mode: "replace",
  });
  host?.focusComposer();
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

// The cause, the verified evidence and the next step, as the card shows them.
function findingsText(findings: FindingsData | null | undefined): string[] {
  if (!findings) return [];
  const evidence = findings.evidence.map((item) => `- ${item.text}`).join("\n");
  const next = findings.nextSteps.length
    ? String(t("assistant.findings.next", { text: raw(findings.nextSteps.join("; ")) }))
    : "";
  return [findings.likelyCause, evidence, next].filter((part) => !!part.trim());
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
  if (linkTimer) clearTimeout(linkTimer);
});
</script>
