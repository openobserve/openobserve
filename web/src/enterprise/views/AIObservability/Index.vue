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
  AI Observability module shell — mirrors the Settings/IAM scaffold so the
  module fits the new app-wide UX (left section rail + breadcrumb in the top
  chrome). The rail is data-driven via SectionHubGroup[]; routing each item
  picks the route the rail/breadcrumb highlight.
-->
<template>
  <PageLayout :sidebar-width="232">
    <template #sidebar>
      <SectionRail
        :groups="sectionGroups"
        :active-key="activeSection"
        :title="t('aiObservability.title')"
      />
    </template>

    <section class="tw:h-full tw:min-w-0 tw:min-h-0 tw:overflow-y-auto">
      <router-view />
    </section>
  </PageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import PageLayout from "@/components/common/PageLayout.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import type {
  SectionHubGroup,
  SectionHubItem,
} from "@/components/common/SectionHub.vue";

defineOptions({ name: "AIObservabilityShell" });

const { t } = useI18n();
const store = useStore();
const route = useRoute();

type EvalTab = "quality" | "jobs" | "scorers" | "scoreConfigs";

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

function evalLink(tab: EvalTab) {
  return { name: "aiEvaluations", query: { ...orgQuery.value, tab } };
}

// Section key for the rail's `active-key`. Evaluations sub-pages share the
// route name `aiEvaluations`; `?tab=` distinguishes them so we map it down
// to the rail's per-item keys.
const activeSection = computed<string>(() => {
  if (route.name === "aiLLMInsights") return "llmInsights";
  if (route.name === "aiSessions") return "sessions";
  if (route.name === "aiEvaluations") {
    const tab = (route.query.tab as string) || "quality";
    return tab;
  }
  return "";
});

// Single source of truth for the rail items (groups) AND the breadcrumb
// switcher. Order here is the order shown in the rail.
const sectionItems = computed<(SectionHubItem & { group: string })[]>(() => [
  {
    key: "llmInsights",
    label: t("aiObservability.nav.llmInsights"),
    icon: "dashboard",
    to: { name: "aiLLMInsights", query: orgQuery.value },
    dataTest: "ai-secondary-nav-llm-insights",
    group: "Monitor",
  },
  {
    key: "sessions",
    label: t("aiObservability.nav.sessions"),
    icon: "forum",
    to: { name: "aiSessions", query: orgQuery.value },
    dataTest: "ai-secondary-nav-sessions",
    group: "Monitor",
  },
  {
    key: "quality",
    label: t("aiObservability.nav.quality"),
    icon: "star-rate",
    to: evalLink("quality"),
    dataTest: "ai-secondary-nav-quality",
    group: "Evaluate",
  },
  {
    key: "jobs",
    label: t("aiObservability.nav.evalJobs"),
    icon: "event",
    to: evalLink("jobs"),
    dataTest: "ai-secondary-nav-eval-jobs",
    group: "Evaluate",
  },
  {
    key: "scorers",
    label: t("aiObservability.nav.scorers"),
    icon: "rule",
    to: evalLink("scorers"),
    dataTest: "ai-secondary-nav-scorers",
    group: "Evaluate",
  },
  {
    key: "scoreConfigs",
    label: t("aiObservability.nav.scoreConfigs"),
    icon: "tune",
    to: evalLink("scoreConfigs"),
    dataTest: "ai-secondary-nav-score-configs",
    group: "Evaluate",
  },
]);

const activeSectionItem = computed(() =>
  sectionItems.value.find((i) => i.key === activeSection.value),
);

// Group order: Monitor before Evaluate.
const sectionGroupOrder = ["Monitor", "Evaluate"];

const sectionGroups = computed<SectionHubGroup[]>(() => {
  const buckets = new Map<string, SectionHubItem[]>();
  for (const item of sectionItems.value) {
    const g = item.group;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(item);
  }
  const rank = (label: string) => {
    const i = sectionGroupOrder.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...buckets.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((label) => ({ label, items: buckets.get(label)! }));
});

// Reserved for future per-section header chrome wiring (mirrors Settings'
// activeSectionItem use). Keeping the reference live for clarity.
void activeSectionItem;
</script>
