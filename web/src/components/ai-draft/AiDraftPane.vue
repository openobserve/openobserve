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

<!-- One drafting loop on screen: the prompt, progress, the assistant's words, then the host's read-back; failures are one line. -->
<template>
  <div class="flex flex-col gap-3" data-test="ai-draft-pane" :data-phase="phase">
    <slot v-if="phase === 'idle'" name="compose" />
    <template v-else>
      <div class="flex min-w-0 items-center gap-2" data-test="ai-draft-prompt-line">
        <p
          class="bg-surface-subtle rounded-default text-text-body m-0 flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-sm"
        >
          <OIcon name="chat" size="xs" class="text-text-secondary shrink-0" />
          <OTruncatedText class="min-w-0" data-test="ai-draft-prompt">{{ prompt }}</OTruncatedText>
        </p>
        <OButton
          variant="outline"
          size="sm"
          icon-left="edit"
          class="shrink-0"
          :disabled="phase === 'approving'"
          data-test="ai-draft-edit-prompt"
          @click="emit('edit-prompt')"
          >{{ t("aiDraft.editPrompt") }}</OButton
        >
      </div>

      <!-- Above the progress, so the words stay put when the read-back replaces the progress. -->
      <OTruncatedText
        v-if="said"
        as="p"
        :lines="4"
        class="text-text-body m-0 text-sm break-words whitespace-pre-line"
        tooltip-class="whitespace-pre-line"
        data-test="ai-draft-said"
        >{{ said }}</OTruncatedText
      >
      <AiDraftStatus v-if="phase === 'drafting'" :lines="draft.statusLines.value" />

      <form
        v-if="phase === 'reply'"
        class="flex items-end gap-2"
        data-test="ai-draft-reply"
        @submit.prevent="sendReply"
      >
        <OTextarea
          v-model="answer"
          :rows="2"
          class="min-w-0 flex-1"
          :placeholder="t('aiDraft.replyLabel')"
          :aria-label="t('aiDraft.replyLabel')"
          data-test="ai-draft-reply-input"
          @keydown="onReplyKeydown"
        />
        <OButton
          type="submit"
          variant="outline"
          size="sm"
          :disabled="!answer.trim()"
          data-test="ai-draft-reply-send"
          >{{ t("aiDraft.replySend") }}</OButton
        >
      </form>

      <slot v-if="result && phase !== 'drafting'" name="readback" :result="result" />

      <OInlineNotice
        v-if="failure"
        variant="error"
        :text="failureText"
        :action-label="failure.kind === 'quota' ? undefined : t('common.retry')"
        data-test="ai-draft-failure"
        action-data-test="ai-draft-retry"
        @action="draft.retry()"
      />
      <OInlineNotice
        v-else-if="phase === 'saved'"
        variant="warning"
        :text="t('aiDraft.savedByAssistant')"
        :action-label="draft.createdRoute.value ? t('aiDraft.openSaved') : undefined"
        data-test="ai-draft-saved"
        action-data-test="ai-draft-open-saved"
        @action="emit('open-saved')"
      />
    </template>
  </div>
</template>

<script setup lang="ts" generic="T">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { AiDraft } from "@/composables/alerts/useAiDraft";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import AiDraftStatus from "./AiDraftStatus.vue";

const props = defineProps<{ draft: AiDraft<T> }>();
const emit = defineEmits<{ "edit-prompt": []; "open-saved": [] }>();

const { t } = useI18nTyped();
const answer = ref("");

const phase = computed(() => props.draft.phase.value);
const prompt = computed(() => raw(props.draft.prompt.value));
const said = computed(() => raw(props.draft.text.value.trim()));
const result = computed(() => props.draft.result.value);
const failure = computed(() => props.draft.failure.value);

watch(phase, (next) => {
  if (next !== "reply") answer.value = "";
});

const sendReply = () => {
  if (answer.value.trim()) void props.draft.reply(answer.value);
};

// Enter sends; Shift+Enter is a new line.
const onReplyKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendReply();
};

const failureText = computed<I18nText>(() => {
  const f = failure.value;
  if (!f) return raw("");
  const reason = f.detail;
  switch (f.kind) {
    case "unavailable":
      return reason
        ? t("aiDraft.failure.unavailableReason", { reason })
        : t("aiDraft.failure.unavailable");
    case "quota":
      return reason ?? t("aiDraft.failure.quota");
    case "stream":
      return reason ? t("aiDraft.failure.streamReason", { reason }) : t("aiDraft.failure.stream");
    case "noProposal":
      return t("aiDraft.failure.noProposal");
    case "expired":
      return t("aiDraft.failure.expired");
    case "notCreated":
      return reason
        ? t("aiDraft.failure.notCreatedReason", { reason })
        : t("aiDraft.failure.notCreated");
    default: {
      // The path names a payload key, which is for the model; the screen gets the message alone.
      const issues = props.draft.issues.value;
      const more = Math.max(0, issues.length - 1);
      return t(
        "aiDraft.failure.invalid",
        { reason: raw(issues[0]?.message ?? ""), count: more },
        more,
      );
    }
  }
});
</script>
