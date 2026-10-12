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
          <OTag variant="purple-soft" size="sm" :label="t('autoobserve.demo')" />
          <OToggleGroup
            mobile-dropdown
            :model-value="scenario"
            data-test="autoobserve-scenario"
            @update:model-value="(v) => setScenario(v as Scenario)"
          >
            <OToggleGroupItem
              v-for="s in SCENARIOS"
              :key="s"
              :value="s"
              size="sm"
              :data-test="`autoobserve-scenario-${s}`"
            >
              {{ t(SCENARIO_LABEL[s]) }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </template>

      <template #header-tabs>
        <OTabs v-model="tab" align="left" data-test="autoobserve-tabs">
          <OTab name="status" data-test="autoobserve-tab-status">
            <OIcon name="monitor-heart" size="sm" />
            <span>{{ t("autoobserve.tabs.status") }}</span>
          </OTab>
          <OTab name="issues" data-test="autoobserve-tab-issues">
            <OIcon name="notifications-active" size="sm" />
            <span>{{ t("autoobserve.tabs.issues") }}</span>
            <OTag
              v-if="openIssues.length"
              variant="error-soft"
              size="xs"
              :label="raw(String(openIssues.length))"
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
          <OTab name="howItWorks" data-test="autoobserve-tab-how-it-works">
            <OIcon name="lightbulb-outline" size="sm" />
            <span>{{ t("autoobserve.tabs.howItWorks") }}</span>
          </OTab>
        </OTabs>
      </template>

      <AutoObserveStatusTab
        v-if="tab === 'status'"
        :scenario="scenario"
        :issues="issues"
        :ledger="ledger"
        @open-issue="openIssue"
        @go="(target) => (tab = target)"
      />
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
      />
      <AutoObserveActivityTab
        v-else-if="tab === 'activity'"
        :key="scenario"
        :ledger="ledger"
        :highlight-id="highlightId"
        @update-entry="updateEntry"
        @open-incident="openIncident"
      />
      <AutoObservePolicyTab v-else-if="tab === 'policy'" />
      <AutoObserveHowItWorksTab
        v-else
        :scenario="scenario"
        v-model:step="howStep"
        v-model:overview="howOverview"
        @go="openExample"
      />
    </OPageLayout>

    <AutoObserveIssueDrawer
      v-model:open="drawerOpen"
      :issue="selectedIssue"
      :ledger="ledger"
      @update-entry="updateEntry"
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
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import AutoObserveStatusTab from "@/components/autoobserve/AutoObserveStatusTab.vue";
import AutoObserveIssuesTab from "@/components/autoobserve/AutoObserveIssuesTab.vue";
import AutoObserveCoverageTab from "@/components/autoobserve/AutoObserveCoverageTab.vue";
import AutoObserveActivityTab from "@/components/autoobserve/AutoObserveActivityTab.vue";
import AutoObservePolicyTab from "@/components/autoobserve/AutoObservePolicyTab.vue";
import AutoObserveHowItWorksTab from "@/components/autoobserve/AutoObserveHowItWorksTab.vue";
import AutoObserveIssueDrawer from "@/components/autoobserve/AutoObserveIssueDrawer.vue";
import ViewSwitch from "@/components/autoobserve/v2/ViewSwitch.vue";
import { issuesFor, type Issue, type Scenario } from "@/components/autoobserve/fixtures";
import { SCENARIOS, problemsIn } from "@/components/autoobserve/data/facts";
import { useScenario } from "@/components/autoobserve/data/useScenario";
import { useIssueLedger } from "@/components/autoobserve/useIssueLedger";
import { SCENARIO_LABEL } from "@/components/autoobserve/v2/fixtures";

const { t } = useI18nTyped();

const { scenario, setScenario: setSharedScenario } = useScenario();
const route = useRoute();
const router = useRouter();
const tab = ref(typeof route.query.tab === "string" ? route.query.tab : "status");
const { overrides, ledger, updateEntry, issueByIncident } = useIssueLedger(scenario, t);
const drawerOpen = ref(false);
const selectedIssue = ref<Issue | null>(null);

const issues = computed(() => issuesFor(scenario.value, t, overrides.value.fixed));
const openIssues = computed(() =>
  issues.value.filter((i) => i.status !== "resolved" && !i.deferred),
);
const awaitingCount = computed(() => ledger.value.filter((e) => e.status === "awaiting").length);

const setScenario = (next: Scenario) => {
  void setSharedScenario(next);
  drawerOpen.value = false;
};

const highlightId = ref<string | undefined>();
const howStep = ref(0);
const howOverview = ref(false);

watch(tab, (next) => {
  if (next !== "activity") highlightId.value = undefined;
});

// Following a "See it in" link is an explicit jump to the example, which lives in the demo week.
const openExample = (target: string, focusId?: string) => {
  setScenario("demo");
  if (target === "activity") highlightId.value = focusId;
  tab.value = target;
  const issue = target === "issues" && issuesFor("demo", t).find((i) => i.id === focusId);
  if (issue) openIssue(issue);
};

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
  linkedIssue && problemsIn(scenario.value, "month").some((p) => p.incidentId === linkedIssue);
if (linkedIssue && knownIssue) {
  const issue = issues.value.find((i) => i.id === linkedIssue) ?? issueByIncident(linkedIssue);
  if (issue) openIssue(issue);
} else if (linkedIssue) {
  void router.replace({ query: { ...route.query, issue: undefined } });
}
</script>
