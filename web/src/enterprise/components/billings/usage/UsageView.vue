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

<!--
  The Usage tab: cost now, cost over time, and cost if you grow.

  One fetch of the metering API serves all three tabs, so the cycle, the rates
  and the totals cannot disagree between them.
-->
<template>
  <div class="flex h-full flex-col gap-2.5 px-3" data-test="billings-usageview-root">
    <OTabs
      :model-value="activeTab"
      data-test="billings-usageview-tabs"
      class="border-b"
      @update:model-value="selectTab"
    >
      <OTab name="overview" :label="t('billing.usageV2.overviewTab')" />
      <OTab name="trends" :label="t('billing.usageV2.trendsTab')" />
      <OTab name="budget" :label="t('billing.usageV2.budgetTab')" />
      <OTab name="estimation" :label="t('billing.usageV2.estimationTab')" />
    </OTabs>

    <!-- The page's own shape, not a spinner: nothing moves once the data lands. -->
    <div v-if="loading && lastLoadedAt === null" class="min-h-0 flex-1 overflow-hidden">
      <UsageOverviewSkeleton data-test="billings-usageview-loading" />
    </div>

    <OBanner
      v-else-if="loadError"
      variant="error"
      :content="loadError"
      data-test="billings-usageview-error"
    />

    <div
      v-else
      class="min-h-0 flex-1"
      :class="
        activeTab === 'overview' || (activeTab === 'budget' && billingOrgs.length)
          ? 'overflow-hidden'
          : 'overflow-auto'
      "
    >
      <UsageOverview
        v-if="activeTab === 'overview'"
        :details="details"
        :billing-orgs="billingOrgs"
        :last-loaded-at="lastLoadedAt"
        :refreshing="loading"
        @refresh="loadDetails"
      />
      <UsageTrends
        v-else-if="activeTab === 'trends'"
        :details="details"
        :cycles="cycles"
        :oldest-ts="response?.oldest_ts"
        :billing-orgs="billingOrgs"
        @refresh="loadDetails"
      />
      <UsageSuperBudget
        v-else-if="activeTab === 'budget' && billingOrgs.length"
        :details="details"
        :billing-orgs="billingOrgs"
      />
      <UsageBudget v-else-if="activeTab === 'budget'" :details="details" />
      <UsageEstimator v-else :details="details" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import type { I18nText } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import BillingService from "@/services/billings";
import UsageOverview from "./UsageOverview.vue";
import UsageOverviewSkeleton from "./UsageOverviewSkeleton.vue";
import { mockMeteringResponse, USE_METERING_MOCK } from "./meteringMock";
import UsageTrends from "./UsageTrends.vue";
import UsageEstimator from "./UsageEstimator.vue";
import UsageBudget from "./UsageBudget.vue";
import UsageSuperBudget from "./UsageSuperBudget.vue";
import {
  billingGroupOrgs,
  cyclesNewestFirst,
  parseMeteringResponse,
  type BillingOrg,
  type MeteringDetails,
  type MeteringResponse,
} from "./meteringModel";

const { t } = useI18nTyped();
const store = useStore();

type UsageTab = "overview" | "trends" | "budget" | "estimation";

const TABS: UsageTab[] = ["overview", "trends", "budget", "estimation"];

const route = useRoute();
const router = useRouter();

/** The tab lives in the URL, so a refresh or a shared link lands where the user was. */
const activeTab = computed<UsageTab>(() => {
  const value = String(route.query.tab ?? "");
  return TABS.includes(value as UsageTab) ? (value as UsageTab) : "overview";
});

/**
 * Leaving Overview drops its selection, because a meter that Overview no longer
 * shows would still be sitting in the URL when the user comes back.
 */
const selectTab = (value: unknown) => {
  if (typeof value !== "string" || !TABS.includes(value as UsageTab)) return;
  const query = { ...route.query, tab: value };
  if (value !== "overview") {
    delete query.meter;
    delete query.group;
  }
  router.replace({ query });
};
const response = ref<MeteringResponse | null>(null);

/** The cycle being billed now; every card, table and rate on Overview reads this one. */
const details = computed<MeteringDetails | null>(() => response.value?.upcoming ?? null);

/** Current cycle first, then closed cycles, which is what a trend range counts back through. */
const cycles = computed(() => cyclesNewestFirst(response.value));
const loading = ref(false);
const loadError = ref<I18nText | null>(null);
const lastLoadedAt = ref<number | null>(null);

/** A super org's orgs, itself first; empty for any other org. */
const billingOrgs = ref<BillingOrg[]>([]);

/** A failure reads as "not a super org", so the page still shows the bill by meter. */
const loadBillingOrgs = async () => {
  const orgId = store.state.selectedOrganization.identifier;
  try {
    const res = await BillingService.list_billing_group_members(orgId);
    billingOrgs.value = billingGroupOrgs(res?.data, orgId);
  } catch {
    billingOrgs.value = [];
  }
};

/** The endpoint still takes a range segment, but the metering path ignores it and returns the cycle. */
const loadDetails = async () => {
  loading.value = true;
  loadError.value = null;
  try {
    if (USE_METERING_MOCK) {
      response.value = mockMeteringResponse();
      lastLoadedAt.value = Date.now();
      return;
    }
    // Billing reads are never cached by house rule, so this calls the service directly.
    const apiResponse = await BillingService.get_data_usage(
      store.state.selectedOrganization.identifier,
      "30days",
      "gb",
    );
    response.value = parseMeteringResponse(apiResponse?.data?.price_details);
    // Reloaded with the bill, so Refresh also picks up an org that joined the group.
    loadBillingOrgs();
    lastLoadedAt.value = Date.now();
  } catch (e: any) {
    response.value = null;
    loadError.value = raw(e?.message) || t("billing.usageV2.loadFailed");
  } finally {
    loading.value = false;
  }
};

onMounted(loadDetails);
</script>
