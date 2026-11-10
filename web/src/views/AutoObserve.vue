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
              v-if="awaitingCount"
              variant="warning-soft"
              size="xs"
              :label="raw(String(awaitingCount))"
            />
          </OTab>
          <OTab name="policy" data-test="autoobserve-tab-policy">
            <OIcon name="tune" size="sm" />
            <span>{{ t("autoobserve.tabs.policy") }}</span>
          </OTab>
        </OTabs>
      </template>

      <LiveIssues v-if="tab === 'issues' && live" range="30d" />
      <AutoObserveIssuesTab
        v-else-if="tab === 'issues'"
        :issues="issues"
        :scenario="scenario"
        @open-issue="openIssue"
      />
      <AutoObserveCoverageTab
        v-else-if="tab === 'coverage'"
        :ledger="ledger"
        :scenario="scenario"
        :source="live ? liveData.source.value : undefined"
        :skeleton="live && liveData.coverageSkeleton.value"
      />
      <AppliedChangesList v-else-if="tab === 'activity' && live">
        <LiveSurfaceEmpty surface="changes" @action="allOpen = true" />
      </AppliedChangesList>
      <AutoObserveActivityTab
        v-else-if="tab === 'activity'"
        :ledger="ledger"
        @update-entry="updateEntry"
        @open-incident="openIncident"
      />
      <LiveSettingsPanel v-else-if="tab === 'policy' && live" in-page @action="howOpen = true" />
      <AutoObservePolicyTab v-else-if="tab === 'policy'" />
    </OPageLayout>

    <AutoObserveIssueDrawer
      v-model:open="drawerOpen"
      :issue="selectedIssue"
      :ledger="ledger"
      :scenario="scenario"
      @update-entry="updateEntry"
    />
    <AllSuggestionsDrawer v-if="live" v-model:open="allOpen" />
    <HowItWorksDrawer v-model:open="howOpen" />
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
import AutoObserveIssuesTab from "@/components/autoobserve/AutoObserveIssuesTab.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import AutoObserveActivityTab from "@/components/autoobserve/AutoObserveActivityTab.vue";
import AutoObservePolicyTab from "@/components/autoobserve/AutoObservePolicyTab.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import ViewSwitch from "@/components/autoobserve/v2/ViewSwitch.vue";
import HowItWorksDrawer from "@/components/autoobserve/v2/HowItWorksDrawer.vue";
import { useLiveAutoObserve, useLiveMode } from "@/components/autoobserve/live/liveModel";
import LiveIssues from "@/components/autoobserve/live/LiveIssues.vue";
import LiveSurfaceEmpty from "@/components/autoobserve/live/LiveSurfaceEmpty.vue";
import LiveSettingsPanel from "@/components/autoobserve/live/LiveSettingsPanel.vue";
import AppliedChangesList from "@/components/autoobserve/decisions/AppliedChangesList.vue";
import AllSuggestionsDrawer from "@/components/autoobserve/live/AllSuggestionsDrawer.vue";
import { useLiveIssues } from "@/components/autoobserve/live/useLiveIssues";
import { openBadge } from "@/components/autoobserve/live/incidentsCopy";
import type { IssuesRange } from "@/components/autoobserve/v2/fixtures";
import { issuesFor, type Issue, type Scenario } from "@/components/autoobserve/fixtures";
import { problemsIn } from "@/components/autoobserve/data/facts";
import { useIssueLedger } from "@/components/autoobserve/useIssueLedger";

const NERD_TABS = ["issues", "coverage", "activity", "policy"] as const;
type NerdTab = (typeof NERD_TABS)[number];

const { t, locale } = useI18nTyped();

// Nerd ignores the shared ?scenario= param; only Standard switches scenario.
const scenario = computed<Scenario>(() => "demo");
const route = useRoute();
const router = useRouter();
const live = useLiveMode();
const liveData = useLiveAutoObserve();
const linkedTab = route.query.tab;
const tab = ref<NerdTab>(NERD_TABS.find((name) => name === linkedTab) ?? "issues");
// The tab lives in the URL, so reload and browser Back land on the tab the reader picked.
watch(tab, (next) => {
  const value = next === "issues" ? undefined : next;
  if (value !== (route.query.tab ?? undefined))
    void router.replace({ query: { ...route.query, tab: value } });
});
watch(
  () => route.query.tab,
  (next) => {
    const named = NERD_TABS.find((name) => name === next) ?? "issues";
    if (named !== tab.value) tab.value = named;
  },
);
const liveIssues = useLiveIssues(computed<IssuesRange>(() => "30d"));
const { overrides, ledger, updateEntry, issueByIncident } = useIssueLedger(scenario, t);
const drawerOpen = ref(false);
const selectedIssue = ref<Issue | null>(null);

const issues = computed(() => issuesFor(scenario.value, t, overrides.value.fixed));
const openIssues = computed(() =>
  issues.value.filter((i) => i.status !== "resolved" && !i.deferred),
);
const awaitingCount = computed(() =>
  live.value ? 0 : ledger.value.filter((e) => e.status === "awaiting").length,
);
const allOpen = ref(false);
const howOpen = ref(false);
const badge = computed(() => {
  if (!live.value) return openIssues.value.length ? raw(String(openIssues.value.length)) : null;
  const open = liveIssues.openCount.value;
  return open ? openBadge(locale.value, open, liveIssues.hasMore.value) : null;
});

const openIssue = (issue: Issue) => {
  selectedIssue.value = issue;
  drawerOpen.value = true;
};

const openIncident = (incidentId: string) => {
  const issue = issues.value.find((i) => i.id === incidentId) ?? issueByIncident(incidentId);
  if (issue) openIssue(issue);
};

const linkedIssue = typeof route.query.issue === "string" ? route.query.issue : null;
// Only an incident the current scenario contains opens; any other link is dropped from the URL.
const knownIssue =
  linkedIssue &&
  !live.value &&
  problemsIn(scenario.value, "month").some((p) => p.incidentId === linkedIssue);
if (linkedIssue && knownIssue) {
  const issue = issues.value.find((i) => i.id === linkedIssue) ?? issueByIncident(linkedIssue);
  if (issue) openIssue(issue);
} else if (linkedIssue) {
  void router.replace({ query: { ...route.query, issue: undefined } });
}
</script>
