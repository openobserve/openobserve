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
  <q-page class="q-pa-none">
    <div>
    <div class="card-container tw:mb-[0.625rem]">
      <div class="tw:flex tw:flex-row tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
    >
      <div
          class="q-table__title tw:font-[600]"
          data-test="user-title-text"
        >
          {{ t("iam.basicUsers") }}
        </div>
        <div class="full-width tw:flex tw:justify-end tw:gap-3">
          <q-input
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw:h-[36px]"
              :placeholder="t('user.search')"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          <div class="col-6" v-if="config.isCloud == 'true'">
            <member-invitation
              :key="currentUserRole"
              v-model:currentrole="currentUserRole"
              @invite-sent="handleInviteSent"
            />
          </div>
          <div class="col-6" v-else>
            <OButton
              variant="primary"
              size="sm"
              @click="addRoutePush({})"
              data-test="add-basic-user"
            >
              {{ t('user.add') }}
            </OButton>
          </div>
        </div>
        </div>
    </div>
    <div class="tw:w-full">
      <div class="card-container" style="height: calc(100vh - var(--navbar-height) - 92px)">
        <q-table
          ref="qTable"
          :rows="visibleRows"
          :columns="columns"
          row-key="email"
          selection="multiple"
          v-model:selected="selectedUsers"
          :pagination="pagination"
          :filter="filterQuery"
          :style="hasVisibleRows ? 'height: calc(100vh - var(--navbar-height) - 92px); overflow-y: auto;' : ''"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        >
          <template #no-data>
            <NoData></NoData>
          </template>
          <template v-slot:body-selection="scope">
            <q-td auto-width>
              <q-checkbox
                v-model="scope.selected"
                size="sm"
                class="o2-table-checkbox"
                :disable="!scope.row.enableDelete"
              />
            </q-td>
          </template>
          <template v-slot:header="props">
            <q-tr :props="props">
              <!-- Adding this block to render the select-all checkbox -->
               <q-th v-if="columns.length > 0" auto-width>
                
                <q-checkbox
                  v-model="headerCheckboxValue"
                  size="sm"
                  toggle-indeterminate
                  :disable="selectableRows.length === 0"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-table-checkbox-dark'
                      : 'o2-table-checkbox-light'
                  "
                  class="o2-table-checkbox"
                />
              </q-th>

              <q-th v-for="col in props.cols"
              :class="col.classes"
              :style="col.style"
              :key="col.name" :props="props">
                <span>{{ col.label }}</span>
              </q-th>
            </q-tr>
          </template>
          <template #body-cell-auth_type="props">
            <q-td :props="props">
              <span
                class="role-badge"
                :class="props.row.is_external ? 'role-badge-sso' : 'role-badge-local'"
                :data-test="`auth-type-${props.row.email}`"
              >
                {{ props.row.auth_type }}
              </span>
            </q-td>
          </template>
          <template #body-cell-roles="props">
            <q-td :props="props">
              <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <span
                  class="role-badge role-badge-system"
                  :data-test="`role-chip-system-${props.row.email}`"
                >
                  {{ props.row.role }}
                </span>
                <template v-for="(r, i) in (props.row.custom_roles || []).slice(0, 2)" :key="r">
                  <span
                    class="role-badge role-badge-custom"
                    :data-test="`role-chip-custom-${props.row.email}-${i}`"
                  >
                    {{ r }}
                  </span>
                </template>
                <span
                  v-if="(props.row.custom_roles || []).length > 2"
                  class="role-badge role-badge-more"
                  :data-test="`role-chip-more-${props.row.email}`"
                >
                  +{{ (props.row.custom_roles || []).length - 2 }} more
                  <q-tooltip>
                    <div class="tw:flex tw:flex-col tw:gap-1">
                      <span v-for="r in (props.row.custom_roles || []).slice(2)" :key="r">{{ r }}</span>
                    </div>
                  </q-tooltip>
                </span>
                <q-spinner
                  v-if="props.row.custom_roles_loading"
                  size="14px"
                  color="grey-6"
                  :data-test="`role-loading-${props.row.email}`"
                />
              </div>
            </q-td>
          </template>
          <template #body-cell-actions="props">
            <q-td :props="props" side>
              <OButton
                v-if="props.row.enableDelete && props.row.status != 'pending'"
                :title="t('user.delete')"
                variant="ghost"
                size="icon-circle-sm"
                @click="confirmDeleteAction(props)"
                :data-test="`delete-basic-user-${props.row.email}`"
              >
                <q-icon :name="outlinedDelete" />
              </OButton>
              <OButton
                v-if="props.row.status == 'pending' && props.row.token"
                :title="t('user.revoke_invite')"
                variant="ghost"
                size="icon-circle-sm"
                @click="confirmRevokeAction(props)"
                :data-test="`revoke-invite-${props.row.email}`"
              >
                <q-icon name="cancel" />
              </OButton>
              <OButton
                v-if="props.row.enableEdit && props.row.status != 'pending' && config.isCloud == 'false'"
                :title="t('user.update')"
                variant="ghost"
                size="icon-circle-sm"
                @click="addRoutePush(props)"
                :data-test="`edit-basic-user-${props.row.email}`"
              >
                <q-icon name="edit" />
              </OButton>
            </q-td>
          </template>
          <template #bottom="scope">
            <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
              <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[230px] tw:mr-md">
                {{ resultTotal }}
                {{
                  resultTotal === 1
                    ? t("user.header")
                    : t("user.header") + "s"
                }}
              </div>
              <OButton
                v-if="selectedUsers.length > 0"
                data-test="users-list-delete-users-btn"
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
        </q-table>
        </div>
    </div>
    </div>

    <q-dialog
      v-if="config.isCloud == 'false'"
      v-model="showUpdateUserDialog"
      position="right"
      full-height
      maximized
    >
      <update-user-role v-model="selectedUser" @updated="updateMember" />
    </q-dialog>

    <q-dialog
      v-model="showAddUserDialog"
      position="right"
      full-height
      maximized
    >
      <add-user
        v-if="config.isCloud == 'false'"
        v-model="selectedUser"
        :isUpdated="isUpdated"
        :userRole="currentUserRole"
        :roles="options"
        :customRoles="customRoles"
        @updated="addMember"
        @cancel:hideform="hideForm"
      />
    </q-dialog>

    <q-dialog v-model="confirmDelete">
      <q-card style="width: 240px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("user.confirmDeleteHead") }}</div>
          <div class="para">{{ t("user.confirmDeleteMsg") }}</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <OButton v-close-popup="true" variant="outline" size="sm-action">
            {{ t("user.cancel") }}
          </OButton>
          <OButton
            v-close-popup="true"
            variant="primary"
            size="sm-action"
            @click="deleteUser"
          >
            {{ t("user.ok") }}
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="confirmRevoke">
      <q-card style="width: 400px">
        <q-card-section class="confirmBody">
          <div class="head">Revoke Invitation</div>
          <div class="para">Are you sure you want to revoke the invitation for {{ revokeInviteEmail }}?</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <OButton v-close-popup="true" variant="outline" size="sm-action">
            {{ t("user.cancel") }}
          </OButton>
          <OButton
            v-close-popup="true"
            variant="primary"
            size="sm-action"
            @click="revokeInvite"
          >
            {{ t("user.ok") }}
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="confirmBulkDelete">
      <q-card style="width: 280px">
        <q-card-section class="confirmBody">
          <div class="head">Delete Users</div>
          <div class="para">Are you sure you want to delete {{ selectedUsers.length }} user(s)?</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <OButton v-close-popup="true" variant="outline" size="sm-action">
            Cancel
          </OButton>
          <OButton
            v-close-popup="true"
            variant="primary"
            size="sm-action"
            @click="bulkDeleteUsers"
          >
            OK
          </OButton>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">

import { defineComponent, ref, onActivated, onBeforeMount, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, type QTableProps, date } from "quasar";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import usersService from "@/services/users";
import UpdateUserRole from "@/components/iam/users/UpdateRole.vue";
import AddUser from "@/components/iam/users/AddUser.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import MemberInvitation from "@/components/iam/users/MemberInvitation.vue";
import {
  getImageURL,
  verifyOrganizationStatus,
  maskText,
} from "@/utils/zincutils";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

// @ts-ignore
import usePermissions from "@/composables/iam/usePermissions";
import { computed, nextTick } from "vue";
import { getRoles as getCustomRolesApi, getRoleUsers } from "@/services/iam";

export default defineComponent({
  name: "UserPageOpenSource",
  components: {
    QTablePagination,
    UpdateUserRole,
    NoData,
    AddUser,
    MemberInvitation,
    OButton,
  },
  emits: [
    "updated:fields",
    "deleted:fields",
    "updated:dates",
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const resultTotal = ref<number>(0);
    const showUpdateUserDialog: any = ref(false);
    const showAddUserDialog: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmRevoke = ref<boolean>(false);
    const selectedUser: any = ref({});
    const orgData: any = ref(store.state.selectedOrganization);
    const isUpdated: any = ref(false);
    const qTable: any = ref(null);
    const { usersState } = usePermissions();
    const isEnterprise = ref(false);
    const isCurrentUserInternal = ref(false);
    const filterQuery = ref("");

    const toCamelCase = (str: string) => {
      return str.charAt(0).toUpperCase() + str.slice(1);
    };
    const selectedUsers: any = ref([]);
    const confirmBulkDelete = ref(false);

    onActivated(() => {
      if (router.currentRoute.value.query.action == "add") {
        addUser({}, false);
      } else {
        usersState.users.map((member: any) => {
          if (member.email == router.currentRoute.value.query.email) {
            addUser({ row: member }, true);
          }
        });
      }
    });

    onBeforeMount(async () => {
      isEnterprise.value = config.isEnterprise == "true";
      await getOrgMembers();
      updateUserActions();
      await getRoles();
      await getCustomRoles();

      // if (config.isCloud == "true") {
        // columns.value.push({
        //   name: "status",
        //   field: "status",
        //   label: t("user.status"),
        //   align: "left",
        // });
      // }

      // if (
      //   (isEnterprise.value && isCurrentUserInternal.value) ||
      //   !isEnterprise.value
      // ) {
      //   columns.value.push({
      //     name: "actions",
      //     field: "actions",
      //     label: t("user.actions"),
      //     align: "left",
      //   });
      // }

      updateUserActions();
    });

    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 67px",
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
        label: t("user.firstName"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "last_name",
        field: "last_name",
        label: t("user.lastName"),
        align: "left",
        sortable: true,
        style: "width: 150px",
      },
      {
        name: "auth_type",
        field: "auth_type",
        label: t("user.authType"),
        align: "left",
        sortable: true,
        style: "width: 100px",
      },
      {
        name: "roles",
        field: "roles",
        label: t("user.roles"),
        align: "left",
        sortable: false,
        style: "min-width: 240px",
      },
      {
        name: "actions",
        field: "actions",
        label: t("user.actions"),
        align: "center",
        classes: 'actions-column',
        style: "width: 100px"
      },
    ]);
    const userEmail: any = ref("");
    const options = ref([]);
    const customRoles = ref([]);
    const selectedRole = ref();
    const currentUserRole = ref("");
    let deleteUserEmail = "";
    let revokeInviteToken = "";
    const revokeInviteEmail = ref("");

    const getRoles = () => {
      return new Promise((resolve) => {
        usersService
          .getRoles(store.state.selectedOrganization.identifier)
          .then((res) => {
            options.value = res.data;
          })
          .finally(() => resolve(true));
      });
    };
    const getCustomRoles = async () => {
      if (config.isEnterprise !== "true" && config.isCloud !== "true") return;
      try {
        const res = await getCustomRolesApi(
          store.state.selectedOrganization.identifier,
        );
        customRoles.value = Array.isArray(res.data) ? res.data : [];
      } catch (err: any) {
        if (err?.response?.status !== 403) {
          $q.notify({
            color: "negative",
            message:
              err?.response?.data?.message ||
              "Failed to load custom roles.",
            timeout: 3000,
          });
        }
      }
    };

    const getInvitedMembers = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading users...",
      });

      return new Promise((resolve, reject) => {
        usersService
          .invitedUsers(store.state.selectedOrganization.identifier)
          .then((res) => {
            if(res.status == 200) {
              dismiss();
              resolve(res.data);
            } else {
              dismiss();
              resolve([]);
            }
          })
          .catch(() => {
            dismiss();
            reject([]);
          });
      });
    }

    let hydrateGeneration = 0;

    // Inverts OFGA per-role memberships into per-user role lists.
    // Cost: O(R) HTTP calls where R is the number of custom roles,
    // independent of the user count.
    const hydrateCustomRoles = async () => {
      const myGen = ++hydrateGeneration;
      const orgId = store.state.selectedOrganization.identifier;
      const targets = usersState.users.filter(
        (u: any) => u.rawEmail && u.status !== "pending",
      );
      if (targets.length === 0) return;

      const byEmail = new Map<string, any>();
      for (const u of targets) {
        byEmail.set(u.rawEmail.toLowerCase(), u);
      }

      if (!Array.isArray(customRoles.value) || customRoles.value.length === 0) {
        await getCustomRoles();
        if (myGen !== hydrateGeneration) return;
      }
      const roleNames: string[] = Array.isArray(customRoles.value)
        ? (customRoles.value as string[])
        : [];

      try {
        const results = await Promise.all(
          roleNames.map((role) =>
            getRoleUsers(role, orgId)
              .then((r) => ({ role, emails: Array.isArray(r.data) ? r.data : [] }))
              .catch(() => ({ role, emails: [] as string[] })),
          ),
        );
        if (myGen !== hydrateGeneration) return;

        for (const { role, emails } of results) {
          for (const email of emails) {
            const row = byEmail.get(String(email).toLowerCase());
            if (row) row.custom_roles.push(role);
          }
        }
      } finally {
        if (myGen === hydrateGeneration) {
          for (const u of targets) {
            u.custom_roles_loading = false;
          }
        }
      }
    };

    const getOrgMembers = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading users...",
      });

      return new Promise((resolve, reject) => {
        usersService
          .orgUsers(store.state.selectedOrganization.identifier)
          .then(async (res) => {
            resultTotal.value = res.data.data.length;
            let users = [...res.data.data];

            if (config.isCloud == "true") {
              const invitedMembers: any = await getInvitedMembers();
              resultTotal.value += invitedMembers.length;
              users = [...res.data.data, ...invitedMembers];
            }
            
            let counter = 1;
            currentUserRole.value = "";
            usersState.users = users.map((data: any) => {
              if (store.state.userInfo.email?.toLowerCase() == data.email?.toLowerCase()) {
                currentUserRole.value = data.role?.toLowerCase();
                isCurrentUserInternal.value = !data.is_external;
              }

              if (data.email?.toLowerCase() == router.currentRoute.value.query.email?.toString().toLowerCase()) {
                addUser({ row: data }, true);
              }

              const isPending = data?.status == "pending";
              return {
                "#": counter <= 9 ? `0${counter++}` : counter++,
                email: maskText(data.email),
                rawEmail: data.email,
                first_name: data.first_name,
                last_name: data.last_name,
                role: isPending ? toCamelCase(data.role) + " (Invited)": toCamelCase(data.role),
                prebuiltRole: toCamelCase(data.role || ""),
                auth_type: data?.is_external ? t("user.authTypeSSO") : t("user.authTypeLocal"),
                is_external: !!data?.is_external,
                custom_roles: [] as string[],
                custom_roles_loading: !isPending,
                enableEdit: store.state.userInfo.email?.toLowerCase() == data.email?.toLowerCase() ? true : false,
                enableChangeRole: false,
                enableDelete: config.isCloud == "true" ? true : false,
                status: data?.status,
                token: data?.token || null,
              };
            });

            dismiss();
            resolve(true);
            // Lazy-load custom roles per user in the background so the
            // table renders immediately. Concurrency-capped to avoid
            // saturating the browser/network with many users.
            void hydrateCustomRoles();
          })
          .catch(() => {
            dismiss();
            reject(false);
          });
      });
    };

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
    const maxRecordToReturn = ref<number>(500);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

    // const showAddUserBtn = computed(() => {
    //   if (isEnterprise.value) {
    //     return (
    //       isCurrentUserInternal.value &&
    //       (currentUserRole.value == "admin" || currentUserRole.value == "root")
    //     );
    //   } else {
    //     return (
    //       currentUserRole.value == "admin" || currentUserRole.value == "root"
    //     );
    //   }
    // });

    const currentUser = computed(() => store.state.userInfo.email);

    const updateUserActions = () => {
      usersState.users.forEach((member: any) => {
        member.enableEdit = shouldAllowEdit(member);
        member.enableChangeRole = shouldAllowChangeRole(member);
        member.enableDelete = shouldAllowDelete(member);
      });
    };

    // const shouldAllowEdit = (user: any) => {
    //   if (isEnterprise.value) {
    //     return (
    //       isCurrentUserInternal.value &&
    //       !user.isExternal &&
    //       (currentUserRole.value == "root" ||
    //         (currentUserRole.value == "admin" && user.role !== "root"))
    //     );
    //   } else {
    //     return (
    //       user.isLoggedinUser ||
    //       currentUserRole.value == "root" ||
    //       (currentUserRole.value == "admin" && user.role !== "root")
    //     );
    //   }
    // };
    const shouldAllowEdit = (user: any) => {
      // Allow editing for root users only if the current user is root
      if (user.role?.toLowerCase() === "root") {
        return store.state.userInfo.email === user.email;
      }
      // Allow editing for all other users
      return true;
    };

    const shouldAllowChangeRole = (user: any) => {
      if (isEnterprise.value) {
        return (
          isCurrentUserInternal.value &&
          !user.isExternal &&
          user.role?.toLowerCase() !== "root" &&
          (currentUserRole.value == "root" || currentUserRole.value == "admin")
        );
      } else {
        return (
          ((currentUserRole.value == "admin" && user.role?.toLowerCase() !== "root") ||
            currentUserRole.value == "root") &&
          !user.isLoggedinUser
        );
      }
    };

    const shouldAllowDelete = (user: any) => {

      if (isEnterprise.value) {
      //for cloud
      //should allow delete for all users when it is root and also when the row user is not root
      //should allow delete for all users when it is admin and also when the row user is not logged in user / not root
        if(config.isCloud == 'true'){
          return (
            user.role?.toLowerCase() !== "root" &&
            (currentUserRole.value == "root" ||
              currentUserRole.value == "admin") &&
              store.state.userInfo.email.toLowerCase() !== user.email.toLowerCase()

          );
        }
        return (
          isCurrentUserInternal.value &&
          !user.isExternal &&
          user.role?.toLowerCase() !== "root" &&
          (currentUserRole.value == "root" ||
            currentUserRole.value == "admin") &&
          !user.isLoggedinUser
        );
      } else {
        return (
          (currentUserRole.value == "admin" ||
            currentUserRole.value == "root") &&
          !user.isLoggedinUser &&
          user.role?.toLowerCase() !== "root"
        );
      }
    };

    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    const updateUser = (props: any) => {
      selectedUser.value = props.row;
      showUpdateUserDialog.value = true;
    };

    const addUser = (props: any, is_updated: boolean) => {
      isUpdated.value = is_updated;
      selectedUser.value.organization =
        store.state.selectedOrganization.identifier;

      if (props.row != undefined) {
        selectedUser.value = props.row;
        segment.track("Button Click", {
          button: "Actions",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          update_user: props.row.email,
          page: "Users",
        });
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
          name: "users",
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
          true,
        );
      } else {
        addUser({}, false);
        router.push({
          name: "users",
          query: {
            action: "add",
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    };
    const toggleExpand = (row: any) => {
      if (!row.showGroups) {
        row.showGroups = true;
        fetchUserGroups(row.email);
        fetchUserRoles(row.email);
      } else {
        row.showGroups = false;
      }
    };
    const forceCloseRow = (row: any) => {
      if (row.showGroups) {
        row.showGroups = false;
      }
    };
    const fetchUserGroups = (userEmail: any) => {
      const orgId = store.state.selectedOrganization.identifier;
      usersService.getUserGroups(orgId, userEmail).then((response) => {
        // Update the user_groups property in the row object
        const updatedUsers = usersState.users.map((user) => {
          if (user.email === userEmail) {
            return {
              ...user,
              user_groups: response.data.join(", "),
              // user_groups: response.data
            };
          }
          return user;
        });
        usersState.users = updatedUsers;
      });
    };
    const fetchUserRoles = (userEmail: any) => {
      const orgId = store.state.selectedOrganization.identifier;
      usersService.getUserRoles(orgId, userEmail).then((response) => {
        // Update the user_roles property in the row object
        const updatedUsers = usersState.users.map((user) => {
          if (user.email === userEmail) {
            return {
              ...user,
              user_roles: response.data.join(", "),
              // user_roles: response.data
            };
          }
          return user;
        });
        usersState.users = updatedUsers;
      });
    };

    const updateMember = async (data: any) => {
      if (data.data != undefined) {
        try {
          await getOrgMembers();
        } catch (error) {
          $q.notify({
            color: "negative",
            message: "Failed to refresh user list",
          });
        }
        updateUserActions();
        showUpdateUserDialog.value = false;
      }
    };

    const hideForm = () => {
      showAddUserDialog.value = false;
      router.replace({
        name: "users",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const addMember = async (res: any, data: any, operationType: string) => {
      showAddUserDialog.value = false;
      if (res.code == 200) {
        router.push({
          name: "users",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        await getOrgMembers();
        updateUserActions();
        if (operationType == "created") {
          $q.notify({
            color: "positive",
            message: "User added successfully.",
          });
          // if (
          //   store.state.selectedOrganization.identifier == data.organization
          // ) {
          //   const user = {
          //     "#":
          //       usersState.users.length + 1 <= 9
          //         ? `0${usersState.users.length + 1}`
          //         : usersState.users.length + 1,
          //     email: data.email,
          //     first_name: data.first_name,
          //     last_name: data.last_name,
          //     role: data.role,
          //     isExternal: false,
          //     enableEdit: false,
          //     enableChangeRole: false,
          //     enableDelete: false,
          //   };

          //   user["enableEdit"] = shouldAllowEdit(user);
          //   user["enableChangeRole"] = shouldAllowChangeRole(user);
          //   user["enableDelete"] = shouldAllowDelete(user);

          //   usersState.users.push(user);
          // }
        } else {
          $q.notify({
            color: "positive",
            message: "User updated successfully.",
          });
          // usersState.users.forEach((member: any, key: number) => {
          //   if (member.email == data.email) {
          //     usersState.users[key] = {
          //       ...usersState.users[key],
          //       ...data,
          //     };
          //   }
          // });
        }
      }
      router.replace({
        name: "users",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const confirmDeleteAction = (props: any) => {
      confirmDelete.value = true;
      deleteUserEmail = props.row.email;
    };

    const deleteUser = async () => {
      usersService
        .delete(store.state.selectedOrganization.identifier, deleteUserEmail)
        .then(async (res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              color: "positive",
              message: "User deleted successfully.",
            });
            await getOrgMembers();
            updateUserActions();
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            $q.notify({
              color: "negative",
              message: "Error while deleting user.",
            });
          }
        });
    };

    const confirmRevokeAction = (props: any) => {
      confirmRevoke.value = true;
      revokeInviteToken = props.row.token;
      revokeInviteEmail.value = props.row.email;
    };

    const revokeInvite = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      organizationsService
        .revoke_invite(store.state.selectedOrganization.identifier, revokeInviteToken)
        .then(async (res: any) => {
          dismiss();
          $q.notify({
            color: "positive",
            message: "Invitation revoked successfully.",
            timeout: 3000,
          });
          await getOrgMembers();
          updateUserActions();

          segment.track("Button Click", {
            button: "Revoke Invite",
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            page: "Users",
          });
        })
        .catch((err: any) => {
          dismiss();
          $q.notify({
            color: "negative",
            message: err?.response?.data?.message || "Error while revoking invitation.",
            timeout: 5000,
          });
        });
    };

    const handleInviteSent = async () => {
      await getOrgMembers();
      updateUserActions();
    };

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteUsers = async () => {
      const userEmails = selectedUsers.value.map((user: any) => user.email);

      try {
        const res = await usersService.bulkDelete(
          store.state.selectedOrganization.identifier,
          { ids: userEmails }
        );
        const { successful, unsuccessful } = res.data;

        if (successful.length > 0 && unsuccessful.length === 0) {
          $q.notify({
            color: "positive",
            message: `Successfully deleted ${successful.length} user(s)`,
            timeout: 2000,
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          $q.notify({
            color: "warning",
            message: `Deleted ${successful.length} user(s), but ${unsuccessful.length} failed`,
            timeout: 3000,
          });
        } else if (unsuccessful.length > 0) {
          $q.notify({
            color: "negative",
            message: `Failed to delete ${unsuccessful.length} user(s)`,
            timeout: 2000,
          });
        }

        selectedUsers.value = [];
        confirmBulkDelete.value = false;
        await getOrgMembers();
        updateUserActions();
      } catch (err: any) {
        if (err.response?.status != 403 || err?.status != 403) {
          $q.notify({
            color: "negative",
            message: err.response?.data?.message || err?.message || "Error while deleting users",
            timeout: 2000,
          });
        }
      }
    };

    const updateUserRole = (row: any) => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      organizationsService
        .update_member_role(
          {
            id: parseInt(row.orgMemberId ? row.orgMemberId : row.org_member_id),
            role: row.role,
            email: row.email,
            organization_id: parseInt(store.state.selectedOrganization.id),
          },
          store.state.selectedOrganization.identifier,
        )
        .then((res: { data: any }) => {
          if (res.data.error_members != null) {
            const message = `Error while updating organization member`;
            $q.notify({
              type: "negative",
              message: message,
              timeout: 15000,
            });
          } else {
            $q.notify({
              type: "positive",
              message: "Organization member updated successfully.",
              timeout: 3000,
            });
          }
          dismiss();
        })
        .catch((error) => {
          dismiss();
          console.log(error);
        });

      segment.track("Button Click", {
        button: "Update Role",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        update_user: row.email,
        page: "Users",
      });
    };

    const filterData = (rows: any, terms: any) => {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["first_name"]?.toLowerCase().includes(terms) ||
            rows[i]["last_name"]?.toLowerCase().includes(terms) ||
            rows[i]["email"]?.toLowerCase().includes(terms) ||
            rows[i]["role"].toLowerCase().includes(terms) ||
            (rows[i]["auth_type"] || "").toLowerCase().includes(terms) ||
            (rows[i]["custom_roles"] || []).some((r: string) =>
              (r || "").toLowerCase().includes(terms),
            )
          ) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      };

      const visibleRows = computed(() => {
      if (!filterQuery.value) return usersState.users || []
      return filterData(usersState.users || [], filterQuery.value)
    });
    const hasVisibleRows = computed(() => visibleRows.value.length > 0);

    const selectableRows = computed(() =>
      visibleRows.value.filter((row: any) => row.enableDelete)
    );

    const headerCheckboxValue = computed({
      get() {
        if (selectableRows.value.length === 0) return false;
        const selectedCount = selectableRows.value.filter((row: any) =>
          selectedUsers.value.some((u: any) => u.email === row.email)
        ).length;
        if (selectedCount === 0) return false;
        if (selectedCount === selectableRows.value.length) return true;
        return null; // indeterminate: some but not all selectable rows selected
      },
      set(val: boolean | null) {
        if (val) {
          selectedUsers.value = [...selectableRows.value];
        } else {
          selectedUsers.value = [];
        }
      },
    });

    // Watch visibleRows to sync resultTotal with search filter
    watch(visibleRows, (newVisibleRows) => {
      resultTotal.value = newVisibleRows.length;
    }, { immediate: true });

    // Watch selectedUsers to filter out disabled rows
    watch(selectedUsers, (newSelectedUsers) => {
      // Filter out any disabled rows (those with enableDelete = false)
      const onlyEnabledSelected = newSelectedUsers.filter((user: any) => user.enableDelete);

      // If any disabled rows were selected, update to only include enabled ones
      if (onlyEnabledSelected.length !== newSelectedUsers.length) {
        selectedUsers.value = onlyEnabledSelected;
      }
    });

    return {
      t,
      qTable,
      router,
      store,
      config,
      usersState,
      columns,
      orgData,
      confirmDelete,
      deleteUser,
      confirmDeleteAction,
      confirmRevoke,
      revokeInvite,
      revokeInviteEmail,
      confirmRevokeAction,
      handleInviteSent,
      getOrgMembers,
      updateUser,
      updateMember,
      addUser,
      addRoutePush,
      addMember,
      hideForm,
      isUpdated,
      showAddUserDialog,
      pagination,
      resultTotal,
      selectedUser,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      showUpdateUserDialog,
      changeMaxRecordToReturn,
      outlinedDelete,
      filterQuery,
      fetchUserGroups,
      toggleExpand,
      forceCloseRow,
      filterData,
      userEmail,
      selectedRole,
      options,
      customRoles,
      currentUserRole,
      updateUserRole,
      getImageURL,
      verifyOrganizationStatus,
      isEnterprise,
      isCurrentUserInternal,
      getRoles,
      getCustomRoles,
      getInvitedMembers,
      updateUserActions,
      shouldAllowEdit,
      shouldAllowChangeRole,
      shouldAllowDelete,
      fetchUserRoles,
      visibleRows,
      hasVisibleRows,
      selectableRows,
      headerCheckboxValue,
      selectedUsers,
      confirmBulkDelete,
      openBulkDeleteDialog,
      bulkDeleteUsers,
      // showAddUserBtn,
    };
  },
});
</script>

<style lang="scss" scoped>

.iconHoverBtn {
  cursor: pointer !important;
}

.confirmBody {
  padding: 11px 1.375rem 0;
  font-size: 0.875rem;
  text-align: center;
  font-weight: 700;

  .head {
    line-height: 2.125rem;
    margin-bottom: 0.5rem;
    color: $dark-page;
  }

  .para {
    color: $light-text;
  }
}

.confirmActions {
  justify-content: center;
  padding: 1.25rem 1.375rem 1.625rem;
  display: flex;

  .q-btn {
    font-size: 0.75rem;
    font-weight: 700;
  }
}

.non-selectable {
  cursor: default !important;
}

.invite-user {
  background: $input-bg;
  border-radius: 4px;

  .separator {
    width: 1px;
  }
}

.inputHint {
  font-size: 11px;
  color: $light-text;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  padding: 4px 10px;
  border-radius: 6px;
  background-color: transparent;
  white-space: nowrap;
}

.role-badge-system {
  color: #8a6a1f;
  border: 1px solid #8a6a1f;
}

.role-badge-custom {
  color: #a04545;
  border: 1px solid #a04545;
  font-weight: 700;
}

.role-badge-more {
  color: #a04545;
  border: 1px solid #a04545;
  cursor: pointer;
}

.role-badge-sso {
  color: #1f6f8b;
  border: 1px solid #1f6f8b;
}

.role-badge-local {
  color: #4a4a4a;
  border: 1px solid #4a4a4a;
}
</style>
