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

<template>
  <div class="flex h-full flex-col gap-2.5 px-3" data-test="billings-usageview-root">
    <div
      v-if="loading && lastLoadedAt === null"
      class="flex h-11 shrink-0 items-center gap-6 border-b px-3 pt-0.75"
      data-test="billings-usageview-tabs-loading"
    >
      <OSkeleton
        v-for="width in TAB_SKELETON_WIDTHS"
        :key="width"
        type="text"
        :class="['h-4', width]"
      />
    </div>
    <!-- With Overview as the only view, a one-tab bar is just noise, so it goes. -->
    <OTabs
      v-else-if="billed"
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

    <!-- A member's own page shows usage only, so it says where the costs went. -->
    <OBanner
      v-if="payer !== null"
      variant="info"
      icon="info"
      dense
      data-test="billings-usageview-payer"
    >
      {{ t("billing.usageV2.billedThrough", { payer }) }}
    </OBanner>

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

    <div v-if="creditMeter" data-test="billings-usage-ai-summary">
      <AssistantCreditMeter
        size="card"
        :usage="creditMeter.usage.value"
        :overage="creditMeter.overage.data.value ?? null"
        :status="creditMeter.status.value"
        :can-manage="creditMeter.canManage.value"
        :org-name="creditMeter.orgName.value"
        @retry="creditMeter.retry"
      />
    </div>

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
          :details="billed ? details : volume"
          :billing-orgs="billed ? billingOrgs : []"
          :last-loaded-at="lastLoadedAt"
          :projected="billed ? projected : null"
          :refreshing="loading"
          :volume-only="!billed"
          :org-costs="orgCosts"
          @refresh="refresh"
        />
        <UsageTrends
          v-else-if="activeTab === 'trends'"
          :details="details"
          :cycles="cycles"
          :oldest-ts="response?.oldest_ts"
          :billing-orgs="billingOrgs"
          :projected="projected"
          @refresh="refresh"
        />
        <UsageSuperBudget
          v-else-if="activeTab === 'budget' && billingOrgs.length"
          :details="details"
          :billing-orgs="billingOrgs"
          :projected="projected"
          :org-costs="orgCosts"
        />
        <UsageBudget v-else-if="activeTab === 'budget'" :details="details" :projected="projected" />
        <UsageEstimator v-else :details="details" :billing-orgs="billingOrgs" />
      </KeepAlive>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import AssistantCreditMeter from "@/components/ai-assistant/credits/AssistantCreditMeter.vue";
import config from "@/aws-exports";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useAssistantCreditMeter } from "../useAssistantCreditMeter";
import { siteURL } from "@/constants/config";
import BillingService, { type AiUsage } from "@/services/billings";
import UsageOverview from "./UsageOverview.vue";
import UsageOverviewSkeleton from "./UsageOverviewSkeleton.vue";
import { mockMeteringResponse, USE_METERING_MOCK } from "./meteringMock";
import UsageTrends from "./UsageTrends.vue";
import UsageEstimator from "./UsageEstimator.vue";
import UsageBudget from "./UsageBudget.vue";
import UsageSuperBudget from "./UsageSuperBudget.vue";
import { useUsageSearch } from "./useUsageSearch";
import { useOrgCosts, type OrgCostsState } from "./useOrgCosts";
import { eventVolumeSql, USAGE_STREAM_NAME } from "./usageQueries";
import {
  billingGroupOrgs,
  cyclesNewestFirst,
  parseMeteringResponse,
  projectCycleCost,
  volumeDetails,
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
/** An org with no bill has Overview only, so an old link to another tab opens Overview. */
const activeTab = computed<UsageTab>(() => {
  const value = String(route.query.tab ?? "");
  if (!billed.value) return "overview";
  return TABS.includes(value as UsageTab) ? (value as UsageTab) : "overview";
});

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

/** One projection for every tab, from the bill as it was loaded, so tabs opened at different times agree. */
const projected = computed(() => projectCycleCost(details.value, lastLoadedAt.value ?? undefined));

/** A super org's orgs, itself first; empty for any other org. */
const billingOrgs = ref<BillingOrg[]>([]);

const payer = ref<string | null>(null);
const isMember = computed(() => payer.value !== null);

const billed = computed(() => !!details.value && !isMember.value);

/** One grey label per tab a billed org gets, about as wide as its name. */
const TAB_SKELETON_WIDTHS = ["w-16", "w-14", "w-14", "w-28"];

/** An org with no bill: each meter's volume over the last 30 days, from its own `usage` stream. */
const volume = ref<MeteringDetails | null>(null);

const usageStreamEnabled = computed<boolean>(
  () => !!store.state?.organizationData?.organizationSettings?.usage_stream_enabled,
);

/** The paying org's name, or `null` for an org that is not a member. A failure keeps what is shown, as the org list does. */
const fetchPayer = async (): Promise<string | null> => {
  try {
    const res = await BillingService.get_billing_group_membership(
      store.state.selectedOrganization.identifier,
    );
    const membership = res?.data?.membership;
    return membership ? String(membership.payer_org_name || membership.payer_org_id || "") : null;
  } catch {
    return payer.value;
  }
};

const VOLUME_DAYS = 30;
const SECONDS_PER_DAY = 86_400;
const { search } = useUsageSearch();

/** The stream appears only once the org reports usage, so until then every meter reads zero. */
const fetchVolumes = async (): Promise<MeteringDetails> => {
  const end = Math.floor(Date.now() / 1000);
  const start = (Math.floor(end / SECONDS_PER_DAY) - (VOLUME_DAYS - 1)) * SECONDS_PER_DAY;
  try {
    const hits = await search(eventVolumeSql(store.state.selectedOrganization.identifier), {
      start: start * 1_000_000,
      end: end * 1_000_000,
      size: 100,
      key: "volumes",
    });
    const volumes = Object.fromEntries(
      hits.map((hit) => [String(hit.event ?? ""), Number(hit.volume) || 0]),
    );
    return volumeDetails(volumes, start, end);
  } catch (e: any) {
    const message = String(e?.response?.data?.message ?? e?.message ?? "").toLowerCase();
    if (message.includes("stream not found") && message.includes(USAGE_STREAM_NAME)) {
      return volumeDetails({}, start, end);
    }
    throw e;
  }
};

const fetchBillingOrgs = async (): Promise<BillingOrg[]> => {
  const orgId = store.state.selectedOrganization.identifier;
  try {
    const res = await BillingService.list_billing_group_members(orgId);
    return billingGroupOrgs(res?.data, orgId);
  } catch {
    return billingOrgs.value[0]?.id === orgId ? billingOrgs.value : [];
  }
};

/** Never cached by house rule; the range segment is ignored and the cycle comes back. */
const fetchMetering = async () => {
  if (USE_METERING_MOCK) return mockMeteringResponse();
  const apiResponse = await BillingService.get_data_usage(
    store.state.selectedOrganization.identifier,
    "30days",
  );
  return parseMeteringResponse(apiResponse?.data?.price_details);
};

const aiUsage = ref<AiUsage | null>(null);

/** Overlapping Refreshes can answer out of order; only the newest load may publish. */
let latestLoad = 0;

/** Cloud only, as on main; a failed read just leaves the warning out. */
const loadAiUsage = async (loadId: number) => {
  if (config.isCloud !== "true") return;
  try {
    const usage = (await BillingService.get_ai_usage(store.state.selectedOrganization.identifier))
      .data;
    if (loadId === latestLoad) aiUsage.value = usage;
  } catch {
    if (loadId === latestLoad) aiUsage.value = null;
  }
};

// The Plans card's meter on the shared reads, so a turn or a consent change shows here too; Cloud and v2 only.
const creditMeter = config.isCloud === "true" && isAssistantV2() ? useAssistantCreditMeter() : null;

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
  const loadId = ++latestLoad;
  void loadAiUsage(loadId);
  loading.value = true;
  refreshFailed.value = false;
  try {
    // Published together: the bill alone renders the plain meter view, which then flips to the org view.
    const [metering, orgs, payerName] = await Promise.all([
      fetchMetering(),
      fetchBillingOrgs(),
      fetchPayer(),
    ]);
    const usageOnly = !metering?.upcoming || payerName !== null;
    const volumes = usageOnly && usageStreamEnabled.value ? await fetchVolumes() : null;
    if (loadId !== latestLoad) return;
    response.value = metering;
    billingOrgs.value = orgs;
    payer.value = payerName;
    volume.value = volumes;
    lastLoadedAt.value = Date.now();
    loadFailure.value = null;
  } catch (e: any) {
    if (loadId !== latestLoad) return;
    // The raw text ("Network Error") is not shown; the kind of failure picks the advice.
    if (response.value) refreshFailed.value = true;
    else loadFailure.value = e?.response ? "server" : "network";
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

const refresh = () => {
  void loadDetails();
};

const orgCostRead = useOrgCosts(
  computed(() => (billed.value ? details.value : null)),
  computed(() => (billed.value ? billingOrgs.value : [])),
);
const orgCosts = computed<OrgCostsState>(() => ({
  costs: orgCostRead.costs.value,
  loading: orgCostRead.loading.value,
  failed: orgCostRead.failed.value,
}));

onMounted(loadDetails);

/** Turning reporting on from Overview starts the usage view of an org with no bill. */
watch(usageStreamEnabled, (on) => {
  if (on && !billed.value) void loadDetails();
});
</script>
