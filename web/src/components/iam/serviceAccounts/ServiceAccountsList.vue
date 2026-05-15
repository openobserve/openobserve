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
  <div class="tw:rounded-md q-pa-none" style="min-height: inherit; height: calc(100vh - 44px);">
    <div>
      <div class="card-container tw:mb-[0.625rem]">
      <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:full-width tw:h-[68px] tw:border-b-[1px]"
      >

        <div
            class="q-table__title full-width tw:font-[600]"
            data-test="service-accounts-title-text"
          >
            {{ t("serviceAccounts.header") }}
          </div>
          <div class="full-width tw:flex tw:justify-end tw:gap-3">
            <OInput
                v-model="filterQuery"
                class="q-ml-auto no-border o2-search-input tw:h-[36px]"
                :placeholder="t('serviceAccounts.search')"
              >
                <template #prepend>
                  <q-icon class="o2-search-input-icon" name="search" />
                </template>
              </OInput>
              <OButton
                variant="primary"
                size="sm"
                @click="addRoutePush({})"
              >
                {{ t('serviceAccounts.add') }}
              </OButton>
          </div>
      </div>
      </div>
      <div class="tw:w-full tw:h-full">
        <div class="card-container tw:h-[calc(100vh-127px)]">
          <q-table
            ref="qTable"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            :rows="visibleRows"
            :columns="columns"
            row-key="email"
            selection="multiple"
            v-model:selected="selectedAccounts"
            :pagination="pagination"
            :filter="filterQuery"
            :style="hasVisibleRows ? 'height: calc(100vh - 127px); overflow-y: auto;' : ''"
          >
            <template #no-data>
              <NoData></NoData>
            </template>

            <template v-slot:body-selection="scope">
              <q-td auto-width>
                <OCheckbox v-model="scope.selected" class="o2-table-checkbox" :disabled="scope.row.is_system" />
              </q-td>
            </template>

            <template #body-cell-email="props">
              <q-td :props="props">
                <template v-if="props.row.is_system">
                  <span class="text-weight-medium">AI SRE Agent</span>
                  <q-badge color="blue-2" text-color="blue-8" label="system" class="q-ml-sm q-px-xs" style="font-size: 10px;" />
                </template>
                <template v-else>{{ props.row.email }}</template>
              </q-td>
            </template>

            <template #body-cell-first_name="props">
              <q-td :props="props">
                <template v-if="props.row.is_system && props.row.description">{{ props.row.description }}</template>
                <template v-else>{{ props.row.first_name }}</template>
              </q-td>
            </template>

            <template #body-cell-token="props">
            <q-td :props="props" side>
              <span class="tw:font-mono">{{ props.row.token || '************' }}</span>
            </q-td>
          </template>

            <template #body-cell-actions="props">
              <q-td :props="props" side>
                <template v-if="props.row.is_system">
                <q-badge color="grey-6" :label="t('serviceAccounts.systemManaged', 'System Managed')" class="q-px-sm q-py-xs">
                    <OTooltip v-if="props.row.description" :content="props.row.description" />
                  </q-badge>
                </template>
                <template v-else>
                  <OButton
                    data-test="service-accounts-refresh"
                    :title="t('serviceAccounts.refresh')"
                    variant="ghost"
                    size="icon-circle-sm"
                    @click="confirmRefreshAction(props.row)"
                  >
                    <q-icon name="refresh" />
                  </OButton>
                  <OButton
                    data-test="service-accounts-edit"
                    :title="t('serviceAccounts.update')"
                    variant="ghost"
                    size="icon-circle-sm"
                    @click="addRoutePush(props)"
                  >
                    <q-icon name="edit" />
                  </OButton>
                  <OButton
                    data-test="service-accounts-delete"
                    :title="t('serviceAccounts.delete')"
                    variant="ghost"
                    size="icon-circle-sm"
                    @click="confirmDeleteAction(props)"
                  >
                    <q-icon :name="outlinedDelete" />
                  </OButton>
                </template>
              </q-td>
            </template>
            <template #bottom="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                  {{ resultTotal }} {{ t('serviceAccounts.header') }}
                </div>
                <OButton
                  v-if="selectedAccounts.length > 0"
                  data-test="service-accounts-list-delete-accounts-btn"
                  variant="outline"
                  size="sm"
                  class="tw:mr-2"
                  @click="openBulkDeleteDialog"
                >
                  <template #icon-left><q-icon name="delete" /></template>
                  Delete
                </OButton>
                <QTablePagination
                  :scope="scope"
                  :resultTotal="resultTotal"
                  :perPageOptions="perPageOptions"
                  position="bottom"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </template>

            <template v-slot:header="props">
                  <q-tr :props="props">
                    <!-- Adding this block to render the select-all checkbox -->
                    <q-th v-if="columns.length > 0" auto-width>
                      <OCheckbox
                        v-model="props.selected"
                        :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                        class="o2-table-checkbox"
                      />
                    </q-th>

                    <!-- Rendering the rest of the columns -->
                    <q-th
                      v-for="col in props.cols"
                      :key="col.name"
                      :props="props"
                      :class="col.classes"
                      :style="col.style"
                    >
                      {{ col.label }}
                    </q-th>
                  </q-tr>
                </template>
          </q-table>
      </div>
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
    >
      <p>{{ t('serviceAccounts.confirmDeleteMsg') }}</p>
    </ODialog>

    <ODialog data-test="service-accounts-list-bulk-delete-dialog"
      v-model:open="confirmBulkDelete"
      size="xs"
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
          class="text-h6 text-center tw:truncate el-border"
          style="flex: 3; padding: 0.5rem; border-radius: 6px; font-family: monospace; text-align: center; overflow: hidden;"
        >
          {{ serviceToken }}
        </div>
        <!-- Buttons section taking 25% of the width -->
        <div class="tw:flex tw:justify-end tw:gap-1" style="flex: 1; max-width: 25%;">
          <OButton
            variant="outline"
            size="icon-md"
            :title="t('serviceAccounts.copyToken')"
            class="tw:mr-1"
            @click.stop="copyToClipboard(serviceToken)"
          >
            <q-icon name="content_copy" />
          </OButton>
          <OButton
            variant="outline"
            size="icon-md"
            :title="t('serviceAccounts.downloadToken')"
            @click.stop="downloadTokenAsFile(serviceToken)"
          >
            <q-icon name="file_download" />
          </OButton>
        </div>
      </div>

      <div class="q-pt-md flex items-center warning-text">
        <q-icon name="info" class="q-mr-xs" size="16px" />
        <span class="text-p">Make sure to copy / download the token. You will not be able to see it again.</span>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">

import { defineComponent, ref, onBeforeMount, onMounted, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps, date } from "quasar";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import AddServiceAccount from "./AddServiceAccount.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import usersService from "@/services/users";
import NoData from "@/components/shared/grid/NoData.vue";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import {
  getImageURL,
  verifyOrganizationStatus,
  maskText,
} from "@/utils/zincutils";
import { outlinedDelete,outlinedVisibility } from "@quasar/extras/material-icons-outlined";

// @ts-ignore
import usePermissions from "@/composables/iam/usePermissions";
import { computed, nextTick } from "vue";
import { getRoles } from "@/services/iam";
import service_accounts from "@/services/service_accounts";
import { useReo } from "@/services/reodotdev_analytics";
export default defineComponent({
  name: "ServiceAccountsList",
  components: { QTablePagination, NoData, AddServiceAccount, OButton, ODialog, OInput, OTooltip, OCheckbox },
  emits: [],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
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

      const query = router.currentRoute.value.query;
      if (query.action === "add") {
        addUser({}, false);
      } else if (query.action === "update" && query.email) {
        const match = serviceAccountsState.service_accounts_users.find(
          (m: any) => m.email === query.email,
        );
        if (match) addUser({ row: match }, true);
      }
    });

    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 67px;",
      },
      {
        name: "email",
        field: "email",
        label: t("user.email"),
        align: "left",
        sortable: true,
      },
      {
        name: "first_name",
        field: "first_name",
        label: t("user.description"),
        align: "left",
        sortable: true,
        style: "width: 150px;",
      },
      {
        name: "token",
        field: "token",
        label: t("serviceAccounts.token"),
        align: "left",
        sortable: false,
        style: "width: 230px;", //because token might take more space for displaying the token , eye button and copy button
      },
      {
        name: "actions",
        field: "actions",
        label: t("user.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
      },
    ]);
    const userEmail: any = ref("");
    const options = ref([{ label: "Admin", value: "admin" }]);
    const selectedRole = ref(options.value[0].value);
    const currentUserRole = ref("");
    let deleteUserEmail = "";

    interface OptionType {
      label: String;
      value: number | String;
    }
    const perPageOptions: any = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

    const currentUser = computed(() => store.state.userInfo.email);



    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    const confirmDeleteAction = (props: any) => {
      confirmDelete.value = true;
      deleteUserEmail = props.row.email;
    };
    const getServiceAccountsUsers = async () =>{
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading service accounts...",
      });

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
    const addRoutePush = (props: any) => {
      if (props.row != undefined) {
        router.push({
          name: "serviceAccounts",
          query: {
            action: "update",
            org_identifier: store.state.selectedOrganization.identifier,
            email: props.row.email,
          },
        });
        addUser(
          {
            row: props.row,
          },
          true
        );
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
            $q.notify({
              color: "positive",
              message: "Service Account created successfully.",
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

            serviceAccountsState.service_accounts_users.push(user);
            resultTotal.value = serviceAccountsState.service_accounts_users.length;
          }
        } else {
          setTimeout(() => {
            $q.notify({
              color: "positive",
              message: "Service Account updated successfully.",
            });
          }, 2000);
          serviceAccountsState.service_accounts_users.forEach((member: any, key: number) => {
            if (member.email == data.email) {
              serviceAccountsState.service_accounts_users[key] = {
                ...serviceAccountsState.service_accounts_users[key],
                ...data,
              };
            }
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
            $q.notify({
              color: "positive",
              message: "Service Account deleted successfully.",
            });
            await getServiceAccountsUsers();
          }
        })
        .catch((err: any) => {
          if(err.response?.status != 403){
            $q.notify({
            color: "negative",
            message: err.response?.data?.message || "Error while deleting user.",
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
          $q.notify({
            color: "positive",
            message: `Successfully deleted ${successful.length} service account(s)`,
            timeout: 2000,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          $q.notify({
            color: "warning",
            message: `Deleted ${successful.length} service account(s), but ${unsuccessful.length} failed`,
            timeout: 3000,
          });
        } else if (unsuccessful.length > 0) {
          $q.notify({
            color: "negative",
            message: `Failed to delete ${unsuccessful.length} service account(s)`,
            timeout: 2000,
          });
        }

        selectedAccounts.value = [];
        confirmBulkDelete.value = false;
        await getServiceAccountsUsers();
      } catch (err: any) {
        if (err.response?.status != 403 || err?.status != 403) {
          $q.notify({
            color: "negative",
            message: err?.response?.data?.message || err?.message || "Error while deleting service accounts",
            timeout: 2000,
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

        $q.notify({
          color: "positive",
          message: "Service token refreshed successfully.",
        });

        getServiceAccountsUsers();
      }).catch((err)=>{
        if(err.response?.status != 403){
          $q.notify({
          color: "negative",
          message: err.response?.data?.message || "Error while refreshing token.",
          });
        }

      }).finally(()=>{
        row.isLoading = false;
      });

    }
    const  copyToClipboard = (text:string) => {
      navigator.clipboard.writeText(text).then(() => {
        $q.notify({
            type: "positive",
            message: `token Copied Successfully!`,
            timeout: 5000,
          });
      }).catch(() => {
          $q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
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

    const filterData = (rows: any, terms: any) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (
          rows[i]["first_name"]?.toLowerCase().includes(terms) ||
          rows[i]["last_name"]?.toLowerCase().includes(terms) ||
          rows[i]["email"]?.toLowerCase().includes(terms)
        ) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return serviceAccountsState.service_accounts_users || []
      return filterData(serviceAccountsState.service_accounts_users || [], filterQuery.value)
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    return {
      $q,
      t,
      qTable,
      router,
      store,
      config,
      serviceAccountsState,
      columns,
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
      outlinedVisibility,
      deleteUser,
      getServiceAccountsUsers,
      pagination,
      resultTotal,
      selectedUser,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      changeMaxRecordToReturn,
      outlinedDelete,
      refreshServiceToken,
      copyToClipboard,
      downloadTokenAsFile,
      isShowToken,
      serviceToken,
      confirmRefreshAction,
      filterQuery,
      filterData,
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
      visibleRows,
      hasVisibleRows,
      selectedAccounts,
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