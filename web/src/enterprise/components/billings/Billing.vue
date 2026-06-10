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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <div class="tw:rounded-md tw:p-0 tw:pt-1 tw:overflow-hidden tw:h-full tw:flex tw:flex-col">
    <!-- Standard page header: title + icon. Usage date / data-type controls live
         in the toolbar row below. -->
    <AppPageHeader
      :title="headerBasedOnRoute()"
      icon="paid"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <div v-if="isOrgGroupRoute" class="tw:flex tw:items-center tw:gap-2">
          <OButton
            v-if="orgGroupInvite.canInvite"
            variant="primary"
            size="sm-action"
            data-test="org-group-invite-org-btn"
            @click="orgGroupInvite.trigger++"
          >
            {{ t("billing.billingGroup.inviteOrgButton") }}
          </OButton>
        </div>
      </template>
    </AppPageHeader>
    <OSplitter
      v-model="splitterModel"
      unit="px"
      :horizontal="false"
      before-class="tw:border-r tw:border-border-default"
      class="tw:flex-1 tw:min-h-0"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pt-2 tw:pb-[0.625rem]">
          <div class="card-container tw:h-full">
            <OTabs
              v-model="billingtab"
              orientation="vertical"
            >

          <ORouteTab
            exact
            name="plans"
            :to="
              '/billings/plans?org_identifier=' +
              store.state.selectedOrganization.identifier
            "
            :icon="'img:' + getImageURL('images/common/plan_icon.svg')"
            :label="t('billing.plansLabel')"
          />
          <ORouteTab
            exact
            name="usage"
            :to="
              '/billings/usage?org_identifier=' +
              store.state.selectedOrganization.identifier +
              '&usage_date=' +
              usageDate +
              '&data_type=' +
              usageDataType
            "
            :icon="'img:' + getImageURL('images/common/usage_icon.svg')"
            :label="t('billing.usageLabel')"
          />
          <ORouteTab
            v-if="showInvoiceTab"
            exact
            name="invoice_history"
            :to="
              '/billings/invoice_history?org_identifier=' +
              store.state.selectedOrganization.identifier
            "
            :icon="'img:' + getImageURL('images/common/invoice_icon.svg')"
            :label="t('billing.invoiceHistoryLabel')"
          />
          <ORouteTab
            v-if="config.isCloud == 'true'"
            exact
            name="billing_group"
            :to="
              '/billings/billing_group?org_identifier=' +
              store.state.selectedOrganization.identifier
            "
            icon="groups"
            :label="t('billing.billingGroup.tabLabel')"
          />
        </OTabs>
        <!-- <OButton
              data-test="logs-search-field-list-collapse-btn"
              :title="showSidebar ? 'Collapse Fields' : 'Open Fields'"
              variant="ghost"
              size="icon-sm"
              :class="showSidebar ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
              @click="collapseSidebar"
            >
              <OIcon :name="showSidebar ? 'chevron-left' : 'chevron-right'" size="sm" />
            </OButton> -->
          </div>
        </div>

      </template>

      <template v-slot:after>
        <div class="tw:w-full tw:h-full tw:flex tw:flex-col tw:pt-2">
          <div
            v-if="isUsageRoute"
            class="tw:flex tw:gap-2 tw:items-center tw:justify-end card-container tw:shrink-0 tw:mb-2 tw:ml-2 tw:mr-3 tw:px-3 tw:py-2"
          >
            <div class="custom-usage-date-select">
              <OSelect
                v-model="usageDate"
                :options="options"
                labelKey="label"
                valueKey="value"
                @update:model-value="selectUsageDate"
                class="tw:p-0 tw:mx-0 tw:h-[40px] tw:mt-1"
              >
                <template v-slot:prepend>
                  <OIcon name="schedule" size="xs" class="tw:mr-2 tw:mt-1" @click.stop.prevent />
                </template>
              </OSelect>
            </div>
            <div class="tw:flex tw:items-center">
              <div class="app-tabs-container tw:h-[36px]">
                <AppTabs class="tabs-selection-container" :tabs="tabs" :activeTab="usageDataType" @update:activeTab="(value: any) => updateActiveTab(value)" />
              </div>
            </div>
          </div>
          <div class="tw:flex-1 tw:min-h-0 tw:pr-[0.625rem] tw:pb-[0.625rem] tw:flex tw:gap-[0.625rem]">
            <div
              v-if="isUsageRoute && billingMembers.length > 0"
              class="tw:w-[260px] tw:shrink-0 tw:h-full"
              data-test="usage-member-list"
            >
              <UsageMemberList
                v-model="usageMember.selected"
                :members="billingMembers"
              />
            </div>
            <div class="card-container tw:pb-3 tw:flex-1 tw:min-w-0 tw:h-full">
              <router-view title=""> </router-view>
            </div>
          </div>
        </div>
      </template>
    </OSplitter>
  </div>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OButton from '@/lib/core/Button/OButton.vue'
// @ts-ignore
import { defineComponent, ref, onBeforeMount, computed, onMounted, provide, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import Usage from "./usage.vue";
import { getImageURL } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";
import AppTabs from "@/components/common/AppTabs.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

import BillingService from "@/services/billings";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import UsageMemberList from "./UsageMemberList.vue";

export default defineComponent({
  name: "PageIngestion",
  components: {
    AppPageHeader, OTabs, ORouteTab, ConfirmDialog, Usage, AppTabs, OSelect,
    OIcon, OSplitter, OButton, UsageMemberList },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const billingtab = ref(resolveTab("billings", router.currentRoute.value.name as string, "usage"));
    const usageDataType = ref(router.currentRoute.value.query.data_type || "gb");
    const showSidebar = ref(true);
    const lastSplitterPosition = ref(200);
    const splitterModel = ref(220);
    const billingProvider = ref(""); // empty until loaded
    const isPaidUser = ref(false);
    const billingInfoLoaded = ref(false);

    // Billing-group members for the Usage member selector (rendered as a
    // sidebar beside the usage view). Shared with usage.vue via provide/inject.
    const billingMembers = ref<{ id: string; name: string }[]>([]);
    const usageMember = reactive({ selected: "" });
    provide("usageMember", usageMember);
    const fetchBillingMembers = () => {
      if (config.isCloud !== "true") return;
      BillingService.list_billing_group_members(
        store.state.selectedOrganization.identifier
      )
        .then((res: any) => {
          billingMembers.value = (res.data ?? []).map((m: any) => ({
            id: m.member_org_id,
            name: m.member_org_name,
          }));
        })
        .catch(() => {
          billingMembers.value = [];
        });
    };

    // Fetch billing info to determine provider
    const fetchBillingInfo = async () => {
      try {
        const res = await BillingService.list_subscription(
          store.state.selectedOrganization.identifier
        );
        billingProvider.value = res.data?.provider || "";
        isPaidUser.value = res.data?.customer_id.length > 0;
      } catch (e) {
        console.error("Failed to fetch billing info:", e);
        billingProvider.value = "";
      } finally {
        billingInfoLoaded.value = true;
      }
    };

    // Check if invoice tab should be shown (only for Stripe, and only after loading)
    const showInvoiceTab = computed(() => {
      return billingInfoLoaded.value && billingProvider.value === "stripe";
    });
    const options = computed(()=>{
      return billingInfoLoaded.value && billingProvider.value === "stripe" && isPaidUser.value ?
        [
          {label: "Previous Cycle", value: "-1cycle"},
          {label: "Current Cycle", value: "1cycle"},
          {label: "30 Days", value: "30days"},
          {label: "60 Days", value: "60days"},
          {label: "3 Months", value: "3months"},
          {label: "6 Months", value: "6months"},
        ]
        :
        [
          {label: "30 Days", value: "30days"},
          {label: "60 Days", value: "60days"},
          {label: "3 Months", value: "3months"},
          {label: "6 Months", value: "6months"},
        ]
    })
    const collapseSidebar = () => {
      showSidebar.value = !showSidebar.value;
      if (showSidebar.value) {
        splitterModel.value = lastSplitterPosition.value;
      } else {
        lastSplitterPosition.value = splitterModel.value;
        splitterModel.value = 0;
      }
    };

    onMounted(async () => {
      // Fetch billing info to determine provider type
      await fetchBillingInfo();
      fetchBillingMembers();

      // Default to current cycle for paid Stripe users (only on the usage tab)
      if (
        router.currentRoute.value.name == "usage" &&
        !router.currentRoute.value.query.usage_date &&
        billingProvider.value === "stripe" &&
        isPaidUser.value
      ) {
        usageDate.value = "1cycle";
          selectUsageDate();
      }

      if (router.currentRoute.value.name == "billings" || router.currentRoute.value.name == "plans") {
        billingtab.value = "plans";
        router.push({ path: "/billings/plans", query: { org_identifier: store.state.selectedOrganization.identifier } });
      }
    });

    const headerBasedOnRoute = () => {
      if (router.currentRoute.value.name == "usage") {
        return t("billing.usageLabel");
      } else if (router.currentRoute.value.name == "plans") {
        return t("billing.plansLabel");
      } else if (router.currentRoute.value.name == "invoice_history") {
        return t("billing.invoiceHistoryLabel");
      } else if (router.currentRoute.value.name == "billing_group") {
        return t("billing.billingGroup.tabLabel");
      }
      return "";
    };
    const usageDate = ref(router.currentRoute.value.query.usage_date || "30days");

    const isUsageRoute = computed(() => {
      return router.currentRoute.value.name == "usage";
    })
    const isOrgGroupRoute = computed(() => {
      return router.currentRoute.value.name == "billing_group";
    })
    // Shared with the BillingGroup route component (via inject): the child sets
    // canInvite based on the org's role and we bump trigger to open its invite panel.
    const orgGroupInvite = reactive({
      trigger: 0,
      canInvite: false,
    });
    provide("orgGroupInvite", orgGroupInvite);
    const selectUsageDate = () => {
      router.push({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: usageDate.value,
          data_type: usageDataType.value
        }
      })

    }
    const updateActiveTab = (value: any) => {
      usageDataType.value = value;
      selectUsageDate();
    }
    const tabs = [
    {
        label: 'Gb',
        value: "gb",
        icon: "storage",
      },
      {
        label: 'Mb',
        value: "mb",
        icon: "database",
      }
    ]

    return {
      t,
      store,
      router,
      config,
      billingtab,
      getImageURL,
      splitterModel,
      headerBasedOnRoute,
      options,
      usageDate,
      selectUsageDate,
      isUsageRoute,
      isOrgGroupRoute,
      orgGroupInvite,
      tabs,
      usageDataType,
      updateActiveTab,
      collapseSidebar,
      showSidebar,
      lastSplitterPosition,
      showInvoiceTab,
      billingProvider,
      isPaidUser,
      billingMembers,
      usageMember,
    };
  },
});
</script>

<style scoped lang="scss">

.card-container {
  overflow-y: auto;
}

</style>
