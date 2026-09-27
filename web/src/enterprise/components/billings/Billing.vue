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
  <OPageLayout :title="raw(headerBasedOnRoute())" icon="paid" bleed>
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
      before-class="border-e border-border-default"
      class="min-h-0 flex-1"
    >
      <template v-slot:before>
        <div class="h-full w-full ps-2.5 pt-2 pb-2.5">
          <div class="h-full overflow-y-auto">
            <OTabs v-model="billingtab" orientation="vertical">
              <ORouteTab
                exact
                name="plans"
                :to="
                  '/billings/plans?org_identifier=' + store.state.selectedOrganization.identifier
                "
                :icon="'img:' + getImageURL('images/common/plan_icon.svg')"
                :label="t('billing.plansLabel')"
              />
              <ORouteTab
                exact
                name="usage"
                :to="
                  '/billings/usage?org_identifier=' + store.state.selectedOrganization.identifier
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
        <div class="flex h-full w-full flex-col pt-2">
          <div class="flex min-h-0 flex-1 gap-2.5 pe-2.5 pb-2.5">
            <div class="h-full min-w-0 flex-1 overflow-y-auto">
              <router-view title=""> </router-view>
            </div>
          </div>
        </div>
      </template>
    </OSplitter>
  </OPageLayout>
</template>

<script lang="ts">
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OButton from "@/lib/core/Button/OButton.vue";
// @ts-ignore
import { defineComponent, ref, computed, onMounted, provide, reactive, watch } from "vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import BillingService from "@/services/billings";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

export default defineComponent({
  name: "PageIngestion",
  components: {
    OPageLayout,
    OTabs,
    ORouteTab,
    OSplitter,
    OButton,
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router: any = useRouter();
    // Default/fallback tab is "plans" — that's where /billings redirects on
    // mount, so falling back to "usage" made the Usage tab flash-highlight
    // first before the redirect settled.
    const billingtab = ref(
      resolveTab("billings", router.currentRoute.value.name as string, "plans"),
    );
    const showSidebar = ref(true);
    const lastSplitterPosition = ref(200);
    const splitterModel = ref(220);
    const billingProvider = ref(""); // empty until loaded
    const isPaidUser = ref(false);
    const billingInfoLoaded = ref(false);

    // Fetch billing info to determine provider
    const fetchBillingInfo = async () => {
      try {
        const res = await BillingService.list_subscription(
          store.state.selectedOrganization.identifier,
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
    const collapseSidebar = () => {
      showSidebar.value = !showSidebar.value;
      if (showSidebar.value) {
        splitterModel.value = lastSplitterPosition.value;
      } else {
        lastSplitterPosition.value = splitterModel.value;
        splitterModel.value = 0;
      }
    };

    const { isMobile } = useBreakpoint();
    watch(
      isMobile,
      (mobile) => {
        if (mobile && showSidebar.value) collapseSidebar();
      },
      { immediate: true },
    );

    onMounted(async () => {
      // Fetch billing info to determine provider type
      await fetchBillingInfo();

      if (
        router.currentRoute.value.name == "billings" ||
        router.currentRoute.value.name == "plans"
      ) {
        billingtab.value = "plans";
        router.push({
          path: "/billings/plans",
          query: { org_identifier: store.state.selectedOrganization.identifier },
        });
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
    const isUsageRoute = computed(() => {
      return router.currentRoute.value.name == "usage";
    });
    const isOrgGroupRoute = computed(() => {
      return router.currentRoute.value.name == "billing_group";
    });
    // Shared with the BillingGroup route component (via inject): the child sets
    // canInvite based on the org's role and we bump trigger to open its invite panel.
    const orgGroupInvite = reactive({
      trigger: 0,
      canInvite: false,
    });
    provide("orgGroupInvite", orgGroupInvite);
    return {
      raw,
      t,
      store,
      router,
      config,
      billingtab,
      getImageURL,
      splitterModel,
      headerBasedOnRoute,
      isUsageRoute,
      isOrgGroupRoute,
      orgGroupInvite,
      collapseSidebar,
      showSidebar,
      lastSplitterPosition,
      showInvoiceTab,
      billingProvider,
      isPaidUser,
    };
  },
});
</script>
