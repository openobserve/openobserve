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
import { computed, toRef } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import type { ShareMode, ShareVisibility } from "@/services/ai_chat_share";
import { useOrgId } from "@/composables/query/useOrgId";
import { isPublicChatEnabled, publicMaxExpirySecs } from "./chatShare";
import { useChatShareDialog } from "./useChatShareDialog";
import AiChatShareRow from "./AiChatShareRow.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

const props = defineProps<{
  sessionId: string | null | undefined;
  chatTitle?: string;
  /** The server could not read this chat's history, so viewers of a link will not see it either. */
  historyUnavailable?: boolean;
}>();

const open = defineModel<boolean>("open", { required: true });

const store = useStore();
const { t } = useI18nTyped();
const orgId = useOrgId();
const publicEnabled = computed(() => isPublicChatEnabled(store.state.zoConfig));
const maxPublicSecs = computed(() => publicMaxExpirySecs(store.state.zoConfig));
const maxPublicDays = computed(() => Math.round(maxPublicSecs.value / 86400));

const {
  form,
  createdShare,
  createdLink,
  pendingShareId,
  shares,
  sharesLoading,
  sharesError,
  creating,
  visibilityOptions,
  expiryPresets,
  setVisibility: applyVisibility,
  resetForm,
  create,
  refreshSnapshot,
  switchMode,
  toggleRedaction,
  revoke,
  copyLink,
} = useChatShareDialog({
  orgId,
  sessionId: toRef(props, "sessionId"),
  open,
  publicEnabled,
  maxPublicSecs,
  t,
});

const expiryOptions = computed(() =>
  expiryPresets.value.map((preset) => ({ label: t(preset.labelKey), value: preset.value })),
);

const setMode = (value: unknown) => {
  if (value === "snapshot" || value === "live") form.mode = value as ShareMode;
};

const setVisibility = (value: unknown) => {
  if (value === "org" || value === "public") applyVisibility(value as ShareVisibility);
};

const setExpiry = (value: unknown) => {
  form.expiresInSecs = Number(value) || 0;
};

const setRedactTools = (value: unknown) => {
  form.redactTools = value === true;
};
</script>

<template>
  <ODialog
    v-model:open="open"
    size="md"
    :title="t('aiChatShare.dialogTitle')"
    :sub-title="chatTitle ? raw(chatTitle) : undefined"
    :secondary-button-label="t('common.close')"
    data-test="ai-chat-share-dialog"
    @click:secondary="open = false"
  >
    <div class="flex flex-col gap-5">
      <OBanner
        v-if="historyUnavailable"
        variant="warning"
        icon="error"
        dense
        :content="t('aiChatShare.historyUnavailableWarning')"
        data-test="ai-chat-share-dialog-history-unavailable"
      />
      <OBanner
        v-if="createdShare ? !createdShare.redact_tools : !form.redactTools"
        variant="warning"
        icon="warning"
        dense
        :content="t('aiChatShare.toolDataWarning')"
        data-test="ai-chat-share-dialog-tool-warning"
      />
      <OBanner
        v-else
        variant="info"
        icon="visibility-off"
        dense
        :content="t('aiChatShare.toolDataRedacted')"
        data-test="ai-chat-share-dialog-tool-redacted"
      />

      <div v-if="createdShare" class="flex flex-col gap-2" data-test="ai-chat-share-dialog-result">
        <div class="flex items-end gap-2">
          <OInput
            class="min-w-0 flex-1"
            :model-value="createdLink"
            :label="t('aiChatShare.copyLink')"
            readonly
            data-test="ai-chat-share-dialog-link"
          />
          <OButton
            variant="primary"
            size="sm-action"
            data-test="ai-chat-share-dialog-copy"
            @click="copyLink(createdShare)"
          >
            <template #icon-left><OIcon name="content-copy" size="sm" /></template>
            {{ t("common.copy") }}
          </OButton>
        </div>
        <div>
          <OButton
            variant="ghost"
            size="sm"
            data-test="ai-chat-share-dialog-new-link"
            @click="resetForm"
          >
            {{ t("aiChatShare.newLink") }}
          </OButton>
        </div>
      </div>

      <div v-else class="flex flex-col gap-4" data-test="ai-chat-share-dialog-form">
        <div class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-medium">{{ t("aiChatShare.mode") }}</span>
          <OToggleGroup
            :model-value="form.mode"
            type="single"
            class="self-start"
            data-test="ai-chat-share-dialog-mode"
            @update:model-value="setMode"
          >
            <OToggleGroupItem value="snapshot" size="sm" data-test="ai-chat-share-mode-snapshot">
              {{ t("aiChatShare.modeSnapshot") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="live" size="sm" data-test="ai-chat-share-mode-live">
              {{ t("aiChatShare.modeLive") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <span class="text-text-secondary text-xs">
            {{
              form.mode === "live"
                ? t("aiChatShare.modeLiveHelp")
                : t("aiChatShare.modeSnapshotHelp")
            }}
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-medium">{{
            t("aiChatShare.visibility")
          }}</span>
          <OToggleGroup
            :model-value="form.visibility"
            type="single"
            class="self-start"
            data-test="ai-chat-share-dialog-visibility"
            @update:model-value="setVisibility"
          >
            <OToggleGroupItem value="org" size="sm" data-test="ai-chat-share-visibility-org">
              {{ t("aiChatShare.visibilityOrg") }}
            </OToggleGroupItem>
            <OToggleGroupItem
              v-if="visibilityOptions.includes('public')"
              value="public"
              size="sm"
              data-test="ai-chat-share-visibility-public"
            >
              {{ t("aiChatShare.visibilityPublic") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <span class="text-text-secondary text-xs">
            {{
              form.visibility === "public"
                ? t("aiChatShare.visibilityPublicHelp")
                : t("aiChatShare.visibilityOrgHelp")
            }}
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <OSwitch
            :model-value="form.redactTools"
            :label="t('aiChatShare.redactTools')"
            size="sm"
            data-test="ai-chat-share-dialog-redact"
            @update:model-value="setRedactTools"
          />
          <span class="text-text-secondary text-xs">{{ t("aiChatShare.redactToolsHelp") }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <OSelect
            :model-value="form.expiresInSecs"
            :options="expiryOptions"
            :label="t('aiChatShare.expiry')"
            class="max-w-60"
            data-test="ai-chat-share-dialog-expiry"
            @update:model-value="setExpiry"
          />
          <span
            v-if="form.visibility === 'public'"
            class="text-text-secondary text-xs"
            data-test="ai-chat-share-dialog-public-expiry-help"
          >
            {{ t("aiChatShare.publicExpiryHelp", { days: maxPublicDays }) }}
          </span>
        </div>

        <div>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="creating"
            :disabled="!sessionId"
            data-test="ai-chat-share-dialog-create"
            @click="create"
          >
            {{ t("aiChatShare.createLink") }}
          </OButton>
        </div>
      </div>

      <div class="flex flex-col gap-1" data-test="ai-chat-share-dialog-shares">
        <span class="text-text-heading text-sm font-semibold">{{
          t("aiChatShare.existingShares")
        }}</span>
        <div v-if="sharesLoading" class="flex justify-center py-3">
          <OSpinner size="sm" />
        </div>
        <span v-else-if="sharesError" class="text-status-negative text-xs">
          {{ t("aiChatShare.loadFailed") }}
        </span>
        <span
          v-else-if="shares.length === 0"
          class="text-text-secondary text-xs"
          data-test="ai-chat-share-dialog-no-shares"
        >
          {{ t("aiChatShare.noShares") }}
        </span>
        <template v-else>
          <AiChatShareRow
            v-for="share in shares"
            :key="share.id"
            :share="share"
            :busy="pendingShareId === share.id"
            @copy="copyLink(share)"
            @refresh-snapshot="refreshSnapshot(share)"
            @switch-mode="switchMode(share)"
            @toggle-redaction="toggleRedaction(share)"
            @revoke="revoke(share)"
          />
        </template>
      </div>
    </div>
  </ODialog>
</template>
