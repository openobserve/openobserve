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
import { ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { ShareView } from "@/services/ai_chat_share";
import { formatMicros } from "./chatShare";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  share: ShareView;
  /** Show the chat title, for lists that span several chats. */
  showTitle?: boolean;
  /** Show who created the share, for the org-wide admin list. */
  showOwner?: boolean;
  /** Only the creator may change a share; others (an org admin) may still copy or revoke it. */
  readOnlySettings?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: "copy"): void;
  (e: "refresh-snapshot"): void;
  (e: "switch-mode"): void;
  (e: "toggle-redaction"): void;
  (e: "revoke"): void;
}>();

const { t } = useI18nTyped();

const confirmingRevoke = ref(false);

watch(
  () => props.share.id,
  () => {
    confirmingRevoke.value = false;
  },
);

const confirmRevoke = () => {
  confirmingRevoke.value = false;
  emit("revoke");
};
</script>

<template>
  <div
    class="border-border-default flex items-center gap-3 border-b py-2 last:border-b-0 max-md:flex-wrap"
    :data-test="`ai-chat-share-row-${share.id}`"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div
        v-if="showTitle"
        class="text-text-body truncate text-sm font-medium"
        data-test="ai-chat-share-row-title"
      >
        {{ raw(share.title) || t("aiChatShare.untitled") }}
      </div>
      <div
        v-if="showOwner && (share.owner_name || share.created_by)"
        class="text-text-secondary truncate text-xs"
        data-test="ai-chat-share-row-owner"
      >
        {{ t("aiChatShare.sharedBy", { name: share.owner_name || share.created_by || "" }) }}
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <OBadge
          size="xs"
          :variant="share.visibility === 'public' ? 'warning-soft' : 'default-soft'"
          :icon="share.visibility === 'public' ? 'public' : 'corporate-fare'"
          data-test="ai-chat-share-row-visibility"
        >
          {{
            share.visibility === "public"
              ? t("aiChatShare.visibilityPublic")
              : t("aiChatShare.visibilityOrg")
          }}
        </OBadge>
        <OBadge
          size="xs"
          :variant="share.mode === 'live' ? 'success-soft' : 'primary-soft'"
          data-test="ai-chat-share-row-mode"
        >
          {{ share.mode === "live" ? t("aiChatShare.modeLive") : t("aiChatShare.modeSnapshot") }}
        </OBadge>
        <OBadge
          v-if="share.redact_tools"
          size="xs"
          variant="default-soft"
          icon="visibility-off"
          data-test="ai-chat-share-row-redacted"
        >
          {{ t("aiChatShare.toolsRedactedBadge") }}
        </OBadge>
        <span class="text-text-secondary text-xs">
          {{
            share.expires_at
              ? t("aiChatShare.expiresAt", { time: formatMicros(share.expires_at) })
              : t("aiChatShare.neverExpires")
          }}
        </span>
        <span class="text-text-secondary text-xs">
          {{ t("aiChatShare.views", { count: share.access_count }, share.access_count) }}
        </span>
      </div>
    </div>
    <div
      v-if="confirmingRevoke"
      class="flex shrink-0 items-center gap-2"
      data-test="ai-chat-share-row-revoke-confirm"
    >
      <span class="text-text-body text-xs">{{ t("aiChatShare.revokeConfirm") }}</span>
      <OButton
        variant="outline"
        size="sm"
        data-test="ai-chat-share-row-revoke-cancel"
        @click="confirmingRevoke = false"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="destructive"
        size="sm"
        :disabled="busy"
        data-test="ai-chat-share-row-revoke-confirm-btn"
        @click="confirmRevoke"
      >
        {{ t("aiChatShare.revoke") }}
      </OButton>
    </div>
    <div v-else class="flex shrink-0 items-center gap-0.5">
      <OButton
        variant="ghost"
        size="icon-sm"
        data-test="ai-chat-share-row-copy"
        @click="emit('copy')"
      >
        <OIcon name="content-copy" size="sm" />
        <OTooltip :content="t('aiChatShare.copyLink')" />
      </OButton>
      <template v-if="!readOnlySettings">
        <OButton
          v-if="share.mode === 'snapshot'"
          variant="ghost"
          size="icon-sm"
          :disabled="busy"
          data-test="ai-chat-share-row-refresh"
          @click="emit('refresh-snapshot')"
        >
          <OIcon name="refresh" size="sm" />
          <OTooltip :content="t('aiChatShare.refreshSnapshot')" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-sm"
          :disabled="busy"
          data-test="ai-chat-share-row-switch-mode"
          @click="emit('switch-mode')"
        >
          <OIcon :name="share.mode === 'live' ? 'photo-camera' : 'sync'" size="sm" />
          <OTooltip
            :content="
              share.mode === 'live'
                ? t('aiChatShare.switchToSnapshot')
                : t('aiChatShare.switchToLive')
            "
          />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-sm"
          :disabled="busy"
          data-test="ai-chat-share-row-toggle-redaction"
          @click="emit('toggle-redaction')"
        >
          <OIcon :name="share.redact_tools ? 'visibility' : 'visibility-off'" size="sm" />
          <OTooltip
            :content="share.redact_tools ? t('aiChatShare.showTools') : t('aiChatShare.hideTools')"
          />
        </OButton>
      </template>
      <OButton
        variant="ghost-destructive"
        size="icon-sm"
        :disabled="busy"
        data-test="ai-chat-share-row-revoke"
        @click="confirmingRevoke = true"
      >
        <OIcon name="link-off" size="sm" />
        <OTooltip :content="t('aiChatShare.revoke')" />
      </OButton>
    </div>
  </div>
</template>
