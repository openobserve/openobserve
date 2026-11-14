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
  <div v-if="notices.length" class="flex flex-col gap-2" data-test="assistant-shared-notices">
    <OBanner
      v-for="notice in notices"
      :key="notice.kind"
      :variant="notice.kind === 'offline' ? 'warning' : 'info'"
      dense
      inline-actions
      :content="notice.text"
      data-test="assistant-shared-notice"
      :data-kind="notice.kind"
    >
      <template v-if="notice.kind === 'offline'" #actions>
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-shared-notice-retry"
          @click="emit('retry')"
          >{{ t("common.retry") }}</OButton
        >
      </template>
    </OBanner>
  </div>
</template>

<script lang="ts">
import type { SharedChat } from "@/services/ai_chat_share";

import type { PollState } from "./usePollShared";

export type SharedNoticeKind =
  "redacted" | "attachments" | "truncated" | "streamHidden" | "offline" | "rateLimited";

export interface SharedChatNoticesProps {
  chat: SharedChat;
  polling: PollState;
  /** IANA zone every time on the page renders in. */
  timezone: string;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = defineProps<SharedChatNoticesProps>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const notices = computed<{ kind: SharedNoticeKind; text: I18nText }[]>(() => {
  const chat = props.chat;
  const list: { kind: SharedNoticeKind; text: I18nText }[] = [];
  if (chat.redact_tools) list.push({ kind: "redacted", text: t("assistant.shared.redacted") });
  if (chat.hide_attachments) {
    list.push({ kind: "attachments", text: t("assistant.shared.attachmentsHidden") });
  }
  if (chat.truncated) list.push({ kind: "truncated", text: t("assistant.shared.truncated") });
  if (chat.hidden && Object.keys(chat.hidden).length) {
    list.push({ kind: "streamHidden", text: t("assistant.shared.streamHidden") });
  }
  const polling = props.polling;
  if (polling.status === "offline" && polling.loadedAt) {
    const time = formatOrgTime(polling.loadedAt, {
      timeZone: props.timezone || undefined,
      showZone: true,
    });
    list.push({ kind: "offline", text: t("assistant.shared.offline", { time }) });
  }
  if (polling.status === "rateLimited") {
    list.push({
      kind: "rateLimited",
      text: t("assistant.shared.rateLimited", { seconds: polling.retryInSecs ?? 60 }),
    });
  }
  return list;
});
</script>
