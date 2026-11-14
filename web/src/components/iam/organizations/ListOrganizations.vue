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
          :row-actions="rowActions"
          row-actions-more-data-test="organization-row-more-actions"
          :loading="loading"
          :forbidden="forbidden"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-organizations-list"
        >
          <template #toolbar>
            <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('organization.search')"
                class="flex-1"
                data-test="organizations-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="lastUpdatedAt"
              :loading="loading"
              shortcut-id="iamOrganizationsRefresh"
              data-test="organizations-list-refresh-btn"
              @click="getOrganizations"
            />
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

          <template #cell-name="{ row }">
            <div class="flex min-w-0 items-center gap-2">
              <OTruncatedText>{{ row.name }}</OTruncatedText>
              <OTag
                v-if="isCurrentOrganization(row)"
                variant="default-soft"
                size="sm"
                :label="t('iam.listOrganizations.current')"
                data-test="organization-current-tag"
              />
            </div>
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
import { defineComponent, ref, toRef, watch, onMounted } from "vue";
import { useListViewState } from "@/composables/useListViewState";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";

import organizationsService from "@/services/organizations";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import AddUpdateOrganization from "@/components/iam/organizations/AddUpdateOrganization.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTableRowAction } from "@/lib/core/Table/OTable.types";
import analytics from "@/services/product_analytics";
import { convertToTitleCase } from "@/utils/zincutils";
import {
  switchOrganization as selectOrganization,
  toOrganizationOption,
} from "@/utils/organizationSwitch";
import useStreams from "@/composables/useStreams";
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
    OTag,
    OTruncatedText,
    OPageLayout,
    OTable,
    OSearchInput,
    ORefreshButton,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18nTyped();
    const { resetStreams } = useStreams(t);
    const organizations = ref([]);
    const organization = ref({});
    const showAddOrganizationDialog = ref(false);
    const showJoinOrganizationDialog = ref(false);
    const showOrgAPIKeyDialog = ref(false);
    const organizationAPIKey = ref("");
    const filterQuery = toRef(
      useListViewState("iam-organizations", { filterQuery: "" }),
      "filterQuery",
    );
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
    });
    const isCurrentOrganization = (row: any): boolean =>
      row.identifier === store.state.selectedOrganization?.identifier;

    // The table ranks id "edit" first, so edit is "rename" with the edit shortcut to sit after Switch.
    const rowActions: OTableRowAction[] = [
      {
        id: "switch",
        label: t("iam.listOrganizations.switch"),
        icon: "swap-horiz",
        onSelect: (row) => switchOrganization(row),
        visible: (row) => !isCurrentOrganization(row),
        dataTest: () => "organization-switch",
      },
      {
        id: "rename",
        shortcut: "edit",
        label: t("iam.listOrganizations.edit"),
        icon: "edit",
        onSelect: (row) => renameOrganization(row),
        dataTest: () => "organization-name-edit",
      },
      {
        id: "delete",
        label: t("iam.listOrganizations.deleteOrganization"),
        icon: "delete",
        onSelect: (row) => deleteOrganization(row),
        visible: (row) => canDeleteOrg(row),
        dataTest: () => "organization-delete",
      },
    ];

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
    const lastUpdatedAt = ref<number | null>(null);
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

          lastUpdatedAt.value = Date.now();
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
        analytics.track("Button Click", {
          button: button_txt,
          user_org: store.state.selectedOrganization.identifier,
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

      analytics.track("Button Click", {
        button: "Invite Member",
        user_org: store.state.selectedOrganization.identifier,
        page: "Organizations",
      });
    };

    const { confirm } = useConfirmDialog();

    // Same option shape as the header's organization switcher, which the layout then syncs to.
    const switchOrganization = (row: any) => {
      const org = (store.state.organizations ?? []).find(
        (o: any) => o.identifier === row.identifier,
      );
      if (!org) return;
      const option = toOrganizationOption(org, store.state.userInfo.email);
      void selectOrganization({ store, router, resetStreams }, option, {
        name: "organizations",
        query: { org_identifier: org.identifier },
      });
    };

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
        messageKeypath: "iam.listOrganizations.deleteConfirm",
        messageName: row.name,
        confirmLabel: t("iam.listOrganizations.delete"),
        cancelLabel: t("iam.listOrganizations.cancel"),
        confirmVariant: "destructive",
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
          to_be_updated_org_id: row.identifier,
          to_be_updated_org_name: row.name,
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
      lastUpdatedAt,
      organizations,
      organization,
      columns,
      rowActions,
      isCurrentOrganization,
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
