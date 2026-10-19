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

    <!-- Account-wide, so it sits above every tab as it did on main; same cases and wording as the AI chat notice. -->
    <OBanner
      v-if="aiCreditsMessage"
      variant="warning"
      icon="warning"
      inline-actions
      dense
      data-test="billings-usageview-ai-exhausted"
    >
      <span class="font-semibold">{{ t("aiAssistant.creditsExhausted") }}</span>
      <span class="ms-1">{{ aiCreditsMessage }}</span>
      <template v-if="aiCreditsAction" #actions>
        <OButton
          variant="warning"
          size="xs"
          data-test="billings-usageview-ai-exhausted-action"
          @click="aiCreditsAction.run"
          >{{ aiCreditsAction.label }}</OButton
        >
      </template>
    </OBanner>

    <!-- A failed Refresh keeps the last good numbers on screen and says so, rather than wiping them. -->
    <OBanner
      v-if="refreshFailed"
      variant="warning"
      icon="warning"
      inline-actions
      dense
      data-test="billings-usageview-refresh-failed"
    >
      {{ t("billing.usageV2.refreshFailed") }}
      <template #actions>
        <OButton
          variant="warning"
          size="xs"
          data-test="billings-usageview-refresh-retry"
          @click="loadDetails"
          >{{ t("common.retry") }}</OButton
        >
      </template>
    </OBanner>

    <!-- The page's own shape, not a spinner: nothing moves once the data lands. -->
    <div v-if="loading && lastLoadedAt === null" class="min-h-0 flex-1 overflow-hidden">
      <UsageOverviewSkeleton data-test="billings-usageview-loading" />
    </div>

    <!-- Nothing loaded yet: a load failure replaces the tabs, in plain words with a way to try again. -->
    <div v-else-if="loadFailure" class="min-h-0 flex-1" data-test="billings-usageview-error">
      <OEmptyState
        size="hero"
        variant="error"
        illustration="broken-panel"
        :title="t('billing.usageV2.loadFailedTitle')"
        :description="
          loadFailure === 'network'
            ? t('billing.usageV2.loadFailedNetwork')
            : t('billing.usageV2.loadFailedServer')
        "
        :action-label="t('common.retry')"
        action-icon="refresh"
        @action="loadDetails"
      />
    </div>

    <div
      v-else
      class="min-h-0 flex-1"
      :class="
        activeTab === 'overview' || (activeTab === 'budget' && billingOrgs.length)
          ? 'overflow-hidden'
          : 'overflow-auto'
      "
    >
      <!-- Kept alive, so a tab seen once comes back as it was left, with no new queries. -->
      <KeepAlive>
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
      </KeepAlive>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import config from "@/aws-exports";
import { siteURL } from "@/constants/config";
import BillingService, { type AiUsage } from "@/services/billings";
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
  const query: LocationQueryRaw = { ...route.query, tab: value };
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
/** Why the first load failed: no answer at all, or an error from the server. */
const loadFailure = ref<"network" | "server" | null>(null);
/** A Refresh failed while the page still holds an earlier bill. */
const refreshFailed = ref(false);
const lastLoadedAt = ref<number | null>(null);

/** A super org's orgs, itself first; empty for any other org. */
const billingOrgs = ref<BillingOrg[]>([]);

/** A failure reads as "not a super org", so the page still shows the bill by meter. */
const fetchBillingOrgs = async (): Promise<BillingOrg[]> => {
  const orgId = store.state.selectedOrganization.identifier;
  try {
    const res = await BillingService.list_billing_group_members(orgId);
    return billingGroupOrgs(res?.data, orgId);
  } catch {
    return [];
  }
};

/** Never cached by house rule; the range segment is ignored and the cycle comes back. */
const fetchMetering = async () => {
  if (USE_METERING_MOCK) return mockMeteringResponse();
  const apiResponse = await BillingService.get_data_usage(
    store.state.selectedOrganization.identifier,
    "30days",
    "gb",
  );
  return parseMeteringResponse(apiResponse?.data?.price_details);
};

const aiUsage = ref<AiUsage | null>(null);

/** Cloud only, as on main; a failed read just leaves the warning out. */
const loadAiUsage = async () => {
  if (config.isCloud !== "true") return;
  try {
    aiUsage.value = (
      await BillingService.get_ai_usage(store.state.selectedOrganization.identifier)
    ).data;
  } catch {
    aiUsage.value = null;
  }
};

/** Why AI stopped, for a contract, a billing-group member, or an org that pays by subscription. */
const aiCreditsMessage = computed(() => {
  const usage = aiUsage.value;
  if (usage?.mode !== "exhausted") return null;
  if (usage.requires_additional_credits) return t("billing.aiContractExhaustedMessage");
  if (usage.payer_org_id)
    return t("billing.aiPayerSubscribeMessage", { payer: usage.payer_org_id });
  return t("billing.aiExhaustedMessage");
});

/** A member org has nothing to do here: its message names the org that pays. */
const aiCreditsAction = computed(() => {
  const usage = aiUsage.value;
  if (usage?.mode !== "exhausted") return null;
  if (usage.requires_additional_credits) {
    return {
      label: t("billing.contactLabel"),
      run: () => window.open(siteURL.contactSales, "_blank"),
    };
  }
  if (usage.payer_org_id) return null;
  return {
    label: t("billing.plansLabel"),
    run: () =>
      router.push({
        name: "plans",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      }),
  };
});

const loadDetails = async () => {
  void loadAiUsage();
  loading.value = true;
  refreshFailed.value = false;
  try {
    // Published together: the bill alone renders the plain meter view, which then flips to the org view.
    const [metering, orgs] = await Promise.all([fetchMetering(), fetchBillingOrgs()]);
    response.value = metering;
    billingOrgs.value = orgs;
    lastLoadedAt.value = Date.now();
    loadFailure.value = null;
  } catch (e: any) {
    // The raw text ("Network Error") is not shown; the kind of failure picks the advice.
    if (response.value) refreshFailed.value = true;
    else loadFailure.value = e?.response ? "server" : "network";
  } finally {
    loading.value = false;
  }
};

onMounted(loadDetails);
</script>
