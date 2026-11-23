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
  <div class="flex h-full flex-col p-0">
    <OPageLayout
      :title="t('settings.userManagement')"
      icon="manage-accounts"
      :subtitle="t('settings.userManagementPage.subtitle')"
      bleed
    >
      <div class="bg-card-glass-bg mt-2.5 min-h-0 flex-1 overflow-hidden">
        <OTable
          data-test="user-management-table"
          :data="rows"
          :columns="columns"
          row-key="id"
          pagination="server"
          :current-page="page"
          :page-size="pageSize"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total-count="total"
          sorting="none"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="user-management-list"
          :loading="loading"
          :forbidden="forbidden"
          :error="loadError"
          :row-actions="rowActions"
          row-actions-more-data-test="user-management-row-more-actions"
          @pagination-change="onPageChange"
        >
          <template #toolbar>
            <div class="w-96 shrink-0 max-md:w-40">
              <OSelect
                v-model="orgFilter"
                :options="orgOptions"
                searchable
                clearable
                :loading="orgsLoading"
                :placeholder="t('settings.userManagementPage.allOrganizations')"
                :aria-label="t('settings.userManagementPage.filterByOrganization')"
                data-test="user-management-org-select"
              />
            </div>
            <OSearchInput
              v-model="search"
              :debounce="SEARCH_DEBOUNCE_MS"
              class="min-w-0 flex-1 max-md:min-w-40"
              :placeholder="t('settings.userManagementPage.searchPlaceholder')"
              data-test="user-management-search-input"
            />
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              :loading="fetching"
              shortcut="userManagementRefresh"
              data-test="user-management-refresh-btn"
              @click="refresh"
            />
          </template>
          <template #empty>
            <OEmptyState
              :kind="filtered ? 'filtered' : 'first-run'"
              :title="
                filtered
                  ? t('emptyState.filtered.title', { noun: t('emptyState.nouns.users') })
                  : t('emptyState.noUsers.title')
              "
              :text="
                filtered
                  ? t('emptyState.filtered.description', { noun: t('emptyState.nouns.users') })
                  : t('emptyState.noUsers.description')
              "
              :icon="filtered ? undefined : 'group'"
              data-test="user-management-empty"
              @action="filtered ? clearFilters() : undefined"
            />
          </template>
          <template #error="{ message }">
            <OEmptyState
              kind="error"
              :title="t('emptyState.loadError.title')"
              :text="raw(message)"
              data-test="user-management-error"
              @action="refresh"
            />
          </template>
          <template #cell-type="{ row }">
            <div class="flex items-center gap-1">
              <OTag type="authType" :value="row.is_external ? 'sso' : 'native'" />
              <OTag
                v-if="row.isMachine"
                type="userRole"
                value="service_account"
                data-test="user-management-service-account"
              />
            </div>
          </template>
          <template #cell-orgs="{ row }">
            <div class="flex min-w-0 items-center gap-2">
              <OTag tone="neutral" size="sm" data-test="user-management-org-count">
                {{
                  t(
                    "settings.userManagementPage.orgCount",
                    { count: row.orgs.length },
                    row.orgs.length,
                  )
                }}
              </OTag>
              <OTruncatedText class="text-text-secondary min-w-0 text-xs">{{
                raw(row.orgNames)
              }}</OTruncatedText>
            </div>
          </template>
          <template #cell-blocked="{ row }">
            <UserBlockStateBadge :state="row.blockState" :sso-only="!row.is_external" />
          </template>
        </OTable>
      </div>
    </OPageLayout>
    <UserManagementDetailDialog
      v-model:open="detailOpen"
      :user="detailUser"
      :block-state="detailUser ? blockStateFor(detailUser) : undefined"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import type {
  OTableColumnDef,
  OTablePaginationParams,
  OTableRowAction,
} from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { forbiddenState } from "@/utils/featureGate";
import { blockStateOf, type ShownBlockState } from "@/utils/domainRestrictions";
import { allUsersQuery } from "@/services/users.queries";
import { adminOrgsQuery } from "@/services/organizations.queries";
import {
  domainRestrictionsQuery,
  setUserBlockedMutation,
} from "@/services/domainManagement.queries";
import type { ListedUser } from "@/ts/interfaces";
import analytics from "@/services/product_analytics";
import UserBlockStateBadge from "./UserBlockStateBadge.vue";
import UserManagementDetailDialog from "./UserManagementDetailDialog.vue";

type RejectedResponse = { response?: { status?: number; data?: { message?: string } } };

interface UserRow extends ListedUser {
  name: string;
  orgNames: string;
  blockState: ShownBlockState;
  /** Holds only service-account roles: a token identity, not a person. */
  isMachine: boolean;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const SEARCH_DEBOUNCE_MS = 300;
const MACHINE_ROLES = new Set(["service_account", "sre_agent"]);

const responseOf = (error: unknown) => (error as RejectedResponse | undefined)?.response;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { confirm } = useConfirmDialog();

const metaOrg = computed<string>(() => store.state.zoConfig.meta_org ?? "");
const inMetaOrg = computed(
  () => !!metaOrg.value && store.state.selectedOrganization?.identifier === metaOrg.value,
);

const search = ref("");
const orgFilter = ref<string | null>(null);
const page = ref(1);
const pageSize = ref(PAGE_SIZE_OPTIONS[0]);
watch([search, orgFilter], () => (page.value = 1));

const usersList = useQuery(() => ({
  ...allUsersQuery(metaOrg.value, {
    search: search.value.trim() || undefined,
    org: orgFilter.value || undefined,
    page: page.value,
    page_size: pageSize.value,
  }),
  enabled: inMetaOrg.value,
  placeholderData: keepPreviousData,
}));
const domainConfig = useQuery(() =>
  Object.assign(domainRestrictionsQuery(metaOrg.value), { enabled: inMetaOrg.value }),
);
const orgs = useQuery(() =>
  Object.assign(adminOrgsQuery(metaOrg.value), { enabled: inMetaOrg.value }),
);
const setBlocked = useMutation(() => setUserBlockedMutation(metaOrg.value));

const loading = computed(() => inMetaOrg.value && usersList.isPending.value);
const fetching = usersList.isFetching;
const total = computed(() => usersList.data.value?.total ?? 0);
const forbidden = computed(() =>
  usersList.error.value ? forbiddenState(usersList.error.value) : false,
);
const loadError = computed(() => {
  const error = usersList.error.value;
  if (!error || forbidden.value) return null;
  return responseOf(error)?.data?.message || error.message || t("common.error");
});
const orgsLoading = orgs.isPending;
const orgOptions = computed(() =>
  (orgs.data.value ?? []).map((org) => ({
    // Most orgs share the name "default", so the label carries the id for the trigger and the search.
    label: t("settings.userManagementPage.orgOption", { name: org.name, id: org.identifier }),
    listLabel: raw(org.name),
    value: org.identifier,
    suffix: raw(org.identifier),
  })),
);
const filtered = computed(() => !!search.value.trim() || !!orgFilter.value);

const blockStateFor = (user: ListedUser): ShownBlockState => {
  if (domainConfig.isError.value) return "unknown";
  const config = domainConfig.data.value;
  return config ? blockStateOf(user.email, config) : "unknown";
};

const rows = computed<UserRow[]>(() =>
  (usersList.data.value?.data ?? []).map((user) => ({
    ...user,
    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    orgNames: user.orgs.map((org) => org.org_name || org.org_id).join(", "),
    blockState: blockStateFor(user),
    isMachine: user.orgs.length > 0 && user.orgs.every((org) => MACHINE_ROLES.has(org.role)),
  })),
);

const columns: OTableColumnDef<UserRow>[] = [
  {
    id: "email",
    header: t("settings.userManagementPage.email"),
    accessorKey: "email",
    resizable: true,
    size: COL.email,
    minSize: 200,
    meta: { align: "left", isName: true, flex: true },
  },
  {
    id: "name",
    header: t("common.name"),
    accessorKey: "name",
    resizable: true,
    hideable: true,
    size: COL.name,
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("common.type"),
    accessorKey: "is_external",
    resizable: true,
    hideable: true,
    size: COL.authType,
    meta: { align: "left" },
  },
  {
    id: "orgs",
    header: t("settings.userManagementPage.organizations"),
    accessorKey: "orgNames",
    resizable: true,
    hideable: true,
    size: 280,
    meta: { align: "left" },
  },
  {
    id: "blocked",
    header: t("settings.userManagementPage.blockState"),
    accessorKey: "blockState",
    resizable: true,
    hideable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
  },
];

const detailOpen = ref(false);
const detailUser = ref<UserRow | null>(null);
const pendingEmail = ref<string | null>(null);

const openDetail = (row: UserRow) => {
  detailUser.value = row;
  detailOpen.value = true;
};

// The server does not stop an operator from blocking their own SSO account.
const isSignedInUser = (row: UserRow) =>
  row.email.toLowerCase() === (store.state.userInfo?.email ?? "").toLowerCase();
const canBlock = (row: UserRow) =>
  row.is_external && row.blockState === "none" && !isSignedInUser(row);

const toggleBlocked = async (row: UserRow) => {
  const blocking = row.blockState === "none";
  if (blocking) {
    const ok = await confirm({
      title: t("settings.userManagementPage.blockConfirmTitle"),
      message: t("settings.userManagementPage.blockConfirmMessage", { email: row.email }),
      confirmLabel: t("settings.userManagementPage.block"),
      kind: "destructive",
    });
    if (!ok) return;
  }
  pendingEmail.value = row.email;
  try {
    const outcome = await setBlocked.mutateAsync({ email: row.email, blocked: blocking });
    if (outcome === "dormant-rules") {
      toast({
        variant: "warning",
        message: t("settings.userManagementPage.dormantRules", {
          page: t("settings.ssoDomainRestrictions"),
        }),
      });
      return;
    }
    toast({
      variant: "success",
      message: blocking
        ? t("settings.userManagementPage.blocked", { email: row.email })
        : t("settings.userManagementPage.unblocked", { email: row.email }),
    });
    analytics.track(blocking ? "user_management_user_blocked" : "user_management_user_unblocked");
  } catch (error: unknown) {
    toast({
      variant: "error",
      message:
        raw(responseOf(error)?.data?.message) || t("settings.userManagementPage.updateFailed"),
    });
  } finally {
    pendingEmail.value = null;
  }
};

const rowActions: OTableRowAction<UserRow>[] = [
  {
    id: "view",
    label: t("common.viewDetails"),
    icon: "visibility",
    onClick: openDetail,
    dataTest: (row) => `user-management-${row.id}-view`,
  },
  {
    id: "block",
    label: (row) =>
      row.blockState === "email"
        ? t("settings.userManagementPage.unblock")
        : t("settings.userManagementPage.block"),
    icon: (row) => (row.blockState === "email" ? "check-circle" : "block"),
    hidden: (row) => !canBlock(row) && row.blockState !== "email",
    loading: (row) => pendingEmail.value === row.email,
    disabled: () => pendingEmail.value !== null,
    onClick: toggleBlocked,
    dataTest: (row) => `user-management-${row.id}-block`,
  },
];

const onPageChange = ({ page: next, size }: OTablePaginationParams) => {
  if (size !== pageSize.value) {
    pageSize.value = size;
    page.value = 1;
    return;
  }
  page.value = next;
};

const clearFilters = () => {
  search.value = "";
  orgFilter.value = null;
};

// Every read on the screen goes to the server: the list, the SSO config and the org options.
const refresh = () => {
  usersList.refetch();
  domainConfig.refetch();
  orgs.refetch();
};

useShortcuts([
  {
    id: "userManagementRefresh",
    handler: () => {
      if (!isInputFocused()) refresh();
    },
  },
]);

onMounted(() => {
  if (!inMetaOrg.value) {
    router.replace({
      name: "general",
      query: { org_identifier: store.state.selectedOrganization?.identifier },
    });
    return;
  }
  analytics.track("user_management_opened");
});

defineExpose({ rows, page, search, orgFilter, refresh, toggleBlocked, openDetail });
</script>
