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
  <!-- OPageLayout owns the whole skeleton (header + body inset/bleed) — search
       lives in the table's own toolbar. -->
  <OPageLayout
    :title="t('organization.header')"
    :subtitle="t('iam.listOrganizations.subtitle')"
    icon="corporate-fare"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton variant="primary" size="sm" @click="addOrganization" data-test="Add Organization">
        {{ t("organization.add") }}
      </OButton>
    </template>
    <div class="min-h-0 w-full flex-1 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          :data="organizations"
          :columns="columns"
          row-key="identifier"
          :loading="loading"
          :forbidden="forbidden"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('organization.header')"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-organizations-list"
        >
          <template #toolbar>
            <div class="flex w-full items-center gap-2">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('organization.search')"
                class="flex-1"
                data-test="organizations-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="organizations-list-refresh-btn"
              @click="getOrganizations"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="iamOrganizationsRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-organizations"
              :filtered="!!filterQuery"
              :hide-action="!filterQuery"
              @action="(id) => id === 'clear-filters' && (filterQuery = '')"
            />
          </template>

          <template #cell-identifier="{ row }">
            <OCodeCell :value="row.identifier" />
          </template>

          <template #cell-type="{ row }">
            <OTag v-if="row.type" :value="row.type" />
            <span v-else class="text-text-body">—</span>
          </template>

          <template #cell-plan="{ row }">
            <OTag v-if="row.plan && row.plan !== '-'" type="subscriptionPlan" :value="row.plan" />
            <span v-else class="text-text-body">—</span>
          </template>

          <template #cell-actions="{ row }">
            <!-- Edit is pinned first so it stays column-aligned across every row,
                 regardless of which trailing actions a row shows. -->
            <div class="flex items-center justify-start gap-1">
              <OButton
                data-test="organization-name-edit"
                variant="ghost"
                size="icon-sm"
                :title="t('iam.listOrganizations.edit')"
                @click="renameOrganization(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                v-if="canDeleteOrg(row)"
                data-test="organization-delete"
                variant="ghost"
                size="icon-sm"
                :title="t('iam.listOrganizations.deleteOrganization')"
                @click="deleteOrganization(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </div>
          </template>
        </OTable>
      </div>
    </div>
    <AddUpdateOrganization
      :open="showAddOrganizationDialog"
      @update:open="onDrawerOpenChange"
      @updated="updateOrganizationList"
      :model-value="toBeUpdatedOrganization"
    />
  </OPageLayout>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";

import organizationsService from "@/services/organizations";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import AddUpdateOrganization from "@/components/iam/organizations/AddUpdateOrganization.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import segment from "@/services/segment_analytics";
import { convertToTitleCase } from "@/utils/zincutils";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

export default defineComponent({
  name: "PageOrganization",
  components: {
    OCodeCell,
    AddUpdateOrganization,
    OEmptyState,
    OButton,
    OTooltip,
    OTag,
    OPageLayout,
    OIcon,
    OTable,
    OSearchInput,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18nTyped();
    const organizations = ref([]);
    const organization = ref({});
    const showAddOrganizationDialog = ref(false);
    const showJoinOrganizationDialog = ref(false);
    const showOrgAPIKeyDialog = ref(false);
    const organizationAPIKey = ref("");
    const filterQuery = ref("");
    const toBeUpdatedOrganization = ref({
      id: "",
      name: "",
      identifier: "",
    });
    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("organization.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 500,
        meta: { align: "left", isName: true },
      },
      {
        id: "identifier",
        header: t("organization.identifier"),
        accessorKey: "identifier",
        sortable: true,
        resizable: true,
        hideable: true,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "type",
        header: t("organization.type"),
        accessorKey: "type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "left" },
      },
    ];

    if (config.isCloud == "true") {
      columns.push({
        id: "plan",
        header: t("organization.subscription_plan"),
        accessorKey: "plan",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      });
    }
    columns.push({
      id: "actions",
      header: t("user.actions"),
      isAction: true,
      pinned: "right",
      size: 112,
      minSize: 96,
      maxSize: 140,
      // Center-aligned to match every other listing table's actions column.
      meta: { align: "center", actionCount: 3 },
    });

    watch(
      () => router.currentRoute.value.query?.action,
      (action) => {
        if (action == "add") {
          showAddOrganizationDialog.value = true;
        } else if (action == "update") {
          showAddOrganizationDialog.value = true;
          toBeUpdatedOrganization.value = {
            id: router.currentRoute.value.query?.to_be_updated_org_id || "",
            name: router.currentRoute.value.query?.to_be_updated_org_name || "",
            identifier: router.currentRoute.value.query?.to_be_updated_org_id || "",
          };
        }
      },
    );

    onMounted(() => {
      // Only `action=update` deep-links auto-open the dialog so a shared
      // edit URL still lands directly on the org's edit form. `action=add`
      // is intentionally NOT handled here — the dialog only opens via the
      // "Add Organization" button click; refreshing on an `action=add` URL
      // should leave the user on the list view.
      if (router.currentRoute.value.query.action == "update") {
        showAddOrganizationDialog.value = true;
        toBeUpdatedOrganization.value = {
          id: router.currentRoute.value.query?.to_be_updated_org_id || "",
          name: router.currentRoute.value.query?.to_be_updated_org_name || "",
          identifier: router.currentRoute.value.query?.to_be_updated_org_id || "",
        };
      }
    });

    const loading = ref(false);
    const forbidden = ref(false);
    const getOrganizations = () => {
      const dismiss = toast({
        variant: "loading",
        message: t("iam.listOrganizations.loadingOrganizations"),
        timeout: 0,
      });
      loading.value = true;
      forbidden.value = false;
      organizationsService
        .list(0, 1000000, "name", false, "")
        .then((res) => {
          store.dispatch("setOrganizations", res.data.data);

          const billingPlans = {
            "0": "Free",
            "1": "Pay as you go",
            "2": "Enterprise",
          };
          organizations.value = res.data.data.map((data) => {
            // Common fields for all configurations

            const commonOrganization = {
              name: data.name,
              identifier: data.identifier,
              type: convertToTitleCase(data.type),
              plan: billingPlans[data.plan] || "-",
              _userRole: data.role ?? data.user_role ?? "",
            };

            // Additional fields and logic for cloud configuration
            // if (config.isCloud === "true") {
            //   const memberrole = data.OrganizationMemberObj.filter(
            //     (v) =>
            //       v.user_id === store.state.currentuser.id && v.role === "admin",
            //   );

            //   // If invited, pass props to inviteTeam function
            //   // if (
            //   //   router.currentRoute.value.query.action === "invite" &&
            //   //   data.identifier === router.currentRoute.value.query.id
            //   // ) {
            //   //   const props = {
            //   //     row: {
            //   //       id: data.id,
            //   //       name: data.name,
            //   //       identifier: data.identifier,
            //   //       role: data.role,
            //   //       member_lists: [],
            //   //     },
            //   //   };
            //   //   inviteTeam(props);
            //   // }

            //   const role = memberrole.length ? memberrole[0].role : "member";

            //   // Extend common fields with cloud-specific data
            //   return {
            //     ...commonOrganization,
            //     id: data.id,
            //     created: date.formatDate(data.created_at, "YYYY-MM-DDTHH:mm:ssZ"),
            //     role: convertToTitleCase(role),
            //     status: convertToTitleCase(data.status),
            //     plan_type:
            //       data.CustomerBillingObj.subscription_type === config.freePlan ||
            //       data.CustomerBillingObj.subscription_type === ""
            //         ? "Developer"
            //         : "Pro",
            //   };
            // }

            // For open-source or enterprise, return only common fields
            return commonOrganization;
          });

          dismiss();
        })
        .catch((err: any) => {
          forbidden.value = err?.response?.status === 403;
          dismiss();
        })
        .finally(() => {
          loading.value = false;
        });
    };

    getOrganizations();

    const addOrganization = (evt) => {
      //reset the toBeUpdated data if user clicked on update and not submitted the form
      toBeUpdatedOrganization.value = {
        id: "",
        name: "",
        identifier: "",
      };
      showAddOrganizationDialog.value = true;
      router.push({
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });

      if (evt) {
        let button_txt = evt.target.innerText;
        segment.track("Button Click", {
          button: button_txt,
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          page: "Organizations",
        });
      }
    };

    const hideAddOrgDialog = () => {
      router.push({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const onDrawerOpenChange = (val: boolean) => {
      showAddOrganizationDialog.value = val;
      if (!val) hideAddOrgDialog();
    };

    const inviteTeam = (props: any) => {
      organization.value = {
        id: props.row.id,
        name: props.row.name,
        role: props.row.role,
        identifier: props.row.identifier,
        member_lists: [],
      };
      showJoinOrganizationDialog.value = true;

      segment.track("Button Click", {
        button: "Invite Member",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Organizations",
      });
    };

    const { confirm } = useConfirmDialog();

    // Returns true if the current user can delete the given org row.
    // Only shown on cloud builds; user must be root or an admin of that org.
    const canDeleteOrg = (row: any): boolean => {
      if (config.isCloud !== "true") return false;
      const role = row._userRole?.toLowerCase();
      return role === "root" || role === "admin";
    };

    const deleteOrganization = async (row: any) => {
      const confirmed = await confirm({
        title: t("iam.listOrganizations.deleteOrganization"),
        message: t("iam.listOrganizations.deleteConfirm", { name: row.name }),
        confirmLabel: t("iam.listOrganizations.delete"),
        cancelLabel: t("iam.listOrganizations.cancel"),
      });
      if (!confirmed) return;

      try {
        await organizationsService.delete_org(row.identifier);
        toast({ variant: "success", message: t("iam.listOrganizations.deletionInitiated") });
        getOrganizations();
      } catch (e: any) {
        const msg =
          e?.response?.data?.message ||
          e?.message ||
          t("iam.listOrganizations.failedToInitiateDeletion");
        toast({ variant: "error", message: msg });
      }
    };

    const renameOrganization = (row: any) => {
      toBeUpdatedOrganization.value = {
        id: row.identifier,
        name: row.name,
        identifier: row.identifier,
      };
      showAddOrganizationDialog.value = true;
      router.push({
        query: {
          action: "update",
          org_identifier: store.state.selectedOrganization.identifier,
          to_be_updated_org_id: props.row.identifier,
          to_be_updated_org_name: props.row.name,
        },
      });
    };

    useShortcuts([
      {
        id: "iamOrganizationsRefresh",
        handler: () => {
          if (!isInputFocused()) getOrganizations();
        },
      },
    ]);

    return {
      t,
      store,
      router,
      config,
      loading,
      forbidden,
      organizations,
      organization,
      columns,
      showAddOrganizationDialog,
      showJoinOrganizationDialog,
      showOrgAPIKeyDialog,
      organizationAPIKey,
      addOrganization,
      getOrganizations,
      inviteTeam,
      filterQuery,
      hideAddOrgDialog,
      onDrawerOpenChange,
      renameOrganization,
      canDeleteOrg,
      deleteOrganization,
      toBeUpdatedOrganization,
    };
  },
  methods: {
    updateOrganizationList() {
      this.router.push({
        name: "organizations",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
        },
      });
      this.showAddOrganizationDialog = false;
      //after updating the organization we will reset the toBeUpdatedOrganization
      const isUpdated = this.toBeUpdatedOrganization.id.length !== 0;
      this.toBeUpdatedOrganization = {
        id: "",
        name: "",
        identifier: "",
      };
      this.getOrganizations();

      toast({
        variant: "success",
        message: isUpdated
          ? this.t("iam.listOrganizations.organizationUpdated")
          : this.t("iam.listOrganizations.organizationAdded"),
      });
    },
    joinOrganization() {
      toast({
        variant: "success",
        message: this.t("iam.listOrganizations.requestCompleted"),
        timeout: 5000,
      });
      this.showJoinOrganizationDialog = false;
    },
    copyAPIKey() {
      copyToClipboard(this.organizationAPIKey, this.t, {
        successMessage: this.t("iam.listOrganizations.apiKeyCopied"),
        errorMessage: this.t("iam.listOrganizations.apiKeyCopyError"),
        timeout: 5000,
      });
    },
  },
});
</script>
