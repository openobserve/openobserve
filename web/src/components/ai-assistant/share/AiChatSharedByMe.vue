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
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { allSharesQuery, mySharesQuery } from "@/services/ai_chat_share.queries";
import { statusOfError } from "./chatShare";
import { useIsOrgAdmin, useShareActions } from "./useChatShareDialog";
import AiChatShareRow from "./AiChatShareRow.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const open = defineModel<boolean>("open", { required: true });

type Scope = "mine" | "all";

const { t } = useI18nTyped();
const orgId = useOrgId();

const isAdmin = useIsOrgAdmin(orgId, open);
const scope = ref<Scope>("mine");
const showAll = computed(() => isAdmin.value && scope.value === "all");

watch(isAdmin, (admin) => {
  if (!admin) scope.value = "mine";
});

const sharesQuery = useQuery(() =>
  Object.assign(showAll.value ? allSharesQuery(orgId.value) : mySharesQuery(orgId.value), {
    enabled: open.value && !!orgId.value,
  }),
);
const shares = computed(() => sharesQuery.data.value ?? []);
const loading = computed(() => sharesQuery.isPending.value && sharesQuery.isFetching.value);
const fetching = sharesQuery.isFetching;
const forbidden = computed(() => statusOfError(sharesQuery.error.value) === 403);
const failed = computed(() => !!sharesQuery.error.value && !forbidden.value);
const refreshShares = () => sharesQuery.refetch();

const setScope = (value: unknown) => {
  if (value === "mine" || value === "all") scope.value = value;
};

const { pendingShareId, refreshSnapshot, switchMode, toggleRedaction, revoke, copyLink } =
  useShareActions({ orgId, t });
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="md"
    :title="showAll ? t('aiChatShare.allShares') : t('aiChatShare.sharedByMe')"
    data-test="ai-chat-shared-by-me"
  >
    <template #header-right>
      <OButton
        variant="ghost"
        size="icon-sm"
        :loading="fetching"
        data-test="ai-chat-shared-by-me-refresh"
        :aria-label="t('common.refresh')"
        @click="refreshShares"
      >
        <OIcon name="refresh" size="sm" />
        <OTooltip :content="t('common.refresh')" />
      </OButton>
    </template>
    <div class="flex flex-col">
      <OToggleGroup
        v-if="isAdmin"
        :model-value="scope"
        type="single"
        class="mb-3 self-start"
        data-test="ai-chat-shared-by-me-scope"
        @update:model-value="setScope"
      >
        <OToggleGroupItem value="mine" size="sm" data-test="ai-chat-shared-by-me-scope-mine">
          {{ t("aiChatShare.scopeMine") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="all" size="sm" data-test="ai-chat-shared-by-me-scope-all">
          {{ t("aiChatShare.scopeAll") }}
        </OToggleGroupItem>
      </OToggleGroup>
      <div v-if="loading" class="flex justify-center py-6">
        <OSpinner size="sm" />
      </div>
      <OEmptyState
        v-else-if="forbidden"
        size="inline"
        icon="lock"
        :title="t('aiChatShare.allSharesForbidden')"
        data-test="ai-chat-shared-by-me-forbidden"
      />
      <OEmptyState
        v-else-if="failed"
        size="inline"
        icon="error"
        :title="t('aiChatShare.loadFailed')"
        :action-label="t('common.retry')"
        data-test="ai-chat-shared-by-me-error"
        @action="refreshShares"
      />
      <OEmptyState
        v-else-if="shares.length === 0"
        size="inline"
        icon="share"
        :title="showAll ? t('aiChatShare.allSharesEmpty') : t('aiChatShare.sharedByMeEmpty')"
        data-test="ai-chat-shared-by-me-empty"
      />
      <template v-else>
        <AiChatShareRow
          v-for="share in shares"
          :key="share.id"
          :share="share"
          show-title
          :show-owner="showAll"
          :read-only-settings="showAll"
          :busy="pendingShareId === share.id"
          @copy="copyLink(share)"
          @refresh-snapshot="refreshSnapshot(share)"
          @switch-mode="switchMode(share)"
          @toggle-redaction="toggleRedaction(share)"
          @revoke="revoke(share)"
        />
      </template>
    </div>
  </ODrawer>
</template>
