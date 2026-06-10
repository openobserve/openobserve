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
  <div class="tw:rounded-md tw:p-0 tw:h-full tw:flex tw:flex-col">
    <!-- Standard page header: title + actions only. Search moved into the
         table's own toolbar (built-in global filter). -->
    <AppPageHeader
      :title="t('serviceAccounts.header')"
      icon="manage-accounts"
      :subtitle="'Programmatic access tokens for APIs'"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <OButton
          data-test="service-accounts-add-btn"
          variant="primary"
          size="sm"
          @click="addRoutePush({})"
        >
          {{ t('serviceAccounts.add') }}
        </OButton>
      </template>
    </AppPageHeader>
      <div class="tw:w-full tw:flex-1 tw:min-h-0 tw:overflow-hidden">
        <div class="card-container tw:h-full">
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
            v-model:global-filter="filterQuery"
            :show-global-filter="false"
            filter-mode="client"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="iam-service-accounts-list"
            @update:selected-ids="handleSelectedIdsUpdate"
          >
            <template #toolbar>
              <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
                <OSearchInput
                  v-model="filterQuery"
                  :placeholder="t('serviceAccounts.search')"
                  class="tw:flex-1"
                />
              </div>
            </template>
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-service-accounts"
                :filtered="!!filterQuery"
                @action="
                  (id) =>
                    id === 'clear-filters'
                      ? (filterQuery = '')
                      : addRoutePush({})
                "
              />
            </template>

            <template #cell-email="{ row }">
              <template v-if="row.is_system">
                <span data-test="service-accounts-system-account-label" class="text-weight-medium">AI SRE Agent</span>
                <OBadge data-test="service-accounts-system-badge" variant="primary-outline" size="sm" class="tw:ml-2">system</OBadge>
              </template>
              <template v-else>
                <span :data-test="`service-accounts-email-${row.email}`">{{ row.email }}</span>
              </template>
            </template>

            <template #cell-first_name="{ row }">
              <template v-if="row.is_system && row.description">{{ row.description }}</template>
              <template v-else>{{ row.first_name }}</template>
            </template>

            <template #cell-token="{ row }">
              <span class="tw:font-mono">{{ row.token || '************' }}</span>
            </template>

            <template #cell-actions="{ row }">
              <template v-if="row.is_system">
                <OBadge data-test="service-accounts-system-managed-badge" variant="default-outline">
                    {{ t('serviceAccounts.systemManaged', 'System Managed') }}
                  <OTooltip v-if="row.description" :content="row.description" />
                </OBadge>
              </template>
              <template v-else>
                <OButton
                  data-test="service-accounts-refresh"
                  :title="t('serviceAccounts.refresh')"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="refresh"
                  @click="confirmRefreshAction(row)"
                />
                <OButton
                  data-test="service-accounts-edit"
                  :title="t('serviceAccounts.update')"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="edit"
                  @click="addRoutePush(row)"
                />
                <OButton
                  data-test="service-accounts-delete"
                  :title="t('serviceAccounts.delete')"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="delete"
                  @click="confirmDeleteAction(row)"
                />
              </template>
            </template>

            <template #bottom>
              <span class="o2-table-footer-title tw:text-text-primary">{{ serviceAccountsState.service_accounts_users.length }} {{ t('serviceAccounts.header') }}</span>
              <OButton
                v-if="selectedAccounts.length > 0"
                data-test="service-accounts-list-delete-accounts-btn"
                variant="outline-destructive"
                size="sm"
                @click="openBulkDeleteDialog"
                icon-left="delete"
              >
                Delete
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

    <ODialog data-test="service-accounts-list-refresh-dialog"
      v-model:open="confirmRefresh"
      :title="t('serviceAccounts.confirmRefreshHead')"
      :secondary-button-label="t('user.cancel')"
      :primary-button-label="t('user.ok')"
      @click:secondary="confirmRefresh = false"
      @click:primary="refreshServiceToken(toBeRefreshed)"
    >
      <p>{{ t('serviceAccounts.confirmRefreshMsg') }}</p>
    </ODialog>

    <ODialog data-test="service-accounts-list-delete-dialog"
      v-model:open="confirmDelete"
      :title="t('serviceAccounts.confirmDeleteHead')"
      :secondary-button-label="t('user.cancel')"
      :primary-button-label="t('user.ok')"
      @click:secondary="confirmDelete = false"
      @click:primary="deleteUser"
      size="sm"
    >
      <p>{{ t('serviceAccounts.confirmDeleteMsg') }}</p>
    </ODialog>

    <ODialog data-test="service-accounts-list-bulk-delete-dialog"
      v-model:open="confirmBulkDelete"
      size="sm"
      title="Delete Service Accounts"
      secondary-button-label="Cancel"
      primary-button-label="OK"
      @click:secondary="confirmBulkDelete = false"
      @click:primary="bulkDeleteServiceAccounts"
    >
      <p>Are you sure you want to delete {{ selectedAccounts.length }} service account(s)?</p>
    </ODialog>

    <ODialog data-test="service-accounts-list-token-dialog"
      v-model:open="isShowToken"
      persistent
      size="md"
      title="Service Account Token"
    >

      <div class="tw:flex tw:items-center tw:gap-2 tw:rounded-lg" style="padding: 0rem 0.5rem;">
        <!-- Token section taking 75% of the width -->
        <div
          class="tw:text-xl tw:font-semibold tw:text-center tw:truncate el-border"
          style="flex: 3; padding: 0.5rem; border-radius: 6px; font-family: monospace; text-align: center; overflow: hidden;"
        >
          {{ serviceToken }}
        </div>
        <!-- Buttons section taking 25% of the width -->
        <div class="tw:flex tw:justify-end tw:gap-1" style="flex: 1; max-width: 25%;">
          <OButton
            data-test="service-accounts-list-token-copy-btn"
            variant="outline"
            size="icon-md"
            :title="t('serviceAccounts.copyToken')"
            class="tw:mr-1"
            @click.stop="copyToClipboard(serviceToken, { successMessage: 'Token Copied Successfully!', timeout: 5000 })"
          >
            <OIcon name="content-copy" size="sm" />
          </OButton>
          <OButton
            data-test="service-accounts-list-token-download-btn"
            variant="outline"
            size="icon-md"
            :title="t('serviceAccounts.downloadToken')"
            @click.stop="downloadTokenAsFile(serviceToken)"
          >
            <OIcon name="file-download" size="sm" />
          </OButton>
        </div>
      </div>

      <div class="tw:pt-3 tw:flex tw:items-center warning-text">
        <OIcon name="info" class="tw:mr-1" size="sm" />
        <span class="text-p">Make sure to copy / download the token. You will not be able to see it again.</span>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">

import { defineComponent, ref, onBeforeMount, onMounted, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import AddServiceAccount from "./AddServiceAccount.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import usersService from "@/services/users";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import {
  getImageURL,
  verifyOrganizationStatus,
  maskText,
} from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

// @ts-ignore
import usePermissions from "@/composables/iam/usePermissions";
import { computed, nextTick } from "vue";
import { getRoles } from "@/services/iam";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
export default defineComponent({
  name: "ServiceAccountsList",
  components: { OEmptyState, AddServiceAccount, OButton, ODialog, OIcon, AppPageHeader, OTooltip, OTable, OBadge, OSearchInput },
  emits: [],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const { track } = useReo();
    const resultTotal = ref<number>(0);
    const confirmDelete = ref<boolean>(false);
    const selectedUser: any = ref({});
    const orgData: any = ref(store.state.selectedOrganization);
    const qTable: any = ref(null);
    const isUpdated = ref(false);
    const showAddUserDialog = ref(false);
    const { serviceAccountsState } = usePermissions();
    const isEnterprise = ref(false);
    const isCurrentUserInternal = ref(false);
    const isShowToken = ref(false);
    const confirmRefresh  = ref(false);
    const filterQuery = ref("");
    const toBeRefreshed = ref({

    });

    const serviceToken  = ref("");

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
        id: "#",
        header: "#",
        accessorKey: "#",
        size: TABLE_INDEX_COL_SIZE,
        minSize: 32,
        maxSize: 40,
        meta: { align: "left", compactPadding: true },
      },
      {
        id: "email",
        header: t("user.email"),
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
        header: t("serviceAccounts.token"),
        accessorKey: "token",
        sortable: false,
        resizable: true,
        hideable: true,
        size: COL.token,
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

    const currentUser = computed(() => store.state.userInfo.email);

    const selectedAccountEmails = computed(() =>
      selectedAccounts.value.map((a: any) => a.email),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const accountsMap = new Map(
        serviceAccountsState.service_accounts_users.map((a: any) => [a.email, a]),
      );
      selectedAccounts.value = ids.map((id) => accountsMap.get(id)).filter(Boolean);
    };

    const confirmDeleteAction = (row: any) => {
      confirmDelete.value = true;
      deleteUserEmail = row.email;
    };
    const loading = ref(false);
    const getServiceAccountsUsers = async () =>{
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading service accounts...",
              timeout: 0,
});

      loading.value = true;
      return new Promise((resolve, reject) => {
        service_accounts
          .list(
            store.state.selectedOrganization.identifier
          )
          .then((res) => {
            resultTotal.value = res.data.data.length;
            let counter = 1;
            currentUserRole.value = "";
            serviceAccountsState.service_accounts_users = res.data.data.map((data: any) => {
              return {
                "#": counter <= 9 ? `0${counter++}` : counter++,
                email: maskText(data.email),
                first_name: data.first_name,
                last_name: data.last_name,
                token: data.token || '',
                role: data.role || 'ServiceAccount',
                is_system: data.is_system || false,
                description: data.description || null,
              };
            });

            dismiss();

            resolve(true);
          })
          .catch((err) => {
            dismiss();
            reject(false);
          })
          .finally(() => {
            loading.value = false;
          });
      });
    }
    const addUser = (props: any, is_updated: boolean) => {
      isUpdated.value = is_updated;
      selectedUser.value.organization =
        store.state.selectedOrganization.identifier;

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
          page: "Service Accounts"
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
      if (!token || token.length === 0) return '*'.repeat(12);
      if (token.length < 4) {
        // For tokens shorter than 4 chars, show available chars and pad to 12
        return token + '*'.repeat(12 - token.length);
      } else {
        // For tokens 4+ chars, show first 4 chars + asterisks (matches backend)
        return token.slice(0, 4) + '*'.repeat(8);
      }
    };

    const addMember = async (res: any, data: any, operationType: string) => {
      showAddUserDialog.value = false;
      if (res.code == 200 ) {
        if (operationType == "created") {
            toast({
              message: "Service Account created successfully.",
              variant: "success",
            });

          serviceToken.value = res.token;
          isShowToken.value = true;
          if (
            store.state.selectedOrganization.identifier == data.organization
          ) {
            const user = {
              "#":
              serviceAccountsState.service_accounts_users.length + 1 <= 9
                  ? `0${serviceAccountsState.service_accounts_users.length + 1}`
                  : serviceAccountsState.service_accounts_users.length + 1,
              email: data.email,
              first_name: data.first_name,
              last_name: data.last_name,
              token: res.token ? redactToken(res.token) : '',
            };

            serviceAccountsState.service_accounts_users = [...serviceAccountsState.service_accounts_users, user];
            resultTotal.value = serviceAccountsState.service_accounts_users.length;
          }
        } else {
          setTimeout(() => {
            toast({
              message: "Service Account updated successfully.",
              variant: "success",
            });
          }, 2000);
          serviceAccountsState.service_accounts_users = serviceAccountsState.service_accounts_users.map((member: any) => {
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
              message: "Service Account deleted successfully.",
              variant: "success",
            });
            await getServiceAccountsUsers();
          }
        })
        .catch((err: any) => {
          if(err.response?.status != 403){
            toast({
            message: err.response?.data?.message || "Error while deleting user.",
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
        const res = await service_accounts.bulkDelete(
          store.state.selectedOrganization.identifier,
          { ids: accountEmails }
        );
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          toast({
            message: `Successfully deleted ${successful.length} service account(s)`,
            variant: "success",
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: `Deleted ${successful.length} service account(s), but ${unsuccessful.length} failed`,
            variant: "warning",
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: `Failed to delete ${unsuccessful.length} service account(s)`,
            variant: "error",
          });
        }

        selectedAccounts.value = [];
        confirmBulkDelete.value = false;
        await getServiceAccountsUsers();
      } catch (err: any) {
        if (err.response?.status != 403 || err?.status != 403) {
          toast({
            message: err?.response?.data?.message || err?.message || "Error while deleting service accounts",
            variant: "error",
          });
        }
      }
    };

    const refreshServiceToken = async (row:any) =>{
      confirmRefresh.value = false;
      row.isLoading = true;
      await service_accounts.refresh_token(store.state.selectedOrganization.identifier,row.email).then((res)=>{
          serviceToken.value = res.data.token;
          isShowToken.value = true;

        toast({
          message: "Service token refreshed successfully.",
          variant: "success",
        });

        getServiceAccountsUsers();
      }).catch((err)=>{
        if(err.response?.status != 403){
          toast({
          message: err.response?.data?.message || "Error while refreshing token.",
          variant: "error",
          });
        }

      }).finally(()=>{
        row.isLoading = false;
      });

    }
    const downloadTokenAsFile = (token:string) => {
      const blob = new Blob([token], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "service_account_token.txt";
      link.click();
      URL.revokeObjectURL(link.href); // Cleanup
    };

    const isSystemAccount = (email: string) => {
      return email.startsWith('o2-sre-agent.org-') && email.endsWith('@openobserve.internal');
    };

    const confirmRefreshAction = (row: any) => {
      confirmRefresh.value = true;
      toBeRefreshed.value = row;
    };


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
      "visibility": "visibility",
      deleteUser,
      getServiceAccountsUsers,
      selectedUser,
      refreshServiceToken,
      copyToClipboard,
      downloadTokenAsFile,
      isShowToken,
      serviceToken,
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
      isSystemAccount,
    };
  },
});
</script>


<style lang="scss" scoped>
.warning-text {
  color: #ec960c;
}


</style>