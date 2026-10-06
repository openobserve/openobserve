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

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  forkSharedChatMutation,
  publicSharedChatQuery,
  sharedChatQuery,
} from "@/services/ai_chat_share.queries";
import { messagesFromTurns } from "@/components/O2AIChat.history";
import {
  formatMicros,
  serverMessageOf,
  statusOfError,
} from "@/components/ai-assistant/share/chatShare";
import { useChatHistory } from "@/composables/useChatHistory";
import useAiChat from "@/composables/useAiChat";
import O2AIChatTranscript from "@/components/ai-assistant/chat/O2AIChatTranscript.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = defineProps<{
  token: string;
  /** Unauthenticated route: reads the public endpoint and offers no fork. */
  isPublic?: boolean;
}>();

const store = useStore();
const { t } = useI18nTyped();
const orgId = useOrgId();

const chatQuery = useQuery(() =>
  props.isPublic
    ? Object.assign(publicSharedChatQuery(props.token), { enabled: !!props.token })
    : Object.assign(sharedChatQuery(orgId.value, props.token), {
        enabled: !!props.token && !!orgId.value,
      }),
);

const chat = computed(() => chatQuery.data.value);
const loading = computed(() => !chat.value && !chatQuery.error.value);
const fetching = chatQuery.isFetching;
// Every unavailable share answers 404 with the same body, so all of them read the same here.
const notFound = computed(() => statusOfError(chatQuery.error.value) === 404);
const failed = computed(() => !!chatQuery.error.value && !notFound.value);
const messages = computed(() => messagesFromTurns(chat.value?.turns ?? [], t));
const title = computed(() =>
  chat.value ? raw(chat.value.title) || t("aiChatShare.untitled") : t("routeTitles.sharedChat"),
);
const reload = () => chatQuery.refetch();

const forkMutation = useMutation(() => forkSharedChatMutation(orgId.value));
const forking = computed(() => forkMutation.isPending.value);
const { adoptServerChat } = useChatHistory(
  () => store.state.userInfo?.email ?? "",
  () => store.state.selectedOrganization?.identifier ?? "",
  t,
  useAiChat().chatHistoryServer(),
);

const fork = async () => {
  try {
    const result = await forkMutation.mutateAsync(props.token);
    const chatId = await adoptServerChat(result.session_id, result.title);
    store.dispatch("setCurrentChatTimestamp", chatId);
    store.dispatch("setIsAiChatEnabled", true);
    store.dispatch("setChatUpdated", true);
    toast({ variant: "success", message: t("aiChatShare.forked") });
  } catch (error) {
    toast({
      variant: "error",
      message: raw(serverMessageOf(error)) || t("aiChatShare.forkFailed"),
    });
  }
};
</script>

<template>
  <div
    class="flex min-h-0 flex-col"
    :class="isPublic ? 'bg-surface-base h-screen' : 'h-full'"
    data-test="shared-chat-view"
  >
    <OPageLayout :title="title" icon="share" scroll pad-y title-data-test="shared-chat-view-title">
      <template v-if="chat" #title-trail>
        <OBadge
          size="sm"
          :variant="chat.mode === 'live' ? 'success-soft' : 'primary-soft'"
          data-test="shared-chat-view-mode"
        >
          {{ chat.mode === "live" ? t("aiChatShare.modeLive") : t("aiChatShare.modeSnapshot") }}
        </OBadge>
      </template>
      <template v-if="chat" #subtitle>
        <span class="text-text-secondary text-xs" data-test="shared-chat-view-shared-by">
          {{ t("aiChatShare.sharedBy", { name: chat.owner_name }) }}
        </span>
        <span class="text-text-secondary ms-2 text-xs">
          {{ t("aiChatShare.sharedOn", { time: formatMicros(chat.shared_at) }) }}
        </span>
      </template>
      <template v-if="chat" #actions>
        <OButton
          variant="ghost"
          size="icon-sm"
          :loading="fetching"
          data-test="shared-chat-view-refresh"
          @click="reload"
        >
          <OIcon name="refresh" size="sm" />
          <OTooltip :content="t('common.refresh')" />
        </OButton>
        <OButton
          v-if="!isPublic"
          variant="primary"
          size="sm-action"
          :loading="forking"
          data-test="shared-chat-view-fork"
          @click="fork"
        >
          <template #icon-left><OIcon name="fork-right" size="sm" /></template>
          {{ t("aiChatShare.forkIntoMyChats") }}
        </OButton>
      </template>

      <div class="mx-auto flex w-full max-w-225 flex-col">
        <div v-if="loading" class="flex justify-center py-10" data-test="shared-chat-view-loading">
          <OSpinner size="md" />
        </div>
        <OEmptyState
          v-else-if="notFound"
          size="hero"
          icon="link-off"
          :title="t('aiChatShare.notFoundTitle')"
          :description="t('aiChatShare.notFoundDescription')"
          data-test="shared-chat-view-not-found"
        />
        <OEmptyState
          v-else-if="failed"
          size="hero"
          icon="error"
          :title="t('aiChatShare.loadErrorTitle')"
          :action-label="t('common.retry')"
          data-test="shared-chat-view-error"
          @action="reload"
        />
        <OEmptyState
          v-else-if="messages.length === 0"
          size="block"
          icon="chat"
          :title="t('aiChatShare.emptyChat')"
          data-test="shared-chat-view-empty"
        />
        <O2AIChatTranscript v-else :messages="messages" />
      </div>
    </OPageLayout>
  </div>
</template>
