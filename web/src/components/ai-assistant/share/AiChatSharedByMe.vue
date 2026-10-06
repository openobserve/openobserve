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
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { mySharesQuery } from "@/services/ai_chat_share.queries";
import { useShareActions } from "./useChatShareDialog";
import AiChatShareRow from "./AiChatShareRow.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
const orgId = useOrgId();

const sharesQuery = useQuery(() =>
  Object.assign(mySharesQuery(orgId.value), { enabled: open.value && !!orgId.value }),
);
const shares = computed(() => sharesQuery.data.value ?? []);
const loading = computed(() => sharesQuery.isPending.value && sharesQuery.isFetching.value);
const fetching = sharesQuery.isFetching;
const failed = computed(() => !!sharesQuery.error.value);
const refreshShares = () => sharesQuery.refetch();

const { pendingShareId, refreshSnapshot, switchMode, revoke, copyLink } = useShareActions({
  orgId,
  t,
});
</script>

<template>
  <ODrawer
    v-model:open="open"
    size="md"
    :title="t('aiChatShare.sharedByMe')"
    data-test="ai-chat-shared-by-me"
  >
    <template #header-right>
      <OButton
        variant="ghost"
        size="icon-sm"
        :loading="fetching"
        data-test="ai-chat-shared-by-me-refresh"
        @click="refreshShares"
      >
        <OIcon name="refresh" size="sm" />
        <OTooltip :content="t('common.refresh')" />
      </OButton>
    </template>
    <div class="flex flex-col">
      <div v-if="loading" class="flex justify-center py-6">
        <OSpinner size="sm" />
      </div>
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
        :title="t('aiChatShare.sharedByMeEmpty')"
        data-test="ai-chat-shared-by-me-empty"
      />
      <template v-else>
        <AiChatShareRow
          v-for="share in shares"
          :key="share.id"
          :share="share"
          show-title
          :busy="pendingShareId === share.id"
          @copy="copyLink(share)"
          @refresh-snapshot="refreshSnapshot(share)"
          @switch-mode="switchMode(share)"
          @revoke="revoke(share)"
        />
      </template>
    </div>
  </ODrawer>
</template>
