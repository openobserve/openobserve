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
  <OText
    v-if="unavailable"
    variant="meta"
    role="status"
    class="max-md:w-full"
    data-test="assistant-shared-continue-unavailable"
    >{{ t("assistant.fork.unavailable") }}</OText
  >
  <div
    v-else
    class="flex flex-wrap items-center gap-2 max-md:w-full"
    data-test="assistant-shared-continue"
  >
    <template v-if="latest">
      <OButton
        variant="primary"
        size="sm"
        class="max-md:min-h-11 max-md:w-full"
        :disabled="pending"
        data-test="assistant-shared-open-copy"
        @click="openCopy"
      >
        {{ t("assistant.shared.openCopy") }}
        <OTooltip :content="t('assistant.shared.openCopyTooltip')" />
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        class="max-md:min-h-11 max-md:w-full"
        :loading="pending"
        data-test="shared-chat-continue"
        @click="continueChat"
        >{{ t("assistant.shared.continueAgain") }}</OButton
      >
    </template>
    <OButton
      v-else
      variant="primary"
      size="sm"
      class="max-md:min-h-11 max-md:w-full"
      :icon-left="assistantGlyph.fork"
      :loading="pending"
      data-test="shared-chat-continue"
      @click="continueChat"
      >{{ t("assistant.shared.continue") }}</OButton
    >
  </div>
</template>

<script lang="ts">
import type { SharedChat } from "@/services/ai_chat_share";

import type { PollResult } from "./usePollShared";

export interface SharedChatContinueProps {
  token: string;
  org: string;
  chat: SharedChat;
  userOrgKey: string;
  /** Re-reads the share with what the page holds, so a revoked link stops before a fork. */
  reread: () => Promise<PollResult>;
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRouter } from "vue-router";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { statusOfError } from "@/components/ai-assistant/share/chatShare";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ForkResult } from "@/services/ai_chat_share";
import { forkSharedChatMutation, renameForkMutation } from "@/services/ai_chat_share.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

import { forksOf, hashShareToken, keepForkSeed, rememberFork } from "./forkMemory";

const props = defineProps<SharedChatContinueProps>();

const { t } = useI18nTyped();
const router = useRouter();

const pending = ref(false);
const unavailable = ref(false);
const version = ref(0);
const tokenHash = ref("");

const forkMutation = useMutation(() => forkSharedChatMutation(props.org));
const renameMutation = useMutation(() => renameForkMutation(props.org));

const forks = computed(() => {
  void version.value;
  return forksOf(props.userOrgKey, tokenHash.value);
});
const latest = computed(() => forks.value[forks.value.length - 1] ?? null);

watch(
  () => props.token,
  async (token) => {
    tokenHash.value = "";
    const hash = await hashShareToken(token);
    if (token === props.token) tokenHash.value = hash;
  },
  { immediate: true },
);

async function continueChat(): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  try {
    const read = await props.reread();
    if (statusOfError(read.error) === 404) return markUnavailable();
    let result: ForkResult;
    try {
      result = await forkMutation.mutateAsync(props.token);
    } catch (err) {
      if (statusOfError(err) === 404) return markUnavailable();
      return failed();
    }
    await adopt(result, read.data ?? props.chat);
  } finally {
    pending.value = false;
  }
}

async function adopt(result: ForkResult, chat: SharedChat): Promise<void> {
  const source = raw(chat.title) || t("assistant.thread.newChatTitle");
  const n = forks.value.length + 1;
  const title =
    n > 1
      ? t("assistant.fork.titleN", { title: source, n })
      : t("assistant.fork.title", { title: source });
  keepForkSeed(result.session_id, {
    token: props.token,
    title: String(source),
    ownerName: chat.owner_name ?? "",
    asOf: chat.shared_at / 1000,
    turns: result.seed?.turns ?? chat.turns ?? [],
    ...(chat.redact_tools && { redacted: true }),
    ...(chat.hidden && { hidden: chat.hidden }),
  });
  rememberFork(props.userOrgKey, {
    tokenHash: tokenHash.value || (await hashShareToken(props.token)),
    sessionId: result.session_id,
    at: Date.now(),
  });
  version.value += 1;
  // A failed rename keeps the server's title; the fork itself already exists.
  await renameMutation
    .mutateAsync({ sessionId: result.session_id, title: String(title) })
    .catch(() => undefined);
  trackAssistant("ai_fork", { result: "ok" });
  toast({ variant: "success", message: t("assistant.fork.toast") });
  await router.push({
    name: "assistant",
    params: { chatId: result.session_id },
    query: { org_identifier: props.org },
  });
}

function openCopy(): void {
  const entry = latest.value;
  if (entry)
    void router.push({
      name: "assistant",
      params: { chatId: entry.sessionId },
      query: { org_identifier: props.org },
    });
}

function markUnavailable(): void {
  unavailable.value = true;
  trackAssistant("ai_fork", { result: "unavailable" });
}

function failed(): void {
  trackAssistant("ai_fork", { result: "failed" });
  toast({
    variant: "error",
    message: t("assistant.fork.failed"),
    action: { label: t("common.retry"), handler: () => void continueChat() },
  });
}
</script>
