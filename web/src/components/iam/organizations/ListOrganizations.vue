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
    <div class="card-container tw:mb-[0.625rem]">
      <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]"
      style="position: sticky; top: 0; z-index: 1000 ;"
      >
          <div class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]" data-test="organizations-title-text">{{ t("organization.header") }}</div>
          <div class="tw:flex tw:items-center tw:justify-end tw:gap-3">
            <OInput
              v-model="filterQuery"
              class="tw:w-[12.5rem]"
              :placeholder="t('organization.search')"
              data-test="organizations-search-input"
            >
              <template #icon-left>
                <OIcon name="search" size="sm" />
              </template>
            </OInput>
            <OButton
              variant="primary"
              size="sm"
              class="tw:!h-8"
              @click="addOrganization"
              data-test="Add Organization"
            >
              {{ t('organization.add') }}
            </OButton>
          </div>
        </div>
    </div>
    <div class="card-container tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <OTable
          :data="organizations"
          :columns="columns"
          row-key="identifier"
          :loading="loading"
          :global-filter="filterQuery"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('organization.header')"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
        >
          <template #empty>
            <NoData />
          </template>


          <template #cell-actions="{ row }">
            <OButton
              data-test="organization-name-edit"
              variant="ghost"
              size="icon-sm"
              :title="'Edit'"
              @click="renameOrganization(row)"
            >
              <OIcon name="edit" size="sm" />
            </OButton>
          </template>
      </OTable>
    </div>
    <add-update-organization
      :open="showAddOrganizationDialog"
      @update:open="onDrawerOpenChange"
      @updated="updateOrganizationList"
      :model-value="toBeUpdatedOrganization"
    />
  </div>
</template>

<script lang="ts">

// @ts-nocheck
import { defineComponent, ref, watch, onMounted, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";

import organizationsService from "@/services/organizations";
import JoinOrganization from "./JoinOrganization.vue";
import AddUpdateOrganization from "@/components/iam/organizations/AddUpdateOrganization.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import segment from "@/services/segment_analytics";
import { convertToTitleCase } from "@/utils/zincutils";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageOrganization",
  components: {
    AddUpdateOrganization,
    NoData,
    OButton,
    OInput,
    OIcon,
    OTable,
},
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
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
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 36,
        minSize: 32,
        maxSize: 40,
        meta: { align: "left", compactPadding: true },
      },
      {
        id: "name",
        header: t("organization.name"),
        accessorKey: "name",
        sortable: true,
        size: 500,
        meta: { align: "left" },
      },
      {
        id: "identifier",
        header: t("organization.identifier"),
        accessorKey: "identifier",
        sortable: true,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "type",
        header: t("organization.type"),
        accessorKey: "type",
        sortable: true,
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
        meta: { align: "left" },
      });
    }
    columns.push({
      id: "actions",
      header: t("user.actions"),
      isAction: true,
      pinned: "right",
      size: 80,
      minSize: 64,
      maxSize: 100,
      meta: { align: "center", actionCount: 1 },
    });

    watch(
      () => router.currentRoute.value.query?.action,
      (action) => {
        if (action == "add") {
          showAddOrganizationDialog.value = true;
        }
        else if (action == "update") {
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
      if (
        router.currentRoute.value.query.action == "update"
      ) {
        showAddOrganizationDialog.value = true;
        toBeUpdatedOrganization.value = {
          id: router.currentRoute.value.query?.to_be_updated_org_id || "",
          name: router.currentRoute.value.query?.to_be_updated_org_name || "",
          identifier: router.currentRoute.value.query?.to_be_updated_org_id || "",
        };
      }
    });

    const loading = ref(false);
    const getOrganizations = () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading organizations...",
      });
      loading.value = true;
      organizationsService.list(0, 1000000, "name", false, "").then((res) => {
        // Updating store so that organizations in navbar also gets updated
        store.dispatch("setOrganizations", res.data.data);

        let counter = 1;
        const billingPlans = {
          "0": "Free",
          "1": "Pay as you go",
          "2": "Enterprise"
        };
        organizations.value = res.data.data.map((data) => {
          // Common fields for all configurations

          const commonOrganization = {
            "#": counter <= 9 ? `0${counter++}` : counter++,
            name: data.name,
            identifier: data.identifier,
            type: convertToTitleCase(data.type),
            plan: billingPlans[data.plan] || "-",
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
      }).finally(() => {
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

    return {
      t,
      store,
      router,
      config,
      loading,
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
      }
      this.getOrganizations();

      toast({
        variant: "success",
        message: isUpdated ? 'Organization updated successfully.' : 'Organization added successfully.',
      });
    },
    joinOrganization() {
      toast({
        variant: "success",
        message: "Request completed successfully.",
        timeout: 5000,
      });
      this.showJoinOrganizationDialog = false;
    },
    copyAPIKey() {
      copyToClipboard(this.organizationAPIKey, {
        successMessage: "API Key Copied Successfully!",
        errorMessage: "Error while copy API Key.",
        timeout: 5000,
      });
    },
  },
});
</script>

<style lang="scss" scoped>
</style>
