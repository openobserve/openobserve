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
import { useInfiniteQuery, useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { deleteLinkMutation, slackLinksQuery } from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackLinkRow } from "@/types/slack";

const props = defineProps<{
  open: boolean;
  installationId: string;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const links = useInfiniteQuery(() =>
  Object.assign(slackLinksQuery(org.value, props.installationId), {
    enabled: props.open && !!org.value,
  }),
);
const unlink = useMutation(() => deleteLinkMutation(org.value));

const rows = computed<SlackLinkRow[]>(
  () => links.data.value?.pages.flatMap((page) => page.links) ?? [],
);
// ConfirmDialog closes before it confirms, so the target outlives the open flag.
const pending = ref<SlackLinkRow | null>(null);
const confirmOpen = ref(false);
const askUnlink = (row: SlackLinkRow): void => {
  pending.value = row;
  confirmOpen.value = true;
};

const columns = computed<OTableColumnDef<SlackLinkRow>[]>(() => [
  {
    id: "user_email",
    header: t("slackApp.people.columnUser"),
    accessorKey: "user_email",
    size: COL.email,
    meta: { flex: true },
  },
  {
    id: "external_user_id",
    header: t("slackApp.people.columnSlackUser"),
    accessorKey: "external_user_id",
    size: 140,
  },
  { id: "link_method", header: t("slackApp.people.columnMethod"), size: 160 },
  { id: "created_at", header: t("slackApp.people.columnLinked"), size: 120 },
  { id: "last_used_at", header: t("slackApp.people.columnLastUsed"), size: 120 },
  { id: "actions", header: raw(""), size: 100, isAction: true },
]);

const confirmUnlink = (): void => {
  const target = pending.value;
  if (target) unlink.mutate(target.id);
};
</script>

<template>
  <ODrawer
    :open="open"
    size="xl"
    :title="t('slackApp.people.title')"
    :sub-title="t('slackApp.people.description')"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex h-full min-h-0 flex-col gap-3">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="id"
        pagination="none"
        :show-global-filter="false"
        :loading="links.isPending.value"
        dense
        class="min-h-0 flex-1"
      >
        <template #cell-link_method="{ row }">
          {{ t(`slackApp.people.method.${row.link_method}`) }}
        </template>
        <template #cell-created_at="{ row }">
          <OTimeCell :value="row.created_at" />
        </template>
        <template #cell-last_used_at="{ row }">
          <OTimeCell :value="row.last_used_at" />
        </template>
        <template #cell-actions="{ row }">
          <OButton
            variant="ghost-destructive"
            size="sm"
            :data-test="`slack-people-unlink-${row.id}`"
            @click="askUnlink(row)"
          >
            {{ t("slackApp.people.unlink") }}
          </OButton>
        </template>
        <template #empty>
          <OEmptyState
            size="compact"
            illustration="users"
            :title="t('slackApp.people.empty')"
            :backdrop="false"
          />
        </template>
      </OTable>
      <OButton
        v-if="links.hasNextPage.value"
        variant="outline"
        size="sm-action"
        class="w-fit self-center"
        :loading="links.isFetchingNextPage.value"
        data-test="slack-people-more"
        @click="links.fetchNextPage()"
      >
        {{ t("slackApp.people.loadMore") }}
      </OButton>
    </div>
    <ConfirmDialog
      v-model="confirmOpen"
      :title="t('slackApp.people.unlinkTitle', { user: pending?.user_email ?? '' })"
      :message="t('slackApp.people.unlinkMessage', { user: pending?.user_email ?? '' })"
      :ok-label="t('slackApp.people.unlink')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="confirmUnlink"
    />
  </ODrawer>
</template>
