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
    <!-- Standard page header: title + actions only. The user search moved into
         the table's own toolbar (built-in global filter) per the layout system. -->
    <AppPageHeader
      :title="t('iam.basicUsers')"
      :subtitle="'People with access to this organization'"
      icon="person"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <member-invitation
          v-if="config.isCloud == 'true'"
          :key="currentUserRole"
          v-model:currentrole="currentUserRole"
          @invite-sent="handleInviteSent"
        />
        <OButton
          v-else
          variant="primary"
          size="sm"
          @click="addRoutePush({})"
          data-test="add-basic-user"
        >
          {{ t('user.add') }}
        </OButton>
      </template>
    </AppPageHeader>
    <div class="tw:w-full tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <div class="card-container tw:h-full">
        <OTable
          :key="tableKey"
          :frame="false"
          :data="rows"
          :columns="columns"
          row-key="email"
          :loading="loading"
          :selected-ids="selectedUserIds"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('iam.basicUsers')"
          sorting="client"
          selection="multiple"
          :is-row-selectable="(row: any) => row.enableDelete"
          filter-mode="client"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-users-list"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('user.search')"
                data-test="user-list-search-input"
                class="tw:flex-1"
              />
            </div>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-users"
              :filtered="!!filterQuery"
              @action="
                (id) =>
                  id === 'clear-filters' ? (filterQuery = '') : addRoutePush({})
              "
            />
          </template>

          <!-- Auth type badge (Native / SSO / LDAP) — enterprise/cloud only -->
          <template #cell-auth="{ row }">
            <OBadge
              v-if="row.auth_type"
              :variant="row.auth_type === 'SSO' ? 'primary-outline' : 'default-outline'"
              size="sm"
              class="o2-role-chip"
            >
              {{ row.auth_type }}
            </OBadge>
          </template>

          <!-- Roles badges — yellow outline for built-in, red outline for custom.
               Built-in role names are displayed capitalised (Admin/Viewer/User),
               custom role names keep their original casing (nmcdev/admin/etc.). -->
          <template #cell-roles="{ row }">
            <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-1">
              <OBadge
                v-for="(roleName, idx) in (row.roles || [])"
                :key="`${roleName}-${idx}`"
                :variant="isBuiltinRole(roleName) ? 'warning-outline' : 'error-outline'"
                size="md"
                class="o2-role-chip"
              >
                {{ isBuiltinRole(roleName) ? toCamelCase(roleName) : roleName }}
              </OBadge>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <OButton
              v-if="row.enableDelete && row.status != 'pending'"
              :title="t('user.delete')"
              variant="ghost"
              size="icon-sm"
              :data-test="`delete-basic-user-${row.email}`"
              @click="confirmDeleteAction(row)"
            >
              <OIcon name="delete" size="sm" />
            </OButton>
            <OButton
              v-if="row.status == 'pending' && row.token"
              :title="t('user.revoke_invite')"
              variant="ghost"
              size="icon-sm"
              :data-test="`revoke-invite-${row.email}`"
              @click="confirmRevokeAction(row)"
            >
              <OIcon name="cancel" size="sm" />
            </OButton>
            <OButton
              v-if="row.enableEdit && row.status != 'pending'"
              :title="t('user.update')"
              variant="ghost"
              size="icon-sm"
              :data-test="`edit-basic-user-${row.email}`"
              @click="addRoutePush(row)"
            >
              <OIcon name="edit" size="sm" />
            </OButton>
          </template>
          <template #bottom>
            <span class="o2-table-footer-title tw:text-text-primary">{{ rows.length }} {{ isEnterpriseOrCloud ? (t('iam.organizationMembers') || 'Organization Members') : t('iam.basicUsers') }}</span>
            <OButton
              v-if="selectedUsers.length > 0"
              data-test="users-list-delete-users-btn"
              variant="outline-destructive"
              size="sm"
              icon-left="delete"
              @click="openBulkDeleteDialog"
            >
              Delete
            </OButton>
          </template>
        </OTable>
        </div>
    </div>
    
    <update-user-role
      v-if="config.isCloud == 'false'"
      v-model:open="showUpdateUserDialog"
      v-model="selectedUser"
      @updated="updateMember"
    />

    <add-user
      v-model:open="showAddUserDialog"
      v-model="selectedUser"
      :isUpdated="isUpdated"
      :userRole="currentUserRole"
      :roles="options"
      :customRoles="customRoles"
      :isCloud="config.isCloud == 'true'"
      @updated="addMember"
    />

    <ODialog data-test="user-delete-dialog"
      v-model:open="confirmDelete"
      size="sm"
      :title="t('user.confirmDeleteHead')"
      :secondary-button-label="t('user.cancel')"
      :primary-button-label="t('user.ok')"
      @click:secondary="confirmDelete = false"
      @click:primary="deleteUser"
    >
      <p>{{ t('user.confirmDeleteMsg') }}</p>
    </ODialog>

    <ODialog data-test="user-revoke-dialog"
      v-model:open="confirmRevoke"
      size="xs"
      title="Revoke Invitation"
      :secondary-button-label="t('user.cancel')"
      :primary-button-label="t('user.ok')"
      @click:secondary="confirmRevoke = false"
      @click:primary="revokeInvite"
    >
      <p>Are you sure you want to revoke the invitation for {{ revokeInviteEmail }}?</p>
    </ODialog>

    <ODialog data-test="user-bulk-delete-dialog"
      v-model:open="confirmBulkDelete"
      size="sm"
      title="Delete Users"
      secondary-button-label="Cancel"
      primary-button-label="OK"
      @click:secondary="confirmBulkDelete = false"
      @click:primary="bulkDeleteUsers"
    >
      <p>Are you sure you want to delete {{ selectedUsers.length }} user(s)?</p>
    </ODialog>
  </div>
</template>

<script lang="ts">

import { defineComponent, ref, onActivated, onBeforeMount, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";
import usersService from "@/services/users";
import UpdateUserRole from "@/components/iam/users/UpdateRole.vue";
import AddUser from "@/components/iam/users/AddUser.vue";
import organizationsService from "@/services/organizations";
import segment from "@/services/segment_analytics";
import MemberInvitation from "@/components/iam/users/MemberInvitation.vue";
import {
  getImageURL,
  verifyOrganizationStatus,
  maskText,
} from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

// @ts-ignore
import usePermissions from "@/composables/iam/usePermissions";
import { computed, nextTick } from "vue";
import { getRoles as getCustomRolesApi, getRoleUsers } from "@/services/iam";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "UserPageOpenSource",
  components: {
    AppPageHeader,
    OTable,
    UpdateUserRole,
    AddUser,
    MemberInvitation,
    OButton,
    OBadge,
    OIcon,
    ODialog,
    OEmptyState,
    OSearchInput,
  },
  emits: [
    "updated:fields",
    "deleted:fields",
    "updated:dates",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const showUpdateUserDialog: any = ref(false);
    const showAddUserDialog: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const confirmRevoke = ref<boolean>(false);
    const selectedUser: any = ref({});
    const orgData: any = ref(store.state.selectedOrganization);
    const isUpdated: any = ref(false);
    const { usersState } = usePermissions();
    const isEnterprise = ref(false);
    const isCurrentUserInternal = ref(false);
    const filterQuery = ref("");

    const toCamelCase = (str: string) => {
      return str.charAt(0).toUpperCase() + str.slice(1);
    };
    const selectedUsers: any = ref([]);
    const confirmBulkDelete = ref(false);
    const rows = ref<any[]>([]);
    const tableKey = ref(0);

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

      // Handle deep-linked / refreshed URL.
      // Only `action=update&email=…` auto-opens the dialog so a shared edit
      // link still lands directly on the user's edit form. `action=add` is
      // intentionally NOT handled here — the dialog only opens via the
      // "New user" button click; refreshing on an `action=add` URL should
      // leave the user on the list view, not pop a dialog on load.
      const query = router.currentRoute.value.query;
      if (query.action === "update" && query.email) {
        const match = usersState.users.find(
          (m: any) => m.email === query.email,
        );
        if (match) addUser({ row: match }, true);
      }
    });

    const isEnterpriseOrCloud =
      config.isEnterprise === "true" || config.isCloud === "true";

    const columns = computed<OTableColumnDef[]>(() => {
      const cols: OTableColumnDef[] = [
        {
          id: "#",
          header: "#",
          accessorFn: (row: any) => row["#"],
          size: TABLE_INDEX_COL_SIZE,
          minSize: 32,
          maxSize: 50,
          meta: { compactPadding: true, align: "left" },
        },
        {
          id: "email",
          header: t("user.email"),
          accessorKey: "email",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.email,
          minSize: 200,
          meta: { align: "left", flex: true },
        },
        {
          id: "first_name",
          header: t("user.firstName"),
          accessorKey: "first_name",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.firstName,
          meta: { align: "left", isName: true },
        },
        {
          id: "last_name",
          header: t("user.lastName"),
          accessorKey: "last_name",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.lastName,
          meta: { align: "left", isName: true },
        },
      ];

      // Auth column — only meaningful in enterprise/cloud where SSO/LDAP is in play
      if (isEnterpriseOrCloud) {
        cols.push({
          id: "auth",
          header: "Auth",
          accessorKey: "auth_type",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.authType,
          meta: { align: "left" },
        });
      }

      // Roles column — array of role chips in enterprise/cloud, single role string otherwise
      cols.push({
        id: isEnterpriseOrCloud ? "roles" : "role",
        header: isEnterpriseOrCloud ? "Roles" : t("user.role"),
        accessorKey: isEnterpriseOrCloud ? "roles" : "role",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.role,
        meta: { align: "left" },
      });

      cols.push({
        id: "actions",
        header: t("user.actions"),
        isAction: true,
        pinned: "right",
        size: 120,
        minSize: 80,
        maxSize: 140,
        meta: { align: "center", actionCount: 2 },
      });

      return cols;
    });

    // Built-in role names get the muted (yellow) outline badge; anything else
    // is treated as a custom role and gets the destructive (red) outline badge.
    const BUILTIN_ROLES = new Set([
      "admin",
      "viewer",
      "user",
      "root",
      "member",
      "editor",
      "serviceaccount",
    ]);
    const isBuiltinRole = (r: string) =>
      BUILTIN_ROLES.has(String(r ?? "").toLowerCase());
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
    const getCustomRoles = async (options: { silent?: boolean } = {}) => {
      if (config.isEnterprise !== "true" && config.isCloud !== "true") return;
      try {
        const res = await getCustomRolesApi(
          store.state.selectedOrganization.identifier,
        );
        customRoles.value = Array.isArray(res.data) ? res.data : [];
      } catch (err: any) {
        if (!options.silent && err?.response?.status !== 403) {
          toast({
            variant: "error",
            message:
              err?.response?.data?.message ||
              "Failed to load custom roles.",
          });
        }
      }
    };

    const getInvitedMembers = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading users...",
              timeout: 0,
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

    const clearLoading = (targets: any[]) => {
      for (const u of targets) {
        u.custom_roles_loading = false;
      }
    };

    // Inverts OFGA per-role memberships into per-user role lists.
    // Cost: O(R) HTTP calls where R is the number of custom roles,
    // independent of the user count.
    const hydrateCustomRoles = async () => {
      const myGen = ++hydrateGeneration;
      const orgId = store.state.selectedOrganization.identifier;
      const targets = usersState.users.filter(
        (u: any) => (u.rawEmail || u.email) && u.status !== "pending",
      );
      if (targets.length === 0) return;

      const byEmail = new Map<string, any>();
      for (const u of targets) {
        byEmail.set(String(u.rawEmail || u.email).toLowerCase(), u);
      }

      try {
        // Always fetch a fresh role list scoped to this hydration run so we
        // don't race with concurrent picker loads mutating the shared ref.
        // Silent mode: hydration is a background operation; surface fetch
        // errors via the per-row loading state, not a toast.
        let roleNames: string[] = [];
        try {
          const res = await getCustomRolesApi(orgId);
          roleNames = Array.isArray(res.data) ? res.data : [];
        } catch {
          roleNames = [];
        }
        if (myGen !== hydrateGeneration) return;
        if (roleNames.length === 0) return;

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
            if (!row) continue;
            const next = Array.isArray(row.custom_roles)
              ? row.custom_roles
              : [];
            if (next.indexOf(role) === -1) {
              row.custom_roles = [...next, role];
            }
          }
        }
      } finally {
        clearLoading(targets);
      }
    };

    const loading = ref(false);
    const getOrgMembers = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading users...",
              timeout: 0,
});

      loading.value = true;
      return new Promise((resolve, reject) => {
        usersService
          .orgUsers(store.state.selectedOrganization.identifier)
          .then(async (res) => {
            let users = [...res.data.data];

            if (config.isCloud == "true") {
              const invitedMembers: any = await getInvitedMembers();
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

              // Normalise roles to an array. Enterprise APIs surface roles in
              // various shapes — pull from every plausible field and dedupe.
              const rolesSet = new Set<string>();
              if (data?.role) rolesSet.add(String(data.role));
              if (Array.isArray(data?.roles)) {
                data.roles.forEach((r: any) => r && rolesSet.add(String(r)));
              }
              if (Array.isArray(data?.custom_roles)) {
                data.custom_roles.forEach(
                  (r: any) => r && rolesSet.add(String(r)),
                );
              }
              if (Array.isArray(data?.assigned_roles)) {
                data.assigned_roles.forEach(
                  (r: any) => r && rolesSet.add(String(r)),
                );
              }
              const rolesArr: string[] = Array.from(rolesSet).filter(Boolean);


              return {
                "#": counter <= 9 ? `0${counter++}` : counter++,
                email: maskText(data.email),
                rawEmail: data.email,
                first_name: data.first_name,
                last_name: data.last_name,
                role: data?.status == "pending" ? toCamelCase(data.role) + " (Invited)": toCamelCase(data.role),
                roles: rolesArr,
                auth_type: data?.auth_type
                  ? data.auth_type
                  : data?.is_external
                    ? "SSO"
                    : "Native",
                is_external: !!data?.is_external,
                enableEdit: store.state.userInfo.email?.toLowerCase() == data.email?.toLowerCase() ? true : false,
                enableChangeRole: false,
                enableDelete: config.isCloud == "true" ? true : false,
                status: data?.status,
                token: data?.token || null,
              };
            });
            rows.value = usersState.users;
            tableKey.value++;
            dismiss();

            // Resolve immediately so the caller (onBeforeMount) can run
            // updateUserActions() and surface the row action buttons without
            // waiting on the per-user role fetch below.
            resolve(true);

            // Enterprise/cloud: the org-members API only returns a single
            // `role` per user, so users with multiple role assignments
            // (e.g. Viewer + custom "nmcdev") look incomplete. Fetch the
            // full role list for *all* users in a single request — fire-and-
            // forget — and re-render the rows when it resolves. This replaces
            // the previous one-request-per-user pattern (N auth checks + N
            // OpenFGA reads) with a single batched call, and keeps the table
            // responsive instead of blocking the whole UI on the role API.
            if (isEnterpriseOrCloud) {
              const orgId = store.state.selectedOrganization.identifier;
              // Don't await — let the batched role fetch run in the background.
              usersService
                .getAllUserRoles(orgId)
                .then((resp: any) => {
                  // Response is a map of user email -> role list.
                  const roleMap: Record<string, any> = resp?.data || {};
                  usersState.users.forEach((u: any) => {
                    if (u.status === "pending") return;
                    const fetched: string[] = Array.isArray(
                      roleMap[u.rawEmail],
                    )
                      ? roleMap[u.rawEmail].filter(Boolean).map(String)
                      : [];
                    if (fetched.length) {
                      const merged = new Set<string>([
                        ...(u.roles || []),
                        ...fetched,
                      ]);
                      u.roles = Array.from(merged);
                    }
                  });
                  rows.value = [...usersState.users];
                  tableKey.value++;
                })
                .catch(() => {
                  // Batched role fetch failures are non-fatal — fall back to
                  // whatever role string came with the org-members rows.
                });
            }
          })
          .catch((err: any) => {
            console.error("Failed to fetch org members:", err);
            dismiss();
            toast({
              variant: "error",
              message: "Failed to load users: " + (err?.response?.data?.message || err?.message || "Unknown error"),
              timeout: 5000,
            });
            reject(false);
          })
          .finally(() => {
            loading.value = false;
          });
      });
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
      // Cloud: cannot edit self (same as delete behavior)
      if (config.isCloud == "true") {
        return (
          store.state.userInfo.email.toLowerCase() !== user.email.toLowerCase()
        );
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

    const addRoutePush = (row: any) => {
      if (row?.email) {
        router.push({
          name: "users",
          query: {
            action: "update",
            org_identifier: store.state.selectedOrganization.identifier,
            email: row.email,
          },
        });
        addUser({ row }, true);
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
        rows.value = usersState.users;
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
        rows.value = usersState.users;
      });
    };

    const updateMember = async (data: any) => {
      if (data.data != undefined) {
        try {
          await getOrgMembers();
        } catch (error) {
          toast({
            message: "Failed to refresh user list",
            variant: "error",
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
          toast({
            message: "User added successfully.",
            variant: "success",
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
          toast({
            message: "User updated successfully.",
            variant: "success",
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

    const confirmDeleteAction = (row: any) => {
      confirmDelete.value = true;
      deleteUserEmail = row.email;
    };

    const deleteUser = async () => {
      confirmDelete.value = false;
      usersService
        .delete(store.state.selectedOrganization.identifier, deleteUserEmail)
        .then(async (res: any) => {
          if (res.data.code == 200) {
            toast({
              message: "User deleted successfully.",
              variant: "success",
            });
            await getOrgMembers();
            updateUserActions();
          }
        })
        .catch((err: any) => {
          if (err.response.status != 403) {
            toast({
              message: "Error while deleting user.",
              variant: "error",
            });
          }
        });
    };

    const confirmRevokeAction = (row: any) => {
      confirmRevoke.value = true;
      revokeInviteToken = row.token;
      revokeInviteEmail.value = row.email;
    };

    const revokeInvite = async () => {
      confirmRevoke.value = false;
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
      });

      organizationsService
        .revoke_invite(store.state.selectedOrganization.identifier, revokeInviteToken)
        .then(async (res: any) => {
          dismiss();
          toast({
            message: "Invitation revoked successfully.",
            variant: "success",
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
          toast({
            message: err?.response?.data?.message || "Error while revoking invitation.",
            variant: "error",
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
          toast({
            message: `Successfully deleted ${successful.length} user(s)`,
            variant: "success",
          });
        } else if (successful.length > 0 && unsuccessful.length > 0) {
          toast({
            message: `Deleted ${successful.length} user(s), but ${unsuccessful.length} failed`,
            variant: "warning",
          });
        } else if (unsuccessful.length > 0) {
          toast({
            message: `Failed to delete ${unsuccessful.length} user(s)`,
            variant: "error",
          });
        }

        selectedUsers.value = [];
        confirmBulkDelete.value = false;
        await getOrgMembers();
        updateUserActions();
      } catch (err: any) {
        if (err.response?.status != 403 || err?.status != 403) {
          toast({
            message: err.response?.data?.message || err?.message || "Error while deleting users",
            variant: "error",
          });
        }
      }
    };

    const updateUserRole = (row: any) => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
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
            toast({
              variant: "error",
              message: message,
              timeout: 15000,
            });
          } else {
            toast({
              variant: "success",
              message: "Organization member updated successfully.",
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

    const selectedUserIds = computed(() =>
      selectedUsers.value.map((u: any) => u.email),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const usersMap = new Map(
        usersState.users
          .filter((u: any) => u.enableDelete)
          .map((u: any) => [u.email, u]),
      );
      selectedUsers.value = ids.map((id) => usersMap.get(id)).filter(Boolean);
    };

    // Watch selectedUsers to filter out disabled rows
    watch(selectedUsers, (newSelectedUsers) => {
      const onlyEnabledSelected = newSelectedUsers.filter((user: any) => user.enableDelete);
      if (onlyEnabledSelected.length !== newSelectedUsers.length) {
        selectedUsers.value = onlyEnabledSelected;
      }
    });

    return {
      t,
      router,
      store,
      config,
      isEnterpriseOrCloud,
      isBuiltinRole,
      toCamelCase,
      usersState,
      columns,
      loading,
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
      selectedUser,
      showUpdateUserDialog,
      filterQuery,
      fetchUserGroups,
      toggleExpand,
      forceCloseRow,
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
      selectedUsers,
      selectedUserIds,
      handleSelectedIdsUpdate,
      confirmBulkDelete,
      openBulkDeleteDialog,
      bulkDeleteUsers,
      rows,
      tableKey,
      // showAddUserBtn,
    };
  },
});
</script>

<style lang="scss" scoped>

/* Role chip — matches the incident "dimension-badge" sizing so role pills
   read consistently across the app (2px 8px padding, 11px font, weight 600). */
:deep(.o2-role-chip) {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  line-height: 1.4;
}

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
