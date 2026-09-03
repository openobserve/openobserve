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
  <OPageLayout bleed :sidebar-width="railCollapsed ? RAIL_COLLAPSED_WIDTH : RAIL_WIDTH">
    <template #sidebar>
      <SectionRail
        v-model:collapsed="railCollapsed"
        :groups="sectionGroups"
        :active-key="activeSection"
        :title="t('aiObservability.title')"
        :icon="AI_ICON"
        collapsible
      />
    </template>

    <section class="h-full min-h-0 min-w-0 overflow-y-auto">
      <router-view />
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import type { SectionHubGroup, SectionHubItem } from "@/components/common/SectionHub.vue";
import { navSection } from "./navSection";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** The same mark the primary nav uses for this module, so the collapsed rail
 *  still says which module it belongs to. */
const AI_ICON: IconName = "auto-awesome";

// Wide enough for one icon plus the pill's own inset; the expanded width is
// unchanged from before the toggle existed.
const RAIL_WIDTH = 230;
const RAIL_COLLAPSED_WIDTH = 52;
const RAIL_STORAGE_KEY = "o2-ai-rail-collapsed";

// Remembered per browser: a rail you collapsed should not reopen every time you
// leave the module. Storage can throw (private mode), and the rail opening
// expanded is a fine outcome when it does.
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const railCollapsed = ref(readCollapsed());

watch(railCollapsed, (value) => {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, String(value));
  } catch {
    // Unavailable storage keeps the toggle working for this session only.
  }
});

defineOptions({ name: "AIObservabilityShell" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();

type EvalTab = "quality" | "jobs" | "scorers" | "scoreConfigs";

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

function evalLink(tab: EvalTab) {
  return { name: "aiEvaluations", query: { ...orgQuery.value, tab } };
}

const activeSection = computed<string>(() => navSection(route.name, route.query.tab));

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
    key: "agentGraph",
    label: t("aiObservability.nav.agentGraph"),
    icon: "hub",
    to: { name: "aiAgentGraph", query: orgQuery.value },
    dataTest: "ai-secondary-nav-agent-graph",
    group: "Monitor",
  },
  {
    key: "agentBehavior",
    label: t("aiObservability.nav.agentBehavior"),
    icon: "troubleshoot",
    to: { name: "aiAgentBehavior", query: orgQuery.value },
    dataTest: "ai-secondary-nav-agent-behavior",
    group: "Monitor",
  },
  {
    key: "discovery",
    label: t("aiObservability.nav.discovery"),
    icon: "saved-search",
    to: { name: "aiDiscovery", query: orgQuery.value },
    dataTest: "ai-secondary-nav-discovery",
    group: "Annotate",
  },
  {
    key: "queues",
    label: t("aiObservability.nav.queues"),
    icon: "fact-check",
    to: { name: "aiQueues", query: orgQuery.value },
    dataTest: "ai-secondary-nav-queues",
    group: "Annotate",
  },
  {
    key: "datasets",
    label: t("aiObservability.nav.datasets"),
    icon: "table-chart",
    to: { name: "aiDatasets", query: orgQuery.value },
    dataTest: "ai-secondary-nav-datasets",
    group: "Annotate",
  },
  {
    key: "playground",
    label: t("aiObservability.nav.playground"),
    icon: "play-circle",
    to: { name: "aiPlayground", query: orgQuery.value },
    dataTest: "ai-secondary-nav-playground",
    group: "Experiment",
  },
  {
    key: "experiments",
    label: t("aiObservability.nav.experiments"),
    icon: "science",
    to: { name: "aiExperiments", query: orgQuery.value },
    dataTest: "ai-secondary-nav-experiments",
    group: "Experiment",
  },
  {
    key: "remoteTasks",
    label: t("aiObservability.nav.remoteTasks"),
    icon: "cloud-upload",
    to: { name: "aiRemoteTasks", query: orgQuery.value },
    dataTest: "ai-secondary-nav-remote-tasks",
    group: "Experiment",
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

// Group order: Monitor, then Evaluate, then Experiment, then Annotate at the
// bottom. Experiment is its own section (not an Evaluate sub-item) because an
// experiment is a run you author, not a scoring config you maintain.
const sectionGroupOrder = ["Monitor", "Evaluate", "Experiment", "Annotate"];

const groupLabels = computed<Record<string, I18nText>>(() => ({
  Monitor: t("aiObservability.sections.monitor"),
  Annotate: t("aiObservability.sections.annotate"),
  Evaluate: t("aiObservability.sections.evaluate"),
  Experiment: t("aiObservability.sections.experiment"),
}));

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
    .map((key) => ({ label: groupLabels.value[key] ?? raw(key), items: buckets.get(key)! }));
});

// Reserved for future per-section header chrome wiring (mirrors Settings'
// activeSectionItem use). Keeping the reference live for clarity.
void activeSectionItem.value;
</script>
