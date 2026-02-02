<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="q-pa-none" style="min-height: inherit; height: calc(100vh - 44px);">
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
          <div class="full-width tw:flex tw:justify-end">
            <q-input
                v-model="filterQuery"
                borderless
                dense
                class="q-ml-auto no-border o2-search-input tw:h-[36px]"
                :placeholder="t('serviceAccounts.search')"
              >
                <template #prepend>
                  <q-icon class="o2-search-input-icon" name="search" />
                </template>
              </q-input>
              <q-btn
                class="q-ml-sm o2-primary-button tw:h-[36px]"
                flat
                no-caps
                :label="t(`serviceAccounts.add`)"
                @click="addRoutePush({})"
              />
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
                <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
              </q-td>
            </template>

            <template #body-cell-token="props">
            <q-td :props="props" side >
              <div class="tw:flex tw:items-center" v-if="props.row.isLoading">
                <q-spinner-dots color="primary"  />
              </div>
              <!-- Display the token or masked text based on visibility -->
            <div v-else  class="tw:flex tw:items-center">
              <span 
                style="
                display: inline-block;
                width: 150px; /* Set a fixed width */
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-align: center;
              "
                >
                {{ getDisplayToken(props.row) }}
                </span>

                <!-- Button to fetch or toggle token visibility -->
                <q-btn
                  :icon="props.row.isTokenVisible ? 'visibility_off' : 'visibility'"
                  :title="props.row.isTokenVisible ? t('serviceAccounts.hideToken') : t('serviceAccounts.showToken')"
                  unelevated
                  size="sm"
                  round
                  flat
                  style="cursor: pointer !important; "
                  @click="getServiceToken(props.row)"
                />
                <q-btn
                  @click.stop="copyToClipboard(props.row.token)"
                  size="sm"
                  dense
                  flat
                  :title="t('serviceAccounts.copyToken')"
                  icon="content_copy"
                  :disable="!props.row.token"
                  :class="{ 'disabled-opacity': !props.row.token }"
                  class="copy-btn-sql"
                />
              </div>
            </q-td>
          </template>

            <template #body-cell-actions="props">
              <q-td :props="props" side>
                <q-btn
                  data-test="service-accounts-refresh"
                  :title="t('serviceAccounts.refresh')"
                  icon="refresh"
                  class="q-ml-xs"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  style="cursor: pointer !important"
                  @click="confirmRefreshAction(props.row)"
                >
                </q-btn>
                <q-btn
                  data-test="service-accounts-edit"
                  :title="t('serviceAccounts.update')"
                  icon="edit"
                  class="q-ml-xs"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  @click="addRoutePush(props)"
                  style="cursor: pointer !important"
                >
                </q-btn>
                <q-btn
                  data-test="service-accounts-delete"
                  :title="t('serviceAccounts.delete')"
                  class="q-ml-xs"
                  :icon="outlinedDelete"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  style="cursor: pointer !important"
                  @click="confirmDeleteAction(props)"
                >
                </q-btn>

              </q-td>
            </template>
            <template #bottom="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                  {{ resultTotal }} {{ t('serviceAccounts.header') }}
                </div>
                <q-btn
                  v-if="selectedAccounts.length > 0"
                  data-test="service-accounts-list-delete-accounts-btn"
                  class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-secondary-button-dark'
                      : 'o2-secondary-button-light'
                  "
                  no-caps
                  dense
                  @click="openBulkDeleteDialog"
                >
                  <q-icon name="delete" size="16px" />
                  <span class="tw:ml-2">Delete</span>
                </q-btn>
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
                      <q-checkbox
                        v-model="props.selected"
                        size="sm"
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
    <q-dialog
      v-model="showAddUserDialog"
      position="right"
      full-height
      maximized
    >
      <add-service-account
        style="width: 30vw"
        v-model="selectedUser"
        :isUpdated="isUpdated"
        @updated="addMember"
        @cancel:hideform="hideForm"
      />
    </q-dialog>

    <q-dialog v-model="confirmRefresh">
      <q-card style="width: 240px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("serviceAccounts.confirmRefreshHead") }}</div>
          <div class="para">{{ t("serviceAccounts.confirmRefreshMsg") }}</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="q-mr-sm"
            data-test="cancel-refresh-service-token"
          >
            {{ t("user.cancel") }}
          </q-btn>
          <q-btn
            data-test="confirm-refresh-service-token"
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="refreshServiceToken(toBeRefreshed,false)"
          >
            {{ t("user.ok") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="confirmDelete">
      <q-card style="width: 240px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("serviceAccounts.confirmDeleteHead") }}</div>
          <div class="para">{{ t("serviceAccounts.confirmDeleteMsg") }}</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            {{ t("user.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="deleteUser"
          >
            {{ t("user.ok") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="confirmBulkDelete">
      <q-card style="width: 280px">
        <q-card-section class="confirmBody">
          <div class="head">Delete Service Accounts</div>
          <div class="para">Are you sure you want to delete {{ selectedAccounts.length }} service account(s)?</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            Cancel
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="primary"
            @click="bulkDeleteServiceAccounts"
          >
            OK
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="isShowToken"  persistent>
  <q-card style="width: 40vw; max-height: 90vh; overflow-y: auto;">
    <q-card-section  class="text-h6 dialog-heading tw:flex tw:justify-between tw:items-center" >
      <div>Service Account Token </div>
          <q-btn data-test="sa-cancel-button" dense flat icon="cancel" size="md" @click="isShowToken = false" style="cursor: pointer" />
    </q-card-section>

    <q-card-section>

      <div class="tw:flex tw:items-center tw:gap-2" style="padding: 0rem 1rem;  border-radius: 8px;">
  <!-- Token section taking 75% of the width -->
  <div
    class="text-h6 text-center tw:truncate el-border"
    style="flex: 3;  padding: 0.5rem; border-radius: 6px; font-family: monospace; text-align: center; overflow: hidden;"
  >
    {{  serviceToken }}
  </div>
  <!-- Buttons section taking 25% of the width -->
  <div class="tw:flex tw:justify-end tw:gap-1" style="flex: 1; max-width: 25%;">
    <q-btn
      @click.stop="copyToClipboard(serviceToken)"
      size="lg"
      dense
      outline
      :title="t('serviceAccounts.copyToken')"
      icon="content_copy"
      class="q-mr-xs"
    />
    <q-btn
      @click.stop="downloadTokenAsFile(serviceToken)"
      size="lg"
      dense
      outline
      :title="t('serviceAccounts.downloadToken')"
      icon="file_download"
    />
  </div>
  
</div>

    <div class="q-pt-md flex items-center warning-text">
      <q-icon name="info" class="q-mr-xs " size="16px" />
      <span class="text-p">Make sure to copy / download the token. You will not be able to see it again.
      </span>
    </div>
   
    </q-card-section>

  </q-card>
</q-dialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onActivated, onBeforeMount, onMounted, watch } from "vue";
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
  components: { QTablePagination,  NoData,AddServiceAccount, },
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

    onBeforeMount(()=>{
      getServiceAccountsUsers();
    })

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
    const getServiceToken = async (row:any, fromColum = true) =>{
      if(fromColum){ row.isLoading = true;
        if(!row.isTokenVisible){
          row.isTokenVisible = true;
          setTimeout(() => {
            row.isTokenVisible = false;
          }, 5 * 60 * 1000);
        }
        else{
          row.isTokenVisible = false;
        }
      if(row.token){
        row.isLoading = false;
        return;
      }
      }
       service_accounts.get_service_token(store.state.selectedOrganization.identifier,row.email).then((res)=>{
        if(fromColum) row.token = res.data.token;
        else serviceToken.value = res.data.token;
       }).catch((err)=>{
        if(err.response?.status != 403){
          $q.notify({
          color: "negative",
          message: `Error fetching token: ${err.response?.data?.message || 'Unknown error'}`,
          });
        }
        
       }).finally(()=>{
        row.isLoading = false;
       });
    }


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
                isTokenVisible: false,
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

    const addMember = async (res: any, data: any, operationType: string) => {
      showAddUserDialog.value = false;
      if (res.code == 200 ) {
        if (operationType == "created") {
            $q.notify({
              color: "positive",
              message: "Service Account created successfully.",
            });

          await getServiceToken(data, false);
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
      const accountEmails = selectedAccounts.value.map((account: any) => account.email);

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

    const refreshServiceToken = async (row:any,fromColum = true) =>{
      if(fromColum) row.isLoading = true;
      await service_accounts.refresh_token(store.state.selectedOrganization.identifier,row.email).then((res)=>{
          row.token = res.data.token;
          serviceToken.value = res.data.token;
          row.isTokenVisible = true;
          isShowToken.value = true;

        $q.notify({
          color: "positive",
          message: "Service token refreshed successfully.",
        });
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

    const confirmRefreshAction = (row: any) => {
      confirmRefresh.value = true;
      toBeRefreshed.value = row;
    };

    const getDisplayToken = (row: any): string => {
      if (!row.token) return '* * * * * * * * * * * * * * * *';
      if (!row.isTokenVisible) return '* * * * * * * * * * * * * * * *';
      return maskToken(row.token);
    };

    const maskToken = (token: string): string => {
      if (token.length <= 8) return token;
      return `${token.slice(0, 4)} **** ${token.slice(-4)}`;
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
      getServiceToken,
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
      getDisplayToken,
      maskToken,
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
    };
  },
});
</script>


<style lang="scss" scoped>
.disabled-opacity {
  opacity: 0.1 !important;
}
.warning-text {
  color: #ec960c;
}


</style>