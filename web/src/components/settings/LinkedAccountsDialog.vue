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
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { deleteLinkMutation, slackMyLinksQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackMyLink } from "@/types/slack";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const store = useStore();
const { isDark } = useTheme();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const links = useQuery(() =>
  Object.assign(slackMyLinksQuery(org.value), { enabled: props.open && !!org.value }),
);
const unlink = useMutation(() => deleteLinkMutation(org.value));
const unlinkingId = ref<string | null>(null);

const rows = computed<SlackMyLink[]>(() => links.data.value?.links ?? []);
const slackLogo = computed(() =>
  getImageURL(isDark.value ? "images/common/slack_dark.svg" : "images/common/slack.svg"),
);

const detail = (link: SlackMyLink) =>
  t("slackApp.linkedAccounts.detail", {
    user: raw(link.slack_display_name),
    org: raw(link.default_org_id),
    method: t(`slackApp.people.method.${link.link_method}`),
  });

const remove = (link: SlackMyLink): void => {
  unlinkingId.value = link.id;
  unlink.mutate(link.id, {
    onSettled: () => {
      unlinkingId.value = null;
    },
  });
};
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('slackApp.linkedAccounts.title')"
    :sub-title="t('slackApp.linkedAccounts.description')"
    :secondary-button-label="t('common.close')"
    data-test="linked-accounts-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <OSkeleton v-if="links.isPending.value" class="rounded-surface h-18 w-full" />
      <OEmptyState
        v-else-if="links.isError.value"
        size="compact"
        variant="error"
        illustration="broken-panel"
        :title="t('slackApp.linkedAccounts.loadFailed')"
        :action-label="t('common.retry')"
        :backdrop="false"
        data-test="linked-accounts-error"
        @action="links.refetch()"
      />
      <OEmptyState
        v-else-if="!rows.length"
        size="compact"
        illustration="connect"
        :title="t('slackApp.linkedAccounts.emptyTitle')"
        :description="t('slackApp.linkedAccounts.emptyDetail')"
        :backdrop="false"
        data-test="linked-accounts-empty"
      />
      <template v-else>
        <OCard
          v-for="link in rows"
          :key="link.id"
          variant="outlined"
          class="flex-row flex-wrap items-center gap-3 p-3"
          :data-test="`linked-accounts-item-${link.id}`"
        >
          <img :src="slackLogo" alt="" class="size-9 shrink-0" />
          <div class="flex min-w-36 flex-1 flex-col gap-0.5">
            <span class="text-text-heading text-sm font-semibold">
              {{ t("slackApp.linkedAccounts.workspace", { team: raw(link.team_name) }) }}
            </span>
            <span class="text-text-secondary text-xs">{{ detail(link) }}</span>
            <span class="text-text-secondary flex flex-wrap gap-x-3 text-xs">
              <span>
                {{ t("slackApp.linkedAccounts.linked") }}
                <OTimeCell :value="link.created_at" unit="us" mode="date" />
              </span>
              <span>
                {{ t("slackApp.linkedAccounts.lastUsed") }}
                <OTimeCell :value="link.last_used_at" unit="us" />
              </span>
            </span>
          </div>
          <OButton
            variant="outline-destructive"
            size="sm"
            :loading="unlinkingId === link.id"
            :aria-label="t('slackApp.linkedAccounts.unlinkAria', { team: raw(link.team_name) })"
            :data-test="`linked-accounts-unlink-${link.id}`"
            @click="remove(link)"
          >
            {{ t("slackApp.linkedAccounts.unlink") }}
          </OButton>
        </OCard>
      </template>
      <p v-if="rows.length" class="text-text-secondary text-xs" data-test="linked-accounts-note">
        {{ t("slackApp.linkedAccounts.note") }}
      </p>
    </div>
  </ODialog>
</template>
