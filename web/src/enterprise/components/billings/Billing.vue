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
  <OPageLayout
    :title="headerBasedOnRoute()"
    icon="paid"
    bleed
  >
      <template #actions>
        <div v-if="isOrgGroupRoute" class="flex items-center gap-2">
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
    <OSplitter
      v-model="splitterModel"
      unit="px"
      :horizontal="false"
      before-class="border-r border-border-default"
      class="flex-1 min-h-0"
    >
      <template v-slot:before>
        <div class="w-full h-full pl-2.5 pt-2 pb-2.5">
          <div class="overflow-y-auto h-full">
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
        <div class="w-full h-full flex flex-col pt-2">
          <div
            v-if="isUsageRoute"
            class="flex gap-2 items-center justify-end overflow-y-auto shrink-0 mb-2 ml-2 mr-3 px-3 py-2"
          >
            <!-- The billing-cycle range dropdown only applies to the totals
                 view. When self-usage reporting is on, the daily view renders
                 its own date-range picker, so hide this to avoid two selectors. -->
            <div v-if="!usageStreamEnabled" class="custom-usage-date-select">
              <OSelect
                v-model="usageDate"
                :options="options"
                labelKey="label"
                valueKey="value"
                @update:model-value="selectUsageDate"
                class="p-0 mx-0 h-10 mt-1"
              >
                <template v-slot:prepend>
                  <OIcon name="schedule" size="xs" class="mr-2 mt-1" @click.stop.prevent />
                </template>
              </OSelect>
            </div>
            <!-- Daily view's date-range picker — same toolbar line as GB/MB. -->
            <DateTimePickerDashboard
              v-if="usageStreamEnabled"
              ref="dateTimePicker"
              v-model="dateRange"
              size="sm"
              data-test="usage-daily-date-picker"
              @hide="onRangeChange"
            />
            <div class="flex items-center">
              <div class="app-tabs-container h-9">
                <AppTabs class="tabs-selection-container" :tabs="tabs" :activeTab="usageDataType" @update:activeTab="(value: any) => updateActiveTab(value)" />
              </div>
            </div>
          </div>
          <div class="flex-1 min-h-0 pr-2.5 pb-2.5 flex gap-2.5">
            <div
              v-if="isUsageRoute && billingMembers.length > 0"
              class="w-65 shrink-0 h-full"
              data-test="usage-member-list"
            >
              <UsageMemberList
                v-model="usageMember.selected"
                :members="billingMembers"
              />
            </div>
            <div class="overflow-y-auto pb-3 flex-1 min-w-0 h-full">
              <router-view title=""> </router-view>
            </div>
          </div>
        </div>
      </template>
    </OSplitter>
  </OPageLayout>
</template>

<script lang="ts">
import ORouteTab from '@/lib/navigation/Tabs/ORouteTab.vue'
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OButton from '@/lib/core/Button/OButton.vue'
// @ts-ignore
import { defineComponent, ref, computed, onMounted, provide, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import BillingService from "@/services/billings";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import UsageMemberList from "./UsageMemberList.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import { getConsumableRelativeTime } from "@/utils/date";

export default defineComponent({
  name: "PageIngestion",
  components: {
    OPageLayout, OTabs, ORouteTab, ConfirmDialog, Usage, AppTabs, OSelect,
    OIcon, OSplitter, OButton, UsageMemberList, DateTimePickerDashboard },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    // Default/fallback tab is "plans" — that's where /billings redirects on
    // mount, so falling back to "usage" made the Usage tab flash-highlight
    // first before the redirect settled.
    const billingtab = ref(resolveTab("billings", router.currentRoute.value.name as string, "plans"));
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
    // Self-usage reporting on → the Usage tab renders the daily view (which has
    // its own date-range picker), so the billing-cycle range dropdown is hidden.
    const usageStreamEnabled = computed(
      () =>
        !!store.state?.organizationData?.organizationSettings
          ?.usage_stream_enabled,
    );

    // Daily-view date range: the picker lives here (toolbar, next to GB/MB) and
    // shares the RESOLVED window (microseconds) with the child usage.vue via
    // provide/inject. `key` bumps on every change so the charts re-render.
    const dateTimePicker = ref<any>(null);
    const dateRange = ref<any>({
      valueType: "relative",
      relativeTimePeriod: "7d",
    });
    const usageRange = reactive({
      start: (new Date().getTime() - 7 * 24 * 60 * 60 * 1000) * 1000,
      end: new Date().getTime() * 1000,
      key: 0,
    });
    provide("usageRange", usageRange);
    const onRangeChange = () => {
      const v: any = dateRange.value;
      if (v?.valueType === "relative" && v.relativeTimePeriod) {
        const r = getConsumableRelativeTime(v.relativeTimePeriod);
        if (r) {
          usageRange.start = r.startTime;
          usageRange.end = r.endTime;
        }
      } else if (v?.valueType === "absolute" && v.startTime && v.endTime) {
        usageRange.start = v.startTime;
        usageRange.end = v.endTime;
      } else if (dateTimePicker.value?.getConsumableDateTime) {
        // Fallback: ask the picker to resolve its current selection.
        const d = dateTimePicker.value.getConsumableDateTime();
        if (d?.startTime && d?.endTime) {
          usageRange.start = d.startTime;
          usageRange.end = d.endTime;
        }
      }
      usageRange.key++;
    };
    // Apply on any value change (relative or absolute), not just on @hide, so a
    // calendar selection immediately re-renders the charts below.
    watch(dateRange, onRangeChange, { deep: true });
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
        label: 'GB',
        value: "gb",
        icon: "storage",
      },
      {
        label: 'MB',
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
      usageStreamEnabled,
      dateTimePicker,
      dateRange,
      onRangeChange,
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
