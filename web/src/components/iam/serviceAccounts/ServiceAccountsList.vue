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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->

<template>
  <OPageLayout
    :title="t('serviceAccounts.header')"
    icon="manage-accounts"
    :subtitle="t('serviceAccounts.headerSubtitle')"
    bleed
  >
    <template #actions>
      <OButton
        data-test="service-accounts-add-btn"
        variant="primary"
        size="sm"
        @click="addRoutePush({})"
      >
        {{ t("serviceAccounts.add") }}
      </OButton>
    </template>
    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          :data="serviceAccountsState.service_accounts_users"
          :columns="columns"
          row-key="email"
          :loading="loading"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('serviceAccounts.header')"
          sorting="client"
          selection="multiple"
          :selected-ids="selectedAccountEmails"
          :is-row-selectable="isRowSelectable"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          filter-mode="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-service-accounts-list"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('serviceAccounts.search')"
                class="flex-1"
                data-test="iam-service-accounts-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="iam-service-accounts-refresh-btn"
              @click="getServiceAccountsUsers"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="iamServiceAccountsRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-service-accounts"
              :filtered="!!filterQuery"
              @action="(id) => (id === 'clear-filters' ? (filterQuery = '') : addRoutePush({}))"
            />
          </template>

          <template #cell-email="{ row }">
            <template v-if="row.is_system">
              <span data-test="service-accounts-system-account-label" class="font-medium">{{
                row.first_name
              }}</span>
              <OTag
                data-test="service-accounts-system-badge"
                type="serviceAccountKind"
                value="system"
                class="ml-2"
              />
            </template>
            <template v-else-if="isSyntheticSA(row.email)">
              <!-- UI-created accounts store `<name>.<org>@sa.internal`; show
                     the friendly name first, full identifier (the Basic-auth
                     username) beneath it. -->
              <div :data-test="`service-accounts-email-${row.email}`" class="flex flex-col">
                <span class="font-medium">{{ saDisplayName(row.email) }}</span>
                <span class="text-xs text-text-secondary">{{ row.email }}</span>
              </div>
            </template>
            <template v-else>
              <span :data-test="`service-accounts-email-${row.email}`"
                ><OUserCell :value="row.email"
              /></span>
            </template>
          </template>

          <template #cell-first_name="{ row }">
            <template v-if="row.is_system && row.description">{{ row.description }}</template>
            <template v-else>{{ row.first_name }}</template>
          </template>

          <template #cell-token="{ row }">
            <OCodeCell
              :data-test="`service-accounts-token-${row.email}`"
              :value="row.token || '—'"
              :copy="false"
            />
          </template>

          <template #cell-created_at="{ row }">
            <span :data-test="`service-accounts-created-${row.email}`" class="text-text-body">{{
              formatCreatedAt(row.created_at)
            }}</span>
          </template>

          <template #cell-actions="{ row }">
            <template v-if="row.is_system">
              <span
                data-test="service-accounts-system-managed-badge"
                class="inline-flex items-center gap-1"
              >
                <OTag type="serviceAccountKind" value="managed" />
                <OTooltip :content="t('serviceAccounts.row.managedByTooltip')" />
              </span>
            </template>
            <template v-else>
              <OButton
                data-test="service-accounts-refresh"
                :title="t('serviceAccounts.rotate')"
                variant="ghost"
                size="icon-sm"
                icon-left="refresh"
                @click="confirmRefreshAction(row)"
              />
              <OButton
                data-test="service-accounts-edit"
                data-row-action="edit"
                :title="t('serviceAccounts.update')"
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                @click="addRoutePush(row)"
              />
              <OButton
                data-test="service-accounts-delete"
                data-row-action="delete"
                :title="t('serviceAccounts.deleteServiceAccount')"
                variant="ghost"
                size="icon-sm"
                icon-left="delete"
                @click="confirmDeleteAction(row)"
              />
            </template>
          </template>

          <template #bottom>
            <span class="text-xs font-normal"
              >{{ serviceAccountsState.service_accounts_users.length }}
              {{ t("serviceAccounts.header") }}</span
            >
            <OButton
              v-if="selectedAccounts.length > 0"
              data-test="service-accounts-list-delete-accounts-btn"
              variant="outline-destructive"
              size="sm"
              @click="openBulkDeleteDialog"
              icon-left="delete"
            >
              {{ t("serviceAccounts.bulkDelete") }}
            </OButton>
          </template>
        </OTable>
      </div>
    </div>
    <add-service-account
      v-model:open="showAddUserDialog"
      v-model="selectedUser"
      :isUpdated="isUpdated"
      @updated="addMember"
    />

    <ConfirmDialog
      data-test="service-accounts-list-refresh-dialog"
      v-model="confirmRefresh"
      :title="t('serviceAccounts.confirmRefreshHead')"
      :message="t('serviceAccounts.confirmRefreshMsg', { identifier: toBeRefreshed.email })"
      :ok-label="t('serviceAccounts.confirmRefreshBtn')"
      ok-color="destructive"
      @update:ok="refreshServiceToken(toBeRefreshed)"
      @update:cancel="confirmRefresh = false"
    />

    <ConfirmDialog
      data-test="service-accounts-list-delete-dialog"
      v-model="confirmDelete"
      :title="t('serviceAccounts.confirmDeleteHead')"
      :message="t('serviceAccounts.confirmDeleteMsg', { identifier: deleteUserEmailIdentifier })"
      :ok-label="t('serviceAccounts.confirmDeleteBtn')"
      ok-color="destructive"
      @update:ok="deleteUser"
      @update:cancel="confirmDelete = false"
    />

    <ConfirmDialog
      data-test="service-accounts-list-bulk-delete-dialog"
      v-model="confirmBulkDelete"
      :title="t('serviceAccounts.confirmBulkDeleteHead')"
      :message="t('serviceAccounts.confirmBulkDeleteMsg', { count: selectedAccounts.length })"
      :ok-label="t('serviceAccounts.confirmBulkDeleteBtn', { count: selectedAccounts.length })"
      ok-color="destructive"
      @update:ok="bulkDeleteServiceAccounts"
      @update:cancel="confirmBulkDelete = false"
    />

    <ODialog
      data-test="service-accounts-list-token-dialog"
      v-model:open="isShowToken"
      persistent
      size="md"
      :title="t('serviceAccounts.tokenReveal.step1Title')"
    >
      <!-- Single screen: access is granted in the create form itself, so the
           old two-step wizard collapsed to just the token reveal, followed by
           an access summary (creation only — rotate shows the token alone). -->
      <div data-test="service-accounts-token-wizard">
        <div data-test="service-accounts-token-step-1">
          <p class="text-xs text-text-secondary mb-3">
            {{ t("serviceAccounts.tokenReveal.copyHint") }}
          </p>

          <OTabs v-model="tokenTab" dense align="left">
            <OTab name="curl" :label="t('serviceAccounts.tokenReveal.curl')" />
            <OTab name="header" :label="t('serviceAccounts.tokenReveal.header')" />
            <OTab name="env" :label="t('serviceAccounts.tokenReveal.env')" />
          </OTabs>

          <OTabPanels v-model="tokenTab" animated>
            <OTabPanel name="curl">
              <pre
                class="bg-surface-subtle text-text-body p-3 rounded-default text-xs overflow-auto whitespace-pre-wrap"
                >{{ tokenCurlSnippet }}</pre
              >
            </OTabPanel>
            <OTabPanel name="header">
              <pre
                class="bg-surface-subtle text-text-body p-3 rounded-default text-xs overflow-auto whitespace-pre-wrap"
                >{{ tokenHeaderSnippet }}</pre
              >
            </OTabPanel>
            <OTabPanel name="env">
              <pre
                class="bg-surface-subtle text-text-body p-3 rounded-default text-xs overflow-auto whitespace-pre-wrap"
                >{{ tokenEnvSnippet }}</pre
              >
            </OTabPanel>
          </OTabPanels>

          <div class="flex items-center gap-2 mt-3">
            <OButton
              data-test="service-accounts-list-token-copy-btn"
              variant="outline"
              size="icon-md"
              :title="t('serviceAccounts.copyToken')"
              @click.stop="
                copyToClipboard(serviceToken, {
                  successMessage: t('serviceAccounts.toast.tokenCopied'),
                  timeout: 5000,
                })
              "
            >
              <OIcon name="content-copy" size="sm" />
            </OButton>
            <span class="text-xs text-text-secondary">{{ t("serviceAccounts.copyToken") }}</span>

            <OButton
              data-test="service-accounts-list-token-download-btn"
              variant="outline"
              size="icon-md"
              class="ml-2"
              :title="t('serviceAccounts.downloadToken')"
              @click.stop="downloadTokenAsFile(serviceToken)"
            >
              <OIcon name="file-download" size="sm" />
            </OButton>
            <span class="text-xs text-text-secondary">{{
              t("serviceAccounts.downloadToken")
            }}</span>
          </div>

          <!-- ── Access grant status ──
               Pending: the create flow's grant fan-out has not settled yet
               (the token is shown immediately; grants resolve behind it).
               Summary: what was granted / what failed.
               Otherwise (rotate, or created with nothing selected): the
               grant nudge + quick links — rotate keeps this guidance too,
               since the account may well have no permissions. -->
          <div
            v-if="tokenAccessPending"
            data-test="service-accounts-token-access-pending"
            class="mt-4 flex items-center gap-2"
          >
            <OSpinner size="xs" />
            <span class="text-xs text-text-secondary">{{
              t("serviceAccounts.tokenReveal.applying")
            }}</span>
          </div>

          <div
            v-else-if="hasAccessGrants || hasAccessFailures"
            data-test="service-accounts-token-access-summary"
            class="mt-4"
          >
            <div v-if="grantedRolesText" class="flex items-start gap-2 mb-1">
              <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
              <span class="text-xs text-text-secondary">{{ grantedRolesText }}</span>
            </div>
            <div v-if="grantedGroupsText" class="flex items-start gap-2 mb-1">
              <OIcon name="check" size="sm" class="text-status-success-text mt-0.5 shrink-0" />
              <span class="text-xs text-text-secondary">{{ grantedGroupsText }}</span>
            </div>

            <div
              v-if="failedRolesText"
              data-test="service-accounts-token-access-failed"
              class="flex items-start gap-2 mb-1"
            >
              <OIcon name="warning" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
              <span class="text-xs text-text-secondary">{{ failedRolesText }}</span>
            </div>
            <div v-if="failedGroupsText" class="flex items-start gap-2 mb-1">
              <OIcon name="warning" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
              <span class="text-xs text-text-secondary">{{ failedGroupsText }}</span>
            </div>
            <p v-if="hasAccessFailures" class="text-xs text-text-secondary mt-1">
              {{ t("serviceAccounts.tokenReveal.failedHint") }}
            </p>
          </div>

          <div v-else class="mt-4">
            <div data-test="service-accounts-list-token-next-step" class="flex items-start gap-2">
              <OIcon
                v-if="showGroupLink"
                name="warning"
                size="sm"
                class="text-status-warning-text mt-0.5"
              />
              <span class="text-xs text-text-secondary">{{ tokenNextStepHint }}</span>
            </div>

            <div v-if="showGroupLink" class="flex flex-wrap items-center justify-center gap-3 mt-3">
              <router-link
                data-test="service-accounts-list-token-add-to-role"
                :to="roleLinkTarget"
                class="group inline-flex items-center gap-1.5 rounded-default border border-border-default px-2.5 py-1.5 text-xs text-text-body transition-colors hover:border-primary hover:bg-primary/5"
                @click="isShowToken = false"
              >
                <OIcon name="shield" size="sm" class="text-primary shrink-0" />
                <span class="font-medium">{{ t("serviceAccounts.tokenReveal.addToRole") }}</span>
                <OIcon
                  name="arrow-right"
                  size="sm"
                  class="text-text-secondary shrink-0 transition-transform group-hover:translate-x-0.5"
                />
              </router-link>
              <router-link
                data-test="service-accounts-list-token-add-to-group"
                :to="groupLinkTarget"
                class="group inline-flex items-center gap-1.5 rounded-default border border-border-default px-2.5 py-1.5 text-xs text-text-body transition-colors hover:border-primary hover:bg-primary/5"
                @click="isShowToken = false"
              >
                <OIcon name="group" size="sm" class="text-primary shrink-0" />
                <span class="font-medium">{{ t("serviceAccounts.tokenReveal.addToGroup") }}</span>
                <OIcon
                  name="arrow-right"
                  size="sm"
                  class="text-text-secondary shrink-0 transition-transform group-hover:translate-x-0.5"
                />
              </router-link>
            </div>
          </div>

          <div class="flex justify-end mt-4 pt-3 border-t border-border-default">
            <OButton
              data-test="service-accounts-token-done-btn"
              variant="primary"
              size="sm"
              @click="isShowToken = false"
            >
              {{ t("serviceAccounts.tokenReveal.done") }}
            </OButton>
          </div>
        </div>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import AddServiceAccount from "./AddServiceAccount.vue";
import {
  isSyntheticServiceAccountEmail,
  serviceAccountDisplayName,
} from "./AddServiceAccount.schema";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { formatDate } from "@/utils/date";
import { b64EncodeStandard } from "@/utils/formatters";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { COL } from "@/lib/core/Table/OTable.types";

// @ts-ignore
import usePermissions from "@/composables/iam/usePermissions";
import { computed } from "vue";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
export default defineComponent({
  name: "ServiceAccountsList",
  components: {
    OEmptyState,
    AddServiceAccount,
    ConfirmDialog,
    OButton,
    ODialog,
    OIcon,
    OPageLayout,
    OTooltip,
    OTable,
    OTag,
    OCodeCell,
    OUserCell,
    OSearchInput,
    OTabs,
    OTab,
    OTabPanels,
    OTabPanel,
    OSpinner,
  },
  emits: [],
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const resultTotal = ref<number>(0);
    const confirmDelete = ref<boolean>(false);
    const selectedUser: any = ref({});
    const orgData: any = ref(store.state.selectedOrganization);
    const isUpdated = ref(false);
    const showAddUserDialog = ref(false);
    const { serviceAccountsState } = usePermissions();
    const isEnterprise = ref(false);
    const isCurrentUserInternal = ref(false);
    const isShowToken = ref(false);
    const confirmRefresh = ref(false);
    const filterQuery = ref("");
    const toBeRefreshed = ref<{ email?: string }>({});

    const serviceToken = ref("");
    const tokenAccountEmail = ref("");

    const tokenTab = ref("curl");

    // Access-grant outcome from the create flow ({ assigned, failed } buckets
    // of role/group names), shown under the token. Null on token rotate.
    const tokenAccess = ref<{
      assigned: { roles: string[]; groups: string[] };
      failed: { roles: string[]; groups: string[] };
    } | null>(null);
    // True while the create flow's grant fan-out is still settling — the token
    // is revealed immediately and the outcome fills in when it resolves.
    const tokenAccessPending = ref(false);

    const hasAccessGrants = computed(
      () =>
        !!tokenAccess.value &&
        tokenAccess.value.assigned.roles.length + tokenAccess.value.assigned.groups.length > 0,
    );
    const hasAccessFailures = computed(
      () =>
        !!tokenAccess.value &&
        tokenAccess.value.failed.roles.length + tokenAccess.value.failed.groups.length > 0,
    );
    const grantedRolesText = computed(() =>
      tokenAccess.value?.assigned.roles.length
        ? t("serviceAccounts.tokenReveal.grantedRoles", {
            roles: tokenAccess.value.assigned.roles.join(", "),
          })
        : "",
    );
    const grantedGroupsText = computed(() =>
      tokenAccess.value?.assigned.groups.length
        ? t("serviceAccounts.tokenReveal.grantedGroups", {
            groups: tokenAccess.value.assigned.groups.join(", "),
          })
        : "",
    );
    const failedRolesText = computed(() =>
      tokenAccess.value?.failed.roles.length
        ? t("serviceAccounts.tokenReveal.failedRoles", {
            roles: tokenAccess.value.failed.roles.join(", "),
          })
        : "",
    );
    const failedGroupsText = computed(() =>
      tokenAccess.value?.failed.groups.length
        ? t("serviceAccounts.tokenReveal.failedGroups", {
            groups: tokenAccess.value.failed.groups.join(", "),
          })
        : "",
    );

    // OpenObserve authenticates API requests with HTTP Basic auth —
    // base64("<identifier>:<token>"), NOT a Bearer token. The service account's
    // email is the username and the token is the password.
    const tokenEndpoint = computed(() =>
      config.isCloud === "true" ? "https://api.openobserve.ai" : window.location.origin,
    );

    const tokenBasicCredential = computed(() =>
      b64EncodeStandard(
        `${tokenAccountEmail.value || "IDENTIFIER"}:${serviceToken.value || "YOUR_TOKEN"}`,
      ),
    );

    const tokenCurlSnippet = computed(() => {
      const orgId = store.state.selectedOrganization.identifier;
      // `curl -u user:pass` builds the Basic auth header itself, so the example
      // stays copy-paste runnable. Simplest authenticated GET: list streams.
      return `curl -u "${tokenAccountEmail.value || "IDENTIFIER"}:${serviceToken.value || "YOUR_TOKEN"}" \\\n  "${tokenEndpoint.value}/api/${orgId}/streams"`;
    });

    const tokenHeaderSnippet = computed(() => {
      return `Authorization: Basic ${tokenBasicCredential.value}`;
    });

    const tokenEnvSnippet = computed(() => {
      const orgId = store.state.selectedOrganization.identifier;
      return `OPENOBSERVE_AUTH="Basic ${tokenBasicCredential.value}"\nOPENOBSERVE_ORG_ID=${orgId}`;
    });

    // Enterprise/Cloud builds have a Groups UI, so a freshly created account
    // can be granted permissions in one click. OSS has no Groups page, so it
    // only gets the plain usage hint.
    const showGroupLink = computed(
      () => config.isEnterprise === "true" || config.isCloud === "true",
    );

    // Step 2 framing: enterprise/cloud nudges toward the Groups page (with a
    // link below); OSS has no Groups UI, so it points to Roles & Groups in copy.
    const tokenNextStepHint = computed(() => {
      if (showGroupLink.value) return t("serviceAccounts.tokenReveal.nextStepGrant");
      return t("serviceAccounts.tokenReveal.nextStepOss");
    });

    const groupLinkTarget = computed(() => ({
      name: "groups",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        member: tokenAccountEmail.value,
      },
    }));

    const roleLinkTarget = computed(() => ({
      name: "roles",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        member: tokenAccountEmail.value,
      },
    }));

    const revealToken = (token: string, email: string, access: typeof tokenAccess.value = null) => {
      serviceToken.value = token;
      tokenAccountEmail.value = email;
      tokenTab.value = "curl";
      tokenAccess.value = access;
      tokenAccessPending.value = false;
      isShowToken.value = true;
    };

    // UI-created accounts use the synthetic `<name>.<org>@sa.internal`
    // identifier; the list shows the friendly name for those.
    const isSyntheticSA = (email: string) =>
      isSyntheticServiceAccountEmail(email, store.state.selectedOrganization.identifier);
    const saDisplayName = (email: string) =>
      serviceAccountDisplayName(email, store.state.selectedOrganization.identifier);

    const serviceAccounts = ref([]);
    const selectedAccounts: any = ref([]);
    const confirmBulkDelete = ref(false);

    onBeforeMount(async () => {
      await getServiceAccountsUsers();

      // Only `action=update&email=…` auto-opens the edit dialog so a shared
      // edit link still lands directly on the user's form. `action=add` is
      // intentionally NOT handled here — the dialog only opens via the
      // "Add Service Account" button click; refreshing on an `action=add`
      // URL should leave the user on the list view.
      const query = router.currentRoute.value.query;
      if (query.action === "update" && query.email) {
        const match = serviceAccountsState.service_accounts_users.find(
          (m: any) => m.email === query.email,
        );
        if (match) addUser({ row: match }, true);
      }
    });

    const columns: OTableColumnDef[] = [
      {
        id: "email",
        header: t("serviceAccounts.list.col.identifier"),
        accessorKey: "email",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.email,
        meta: { align: "left" },
      },
      {
        id: "first_name",
        header: t("user.description"),
        accessorKey: "first_name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.description,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "token",
        header: t("serviceAccounts.list.col.token"),
        accessorKey: "token",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "left" },
      },
      {
        id: "created_at",
        header: t("serviceAccounts.list.col.created"),
        accessorKey: "created_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 170,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("user.actions"),
        isAction: true,
        pinned: "right",
        size: 130,
        meta: { align: "center", actionCount: 3 },
      },
    ];
    const userEmail: any = ref("");
    const options = ref([{ label: "Admin", value: "admin" }]);
    const selectedRole = ref(options.value[0].value);
    const currentUserRole = ref("");
    let deleteUserEmail = "";
    const deleteUserEmailIdentifier = ref("");

    const selectedAccountEmails = computed(() => selectedAccounts.value.map((a: any) => a.email));

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const accountsMap = new Map(
        serviceAccountsState.service_accounts_users.map((a: any) => [a.email, a]),
      );
      selectedAccounts.value = ids.map((id) => accountsMap.get(id)).filter(Boolean);
    };

    const confirmDeleteAction = (row: any) => {
      confirmDelete.value = true;
      deleteUserEmail = row.email;
      deleteUserEmailIdentifier.value = row.email;
    };
    const loading = ref(false);
    const getServiceAccountsUsers = async () => {
      const dismiss = toast({
        variant: "loading",
        message: t("serviceAccounts.toast.loading"),
        timeout: 0,
      });

      loading.value = true;
      return new Promise((resolve, reject) => {
        service_accounts
          .list(store.state.selectedOrganization.identifier)
          .then((res) => {
            resultTotal.value = res.data.data.length;
            currentUserRole.value = "";
            serviceAccountsState.service_accounts_users = res.data.data.map((data: any) => {
              return {
                email: data.email,
                first_name: data.first_name,
                last_name: data.last_name,
                token: data.token || "",
                role: data.role || "ServiceAccount",
                is_system: data.is_system || false,
                description: data.description || null,
                created_at: data.created_at || 0,
              };
            });

            dismiss();

            resolve(true);
          })
          .catch(() => {
            dismiss();
            reject(false);
          })
          .finally(() => {
            loading.value = false;
          });
      });
    };
    const addUser = (props: any, is_updated: boolean) => {
      isUpdated.value = is_updated;
      selectedUser.value.organization = store.state.selectedOrganization.identifier;

      if (props.row != undefined) {
        selectedUser.value = props.row;
      } else {
        selectedUser.value = {};
      }
      setTimeout(() => {
        showAddUserDialog.value = true;
      }, 100);
    };
    const addRoutePush = (row: any) => {
      if (row?.email) {
        router.push({
          name: "serviceAccounts",
          query: {
            action: "update",
            org_identifier: store.state.selectedOrganization.identifier,
            email: row.email,
          },
        });
        addUser({ row }, true);
      } else {
        track("Button Click", {
          button: "Add Service Account",
          page: "Service Accounts",
        });
        addUser({}, false);
        router.push({
          name: "serviceAccounts",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };
    const hideForm = () => {
      showAddUserDialog.value = false;
      router.replace({
        name: "serviceAccounts",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const redactToken = (token: string): string => {
      if (!token || token.length === 0) return "*".repeat(12);
      if (token.length < 4) {
        // For tokens shorter than 4 chars, show available chars and pad to 12
        return token + "*".repeat(12 - token.length);
      } else {
        // For tokens 4+ chars, show first 4 chars + asterisks (matches backend)
        return token.slice(0, 4) + "*".repeat(8);
      }
    };

    // created_at arrives as epoch microseconds (chrono timestamp_micros on the
    // backend). Render it the same way the Alerts list does: a readable
    // "YYYY-MM-DD HH:mm:ss" string. Falsy/zero values show an em dash.
    const formatCreatedAt = (createdAt: number): string => {
      if (!createdAt) return "—";
      const iso = new Date(createdAt / 1000).toISOString();
      return formatDate(iso, "YYYY-MM-DD HH:mm:ss");
    };

    const downloadTokenAsFile = (token: string) => {
      const blob = new Blob([token], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "service_account_token.txt";
      link.click();
      URL.revokeObjectURL(link.href); // Cleanup
    };

    const addMember = async (
      res: any,
      data: any,
      operationType: string,
      access: typeof tokenAccess.value | Promise<typeof tokenAccess.value> = null,
    ) => {
      showAddUserDialog.value = false;
      if (res.code == 200) {
        if (operationType == "created") {
          toast({
            message: t("serviceAccounts.toast.created"),
            variant: "success",
          });

          // The grant fan-out may still be in flight (the dialog emits its
          // promise so the show-once token is never blocked on it). Reveal
          // the token immediately; fill the access outcome in when it lands.
          if (access && typeof (access as any).then === "function") {
            revealToken(res.token, data.email, null);
            tokenAccessPending.value = true;
            (access as Promise<typeof tokenAccess.value>).then((resolved) => {
              tokenAccess.value = resolved;
              tokenAccessPending.value = false;
            });
          } else {
            revealToken(res.token, data.email, access as typeof tokenAccess.value);
          }
          if (store.state.selectedOrganization.identifier == data.organization) {
            const user = {
              email: data.email,
              first_name: data.first_name,
              last_name: data.last_name,
              token: res.token ? redactToken(res.token) : "",
              // created_at is stored as epoch microseconds (matches the list API
              // and formatCreatedAt); the freshly created row uses "now".
              created_at: data.created_at || Date.now() * 1000,
            };

            serviceAccountsState.service_accounts_users = [
              ...serviceAccountsState.service_accounts_users,
              user,
            ];
            resultTotal.value = serviceAccountsState.service_accounts_users.length;
          }
        } else {
          setTimeout(() => {
            toast({
              message: t("serviceAccounts.toast.updated"),
              variant: "success",
            });
          }, 2000);
          serviceAccountsState.service_accounts_users =
            serviceAccountsState.service_accounts_users.map((member: any) => {
              if (member.email == data.email) {
                return { ...member, ...data };
              }
              return member;
            });
        }
      }
      router.replace({
        name: "serviceAccounts",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const deleteUser = async () => {
      confirmDelete.value = false;
      service_accounts
        .delete(store.state.selectedOrganization.identifier, deleteUserEmail)
        .then(async (res: any) => {
          if (res.data.code == 200) {
            toast({
              message: t("serviceAccounts.toast.deleted"),
              variant: "success",
            });
            await getServiceAccountsUsers();
          }
        })
        .catch((err: any) => {
          if (err.response?.status != 403) {
            toast({
              message: err.response?.data?.message || t("serviceAccounts.toast.deleteError"),
              variant: "error",
            });
          }
        });
    };

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteServiceAccounts = async () => {
      const accountEmails = selectedAccounts.value
        .filter((account: any) => !isSystemAccount(account.email))
        .map((account: any) => account.email);

      try {
        const res = await service_accounts.bulkDelete(store.state.selectedOrganization.identifier, {
          ids: accountEmails,
        });
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          toast({
            message: t("serviceAccounts.toast.bulkDeleteSuccess", { count: successful.length }),
            variant: "success",
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: t("serviceAccounts.toast.bulkDeletePartial", {
              successful: successful.length,
              failed: unsuccessful.length,
            }),
            variant: "warning",
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: t("serviceAccounts.toast.bulkDeleteFailed", { failed: unsuccessful.length }),
            variant: "error",
          });
        }

        selectedAccounts.value = [];
        confirmBulkDelete.value = false;
        await getServiceAccountsUsers();
      } catch (err: any) {
        if (err.response?.status != 403 || err?.status != 403) {
          toast({
            message:
              err?.response?.data?.message ||
              err?.message ||
              t("serviceAccounts.toast.bulkDeleteError"),
            variant: "error",
          });
        }
      }
    };

    const refreshServiceToken = async (row: any) => {
      confirmRefresh.value = false;
      row.isLoading = true;
      await service_accounts
        .refresh_token(store.state.selectedOrganization.identifier, row.email)
        .then((res) => {
          revealToken(res.data.token, row.email);

          toast({
            message: t("serviceAccounts.toast.rotated"),
            variant: "success",
          });

          getServiceAccountsUsers();
        })
        .catch((err) => {
          if (err.response?.status != 403) {
            toast({
              message: err.response?.data?.message || t("serviceAccounts.toast.rotateError"),
              variant: "error",
            });
          }
        })
        .finally(() => {
          row.isLoading = false;
        });
    };
    const isSystemAccount = (email: string) => {
      return email.startsWith("o2-sre-agent.org-") && email.endsWith("@openobserve.internal");
    };

    // System-managed accounts cannot be bulk-deleted, so they are not
    // selectable: the checkbox renders disabled and they are excluded from
    // "select all". This surfaces the constraint up-front instead of silently
    // skipping them at delete time.
    const isRowSelectable = (row: any) => {
      return !(row?.is_system || isSystemAccount(row?.email || ""));
    };

    const confirmRefreshAction = (row: any) => {
      confirmRefresh.value = true;
      toBeRefreshed.value = row;
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "iamServiceAccountsAdd",
        handler: () => {
          if (!isInputFocused()) addRoutePush({});
        },
      },
      {
        id: "iamServiceAccountsRefresh",
        handler: () => {
          if (!isInputFocused()) getServiceAccountsUsers();
        },
      },
      {
        id: "iamServiceAccountsFocusSearch",
        handler: () => {
          focusSearchInput("iam-service-accounts-search-input");
        },
      },
    ]);
    return {
      t,
      router,
      store,
      config,
      serviceAccountsState,
      columns,
      loading,
      orgData,
      confirmDelete,
      serviceAccounts,
      addRoutePush,
      addMember,
      isUpdated,
      showAddUserDialog,
      hideForm,
      addUser,
      confirmDeleteAction,
      visibility: "visibility",
      deleteUser,
      getServiceAccountsUsers,
      selectedUser,
      refreshServiceToken,
      copyToClipboard,
      isShowToken,
      serviceToken,
      tokenTab,
      tokenAccess,
      tokenAccessPending,
      hasAccessGrants,
      hasAccessFailures,
      grantedRolesText,
      grantedGroupsText,
      failedRolesText,
      failedGroupsText,
      isSyntheticSA,
      saDisplayName,
      revealToken,
      tokenCurlSnippet,
      tokenHeaderSnippet,
      tokenEnvSnippet,
      tokenNextStepHint,
      showGroupLink,
      groupLinkTarget,
      roleLinkTarget,
      confirmRefreshAction,
      filterQuery,
      userEmail,
      selectedRole,
      options,
      currentUserRole,
      getImageURL,
      verifyOrganizationStatus,
      isEnterprise,
      isCurrentUserInternal,
      toBeRefreshed,
      confirmRefresh,
      selectedAccounts,
      selectedAccountEmails,
      handleSelectedIdsUpdate,
      confirmBulkDelete,
      openBulkDeleteDialog,
      bulkDeleteServiceAccounts,
      redactToken,
      formatCreatedAt,
      downloadTokenAsFile,
      isSystemAccount,
      isRowSelectable,
      deleteUserEmailIdentifier,
    };
  },
});
</script>
