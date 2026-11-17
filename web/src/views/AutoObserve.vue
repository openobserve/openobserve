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
  <div data-test="autoobserve-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      tabs-below
      :title="t('autoobserve.title')"
      icon="navigation"
      :subtitle="t('autoobserve.subtitle')"
      title-data-test="autoobserve-title"
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <ViewSwitch />
        </div>
      </template>

      <template #header-tabs>
        <OTabs v-model="tab" align="left" data-test="autoobserve-tabs">
          <OTab name="issues" data-test="autoobserve-tab-issues">
            <OIcon name="notifications-active" size="sm" />
            <span>{{ t("autoobserve.tabs.issues") }}</span>
            <OTag
              v-if="badge"
              variant="error-soft"
              size="xs"
              :label="badge"
              data-test="autoobserve-tab-issues-badge"
            />
          </OTab>
          <OTab name="coverage" data-test="autoobserve-tab-coverage">
            <OIcon name="radar" size="sm" />
            <span>{{ t("autoobserve.tabs.coverage") }}</span>
          </OTab>
          <OTab name="activity" data-test="autoobserve-tab-activity">
            <OIcon name="history" size="sm" />
            <span>{{ t("autoobserve.tabs.activity") }}</span>
            <OTag
              v-if="approvals"
              variant="warning-soft"
              size="xs"
              :label="raw(String(approvals))"
              data-test="autoobserve-tab-activity-badge"
            />
          </OTab>
          <OTab name="policy" data-test="autoobserve-tab-policy">
            <OIcon name="tune" size="sm" />
            <span>{{ t("autoobserve.tabs.policy") }}</span>
          </OTab>
        </OTabs>
      </template>

      <LiveIssues v-if="tab === 'issues'" range="30d" />
      <AutoObserveCoverageTab
        v-else-if="tab === 'coverage'"
        :source="liveData.source.value"
        :skeleton="liveData.coverageSkeleton.value"
      />
      <AutoObserveActivityTab
        v-else-if="tab === 'activity'"
        :requests="liveData.requests.value"
        :requests-loading="liveData.railSkeleton.value"
        @see-suggestions="setDrawer('suggestions')"
      />
      <LivePolicy v-else @how-it-works="setDrawer('howItWorks')" />
    </OPageLayout>

    <AllSuggestionsDrawer
      :open="drawer === 'suggestions'"
      @update:open="(v) => setDrawer(v ? 'suggestions' : null)"
    />
    <HowItWorksDrawer
      :open="drawer === 'howItWorks'"
      @update:open="(v) => setDrawer(v ? 'howItWorks' : null)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import AutoObserveActivityTab from "@/components/autoobserve/AutoObserveActivityTab.vue";
import LivePolicy from "@/components/autoobserve/detailed/LivePolicy.vue";
import ViewSwitch from "@/components/autoobserve/v2/ViewSwitch.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import { useLiveAutoObserve } from "@/components/autoobserve/live/liveModel";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import { useLiveIssues } from "@/components/autoobserve/live/useLiveIssues";
import { openBadge } from "@/components/autoobserve/live/incidentsCopy";
import {
  AUTOOBSERVE_DRAWERS,
  type AutoObserveDrawer,
  type IssuesRange,
} from "@/components/autoobserve/v2/autoobserveRoute";

const NERD_TABS = ["issues", "coverage", "activity", "policy"] as const;
type NerdTab = (typeof NERD_TABS)[number];

const { t, locale } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const liveData = useLiveAutoObserve();
const linkedTab = route.query.tab;
const tab = ref<NerdTab>(NERD_TABS.find((name) => name === linkedTab) ?? "issues");
// The tab lives in the URL, so reload and browser Back land on the tab the reader picked.
watch(tab, (next) => {
  const value = next === "issues" ? undefined : next;
  if (value !== (route.query.tab ?? undefined))
    void router.replace({ query: { ...route.query, tab: value, section: undefined } });
});
watch(
  () => route.query.tab,
  (next) => {
    const named = NERD_TABS.find((name) => name === next) ?? "issues";
    if (named !== tab.value) tab.value = named;
  },
);
const liveIssues = useLiveIssues(computed<IssuesRange>(() => "30d"));
// A drawer lives in the URL, so browser Back closes it and a shared link opens it.
const drawer = computed<AutoObserveDrawer | null>(
  () => AUTOOBSERVE_DRAWERS.find((d) => d === route.query.drawer) ?? null,
);
const setDrawer = (next: AutoObserveDrawer | null) => {
  if (next === drawer.value) return;
  const query = { ...route.query, drawer: next ?? undefined };
  void (next ? router.push({ query }) : router.replace({ query }));
};

// Proposals whose next step is the Review change editor wait in the ledger's approval group.
const approvals = computed(
  () =>
    liveData.requests.value.filter((r) => r.insight.cta?.target.type === "review_change").length,
);
const badge = computed(() => {
  const open = liveIssues.openCount.value;
  return open ? openBadge(locale.value, open, liveIssues.hasMore.value) : null;
});
</script>
