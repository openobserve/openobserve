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
    :aria-busy="loading ? 'true' : undefined"
    class="flex min-w-0 flex-col md:min-h-33"
    data-test="assistant-new-chat-below"
  >
    <section
      v-if="cards.length > 0"
      :aria-labelledby="headingId"
      class="flex min-w-0 flex-col gap-2 max-md:gap-0"
      data-test="assistant-recent-chats"
      data-dd-privacy="mask"
    >
      <div class="flex min-h-7 min-w-0 items-center gap-2 ps-0.5">
        <h3 :id="headingId" class="text-text-secondary min-w-0 flex-1 text-xs font-medium">
          {{ t("assistant.welcome.launcher.recentThreads") }}
        </h3>
        <OButton
          variant="ghost-muted"
          size="chip"
          :class="['shrink-0', TOUCH_TARGET_CLASS]"
          data-test="assistant-recent-chats-all"
          @click="emit('view-all')"
        >
          {{ t("assistant.welcome.viewAll") }}
        </OButton>
      </div>
      <ul class="grid min-w-0 grid-cols-3 gap-2 max-md:grid-cols-1">
        <li v-for="(card, index) in cards" :key="card.sid" class="flex min-w-0">
          <button
            type="button"
            :class="CARD_CLASS"
            :data-test="`assistant-recent-chat-${index}`"
            :data-status="card.status ?? undefined"
            @click="emit('open-chat', card.sid)"
          >
            <span
              class="text-text-heading line-clamp-2 min-w-0 text-sm leading-5 break-words max-md:line-clamp-none max-md:flex-1 max-md:truncate"
              >{{ card.title }}</span
            >
            <span class="sr-only">, </span>
            <span
              :class="[
                'mt-auto shrink-0 text-xs leading-4 max-md:mt-0',
                card.status ? chatStatusClass(card.status, false) : '',
              ]"
              data-test="assistant-recent-chat-age"
              >{{ card.status ? chatStatusWord(card.status, null, 0, t) : card.age }}</span
            >
          </button>
        </li>
      </ul>
    </section>
    <div
      v-else-if="firstChat"
      class="flex min-w-0 justify-center"
      data-test="assistant-first-chat-starter"
    >
      <OButton
        variant="outline"
        size="sm"
        class="text-text-body! font-normal max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-first-chat-ask"
        @click="emit('ask', String(t('assistant.welcome.whatCanYouDo')))"
      >
        {{ t("assistant.welcome.whatCanYouDo") }}
      </OButton>
    </div>
    <div
      v-else-if="failed"
      class="text-text-secondary flex min-h-7 min-w-0 items-center justify-center gap-2 text-xs"
      data-test="assistant-recent-chats-error"
    >
      <span>{{ t("assistant.history.serverError") }}</span>
      <OButton
        variant="ghost-muted"
        size="chip"
        :class="['shrink-0', TOUCH_TARGET_CLASS]"
        data-test="assistant-recent-chats-retry"
        @click="history.retry()"
      >
        {{ t("common.retry") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantNewChatBelowEmits {
  (e: "ask", prompt: string): void;
  (e: "open-chat", sid: Sid): void;
  (e: "view-all"): void;
}

/** Recent chats a new chat offers, like the recents of a chat app's start page. */
export const RECENT_CARDS = 3;

// A waiting chat can sit below the latest ones, so the cards look this far down the list.
const RECENT_LOOKUP = 20;

const CARD_CLASS = [
  "rounded-surface border-border-default bg-surface-base flex h-24 w-full min-w-0 cursor-pointer flex-col gap-2 border p-3 text-start",
  "text-text-secondary hover:bg-surface-subtle focus-visible:ring-focus-ring-accent transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
  "max-md:h-11 max-md:flex-row max-md:items-center max-md:gap-3 max-md:px-3 max-md:py-0",
].join(" ");
</script>

<script setup lang="ts">
import { computed, onMounted, useId } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  chatStatusClass,
  chatStatusOf,
  chatStatusWord,
  inProgressFirst,
  isInProgress,
  type ChatStatus,
} from "@/components/ai-assistant/history/chatStatus";
import { useAssistantHistory, useAssistantStore } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import { formatRelative } from "@/utils/formatters";

const emit = defineEmits<AssistantNewChatBelowEmits>();

const { t } = useI18nTyped();
const history = useAssistantHistory();
const assistant = useAssistantStore();
const headingId = `assistant-recent-chats-${useId()}`;
const rows = history.recent(RECENT_LOOKUP);

const cards = computed(() =>
  inProgressFirst(
    rows.value.map((row) => ({
      sid: row.sid,
      title: row.title,
      status: liveStatus(chatStatusOf(row, assistant.state.sessions[row.sid]?.turn.state)),
      age: row.updatedAt ? formatRelative(row.updatedAt) : "",
    })),
    (card) => card.status,
  ).slice(0, RECENT_CARDS),
);

// Only a list read that came back empty makes a first chat; a failed read never claims there are none.
const firstChat = computed(
  () => rows.value.length === 0 && history.listState.value.status === "ready",
);
const failed = computed(
  () => rows.value.length === 0 && history.listState.value.status === "error",
);
const loading = computed(
  () => rows.value.length === 0 && ["idle", "loading"].includes(history.listState.value.status),
);

onMounted(() => history.ensureLoaded());

// A card names only a chat that answers or waits; a finished one shows its age.
function liveStatus(status: ChatStatus | null): ChatStatus | null {
  return isInProgress(status) ? status : null;
}
</script>
