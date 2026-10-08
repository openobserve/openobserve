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
          <OTag variant="purple-soft" size="sm" :label="t('autoobserve.demo')" />
          <OToggleGroup
            mobile-dropdown
            :model-value="scenario"
            data-test="autoobserve-scenario"
            @update:model-value="(v) => setScenario(v as Scenario)"
          >
            <OToggleGroupItem value="quiet" size="sm" data-test="autoobserve-scenario-quiet">
              {{ t("autoobserve.scenarioQuiet") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="incident" size="sm" data-test="autoobserve-scenario-incident">
              {{ t("autoobserve.scenarioIncident") }}
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
              :label="raw(openIssues.length)"
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
              :label="raw(awaitingCount)"
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
      <AutoObserveCoverageTab v-else-if="tab === 'coverage'" :ledger="ledger" />
      <AutoObserveActivityTab
        v-else-if="tab === 'activity'"
        :key="scenario"
        :ledger="ledger"
        :highlight-id="highlightId"
        @update-entry="updateEntry"
      />
      <AutoObservePolicyTab v-else-if="tab === 'policy'" />
      <AutoObserveHowItWorksTab
        v-else
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
import { computed, reactive, ref, watch } from "vue";
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
import {
  issuesFor,
  ledgerFor,
  type Issue,
  type LedgerEntry,
  type Scenario,
} from "@/components/autoobserve/fixtures";

const { t } = useI18nTyped();

const scenario = ref<Scenario>("quiet");
const tab = ref("status");
// One state per entry id, so an entry present in both scenarios keeps its edits across a switch.
const entries = reactive<Record<string, LedgerEntry>>(
  Object.fromEntries(ledgerFor("incident").map((e) => [e.id, e])),
);
const ledger = computed(() => ledgerFor(scenario.value).map((e) => entries[e.id]));
const drawerOpen = ref(false);
const selectedIssue = ref<Issue | null>(null);

const issues = computed(() => issuesFor(scenario.value));
const openIssues = computed(() =>
  issues.value.filter((i) => i.status !== "resolved" && !i.deferred),
);
const awaitingCount = computed(() => ledger.value.filter((e) => e.status === "awaiting").length);

const setScenario = (next: Scenario) => {
  scenario.value = next;
  drawerOpen.value = false;
};

const highlightId = ref<string | undefined>();
const howStep = ref(0);
const howOverview = ref(false);

// The walkthrough tells the incident-day story, so the selector follows it while the tab is open.
watch(tab, (next) => {
  if (next === "howItWorks") setScenario("incident");
  if (next !== "activity") highlightId.value = undefined;
});

const openExample = (target: string, focusId?: string) => {
  setScenario("incident");
  if (target === "activity") highlightId.value = focusId;
  tab.value = target;
  const issue = target === "issues" && issues.value.find((i) => i.id === focusId);
  if (issue) openIssue(issue);
};

const openIssue = (issue: Issue) => {
  selectedIssue.value = issue;
  drawerOpen.value = true;
};

const updateEntry = (id: string, patch: Partial<LedgerEntry>) => {
  entries[id] = { ...entries[id], ...patch };
};
</script>
