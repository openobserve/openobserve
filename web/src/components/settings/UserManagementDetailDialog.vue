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
  <ODialog
    :open="open"
    :title="t('settings.userManagementPage.detailsTitle')"
    size="md"
    data-test="user-management-detail-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="user" class="flex flex-col gap-4">
      <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt class="text-text-secondary">{{ t("settings.userManagementPage.userId") }}</dt>
        <dd class="text-text-body font-mono break-all" data-test="user-management-detail-id">
          {{ raw(user.id) }}
        </dd>
        <dt class="text-text-secondary">{{ t("settings.userManagementPage.email") }}</dt>
        <dd class="text-text-body break-all" data-test="user-management-detail-email">
          {{ raw(user.email) }}
        </dd>
        <dt class="text-text-secondary">{{ t("common.name") }}</dt>
        <dd
          :class="name ? 'text-text-body' : 'text-text-muted'"
          data-test="user-management-detail-name"
        >
          {{ raw(name || "—") }}
        </dd>
        <dt class="text-text-secondary">{{ t("common.type") }}</dt>
        <dd data-test="user-management-detail-type">
          <OTag type="authType" :value="user.is_external ? 'sso' : 'native'" />
        </dd>
        <dt class="text-text-secondary">{{ t("settings.userManagementPage.blockState") }}</dt>
        <dd data-test="user-management-detail-block-state">
          <UserBlockStateBadge :state="blockState ?? 'unknown'" :sso-only="!user.is_external" />
        </dd>
      </dl>
      <OTable
        :data="user.orgs"
        :columns="orgColumns"
        row-key="org_id"
        pagination="none"
        sorting="none"
        :fill-height="false"
        :show-global-filter="false"
        data-test="user-management-detail-orgs"
      >
        <template #cell-role="{ row }">
          <OTag type="userRole" :value="row.role" />
        </template>
        <template #empty>
          <OEmptyState
            size="inline"
            icon="group"
            :title="t('settings.userManagementPage.noOrganizations')"
          />
        </template>
      </OTable>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { ListedMembership, ListedUser } from "@/ts/interfaces";
import type { ShownBlockState } from "@/utils/domainRestrictions";
import UserBlockStateBadge from "./UserBlockStateBadge.vue";

const props = defineProps<{
  open: boolean;
  user: ListedUser | null;
  blockState?: ShownBlockState;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();

const name = computed(() =>
  [props.user?.first_name, props.user?.last_name].filter(Boolean).join(" "),
);

const orgColumns: OTableColumnDef<ListedMembership>[] = [
  {
    id: "org_id",
    header: t("settings.userManagementPage.orgId"),
    accessorKey: "org_id",
    size: COL.name,
    meta: { align: "left" },
  },
  {
    id: "org_name",
    header: t("settings.userManagementPage.orgName"),
    accessorKey: "org_name",
    size: COL.name,
    meta: { align: "left", isName: true, flex: true },
  },
  {
    id: "role",
    header: t("settings.userManagementPage.role"),
    accessorKey: "role",
    size: COL.role,
    meta: { align: "left" },
  },
];
</script>
