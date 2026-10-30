// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { RouteRecordRaw } from "vue-router";
import { routeGuard } from "@/utils/zincutils";
import { withFeatureGate, type FeatureKey } from "@/utils/enterpriseFeatures";
import { promptRoutes } from "@/views/AIObservability/promptRoutes";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";

// Previously defined twice — once in the OSS-only router, once in the
// enterprise one, with no gate on the enterprise copy and a `withFeatureGate`
// on the OSS copy — which is exactly the shape that let the two drift (the
// OSS copy once lagged the enterprise one by 13 routes). ONE set of lazy
// imports and ONE set of route records now, shared by both editions; see
// `useAIObservabilityRouteChildren` below for how the gate is applied.
const AIObservabilityShell = () => import("@/enterprise/views/AIObservability/Index.vue");
const AILLMInsightsPage = () => import("@/enterprise/views/AIObservability/LLMInsightsPage.vue");
const AISessionsPage = () => import("@/enterprise/views/AIObservability/SessionsPage.vue");
const AIAgentGraphPage = () => import("@/enterprise/views/AIObservability/AgentGraphPage.vue");
const AIAgentBehaviorPage = () =>
  import("@/enterprise/views/AIObservability/AgentBehaviorPage.vue");
const AIDiscoveryPage = () => import("@/enterprise/views/AIObservability/DiscoveryPage.vue");
const AIQueuesPage = () => import("@/enterprise/views/AIObservability/QueuesPage.vue");
const AIQueueDetailPage = () => import("@/enterprise/views/AIObservability/QueueDetailPage.vue");
const AIQueueWorkbenchPage = () =>
  import("@/enterprise/views/AIObservability/QueueWorkbenchPage.vue");
const AIDatasetsPage = () => import("@/enterprise/views/AIObservability/DatasetsPage.vue");
const AIDatasetDetailPage = () =>
  import("@/enterprise/views/AIObservability/DatasetDetailPage.vue");
const AIPlaygroundPage = () => import("@/enterprise/views/AIObservability/PlaygroundPage.vue");
const AIExperimentsPage = () => import("@/enterprise/views/AIObservability/ExperimentsPage.vue");
const AIExperimentCreatePage = () =>
  import("@/enterprise/components/AIObservability/ExperimentForm.vue");
const AIExperimentComparePage = () =>
  import("@/enterprise/views/AIObservability/ExperimentComparePage.vue");
const AIExperimentDetailPage = () =>
  import("@/enterprise/views/AIObservability/ExperimentDetailPage.vue");
const AIRemoteTasksPage = () => import("@/enterprise/views/AIObservability/RemoteTasksPage.vue");
const AIRemoteTaskFormPage = () =>
  import("@/enterprise/components/AIObservability/RemoteTaskFormPage.vue");
const AIRemoteTaskDetailPage = () =>
  import("@/enterprise/views/AIObservability/RemoteTaskDetailPage.vue");
const AIOnlineEvals = () => import("@/enterprise/components/OnlineEvals.vue");
// Reused for the AI/LLM session drill-down so it lives under /ai (keeps the
// AI menu item active) instead of the Traces session-details route.
const SessionDetails = () => import("@/plugins/traces/SessionDetails.vue");

export type AiObservabilityGroup = "Monitor" | "Annotate" | "Experiment" | "Evaluate";

/**
 * The ONE list an AI Observability nav rail item AND its primary route are
 * both built from (see `Index.vue`'s `sectionItems` and
 * `useAIObservabilityRouteChildren` below) — a typo in `featureKey` or
 * `routeName` now breaks the nav tooltip and the route guard the SAME way,
 * instead of silently drifting between independently hand-typed copies.
 *
 * `featureKey: null` marks the two sections OSS serves from its own backend
 * (LLM Insights, Sessions) — always reachable, no gate. Several entries
 * share one `routeName` (the four Evaluate tabs all land on `aiEvaluations`)
 * — `useAIObservabilityRouteChildren` collapses those to a single route
 * record; `tabQuery` carries the `?tab=` value the nav item's link needs
 * that the shared route itself doesn't know about.
 */
export interface AiObservabilitySection {
  key: string;
  featureKey: FeatureKey | null;
  routeName: string;
  labelKey: I18nKey;
  icon: IconName;
  group: AiObservabilityGroup;
  dataTest: string;
  tabQuery?: string;
  /** Omitted only for `prompts`, whose routes come from the external,
      already-shared `promptRoutes` table (also consumed directly by
      components that build prompt links) — see the `key === "prompts"`
      special case below. */
  path?: string;
  component?: () => Promise<unknown>;
  /** Extra route `props`. Only the first entry for a deduped `routeName`
      (here, `quality` for `aiEvaluations`) is read. */
  routeProps?: Record<string, unknown>;
  /** Route `meta.titleKey`, when it must differ from the nav `labelKey` —
      only `aiEvaluations` needs this: its 4 nav entries each have their own
      tab label, but the route itself (reachable before any tab is picked)
      keeps the page-level `onlineEvals.title`. Defaults to `labelKey`. */
  metaTitleKey?: I18nKey;
}

export const AI_OBSERVABILITY_SECTIONS: AiObservabilitySection[] = [
  {
    key: "llmInsights",
    featureKey: null,
    routeName: "aiLLMInsights",
    path: "llm-insights",
    component: AILLMInsightsPage,
    labelKey: "aiObservability.nav.llmInsights",
    icon: "dashboard",
    group: "Monitor",
    dataTest: "ai-secondary-nav-llm-insights",
  },
  {
    key: "sessions",
    featureKey: null,
    routeName: "aiSessions",
    path: "sessions",
    component: AISessionsPage,
    labelKey: "aiObservability.nav.sessions",
    icon: "forum",
    group: "Monitor",
    dataTest: "ai-secondary-nav-sessions",
  },
  {
    key: "agentGraph",
    featureKey: "agentGraph",
    routeName: "aiAgentGraph",
    path: "agent-graph",
    component: AIAgentGraphPage,
    labelKey: "aiObservability.nav.agentGraph",
    icon: "hub",
    group: "Monitor",
    dataTest: "ai-secondary-nav-agent-graph",
  },
  {
    key: "agentBehavior",
    featureKey: "agentBehavior",
    routeName: "aiAgentBehavior",
    path: "agent-behavior",
    component: AIAgentBehaviorPage,
    labelKey: "aiObservability.nav.agentBehavior",
    icon: "troubleshoot",
    group: "Monitor",
    dataTest: "ai-secondary-nav-agent-behavior",
  },
  {
    key: "discovery",
    featureKey: "discovery",
    routeName: "aiDiscovery",
    path: "discovery",
    component: AIDiscoveryPage,
    labelKey: "aiObservability.nav.discovery",
    icon: "saved-search",
    group: "Annotate",
    dataTest: "ai-secondary-nav-discovery",
  },
  {
    key: "queues",
    featureKey: "queues",
    routeName: "aiQueues",
    path: "queues",
    component: AIQueuesPage,
    labelKey: "aiObservability.nav.queues",
    icon: "fact-check",
    group: "Annotate",
    dataTest: "ai-secondary-nav-queues",
  },
  {
    key: "datasets",
    featureKey: "datasets",
    routeName: "aiDatasets",
    path: "datasets",
    component: AIDatasetsPage,
    labelKey: "aiObservability.nav.datasets",
    icon: "table-chart",
    group: "Annotate",
    dataTest: "ai-secondary-nav-datasets",
  },
  {
    key: "prompts",
    featureKey: "prompts",
    routeName: "aiPrompts",
    labelKey: "aiObservability.nav.prompts",
    icon: "edit",
    group: "Experiment",
    dataTest: "ai-secondary-nav-prompts",
  },
  {
    key: "playground",
    featureKey: "playground",
    routeName: "aiPlayground",
    path: "playground",
    component: AIPlaygroundPage,
    labelKey: "aiObservability.nav.playground",
    icon: "play-circle",
    group: "Experiment",
    dataTest: "ai-secondary-nav-playground",
  },
  {
    key: "experiments",
    featureKey: "experiments",
    routeName: "aiExperiments",
    path: "experiments",
    component: AIExperimentsPage,
    labelKey: "aiObservability.nav.experiments",
    icon: "science",
    group: "Experiment",
    dataTest: "ai-secondary-nav-experiments",
  },
  {
    key: "remoteTasks",
    featureKey: "remoteTasks",
    routeName: "aiRemoteTasks",
    path: "remote-tasks",
    component: AIRemoteTasksPage,
    labelKey: "aiObservability.nav.remoteTasks",
    icon: "cloud-upload",
    group: "Experiment",
    dataTest: "ai-secondary-nav-remote-tasks",
  },
  {
    key: "quality",
    featureKey: "evaluations",
    routeName: "aiEvaluations",
    path: "evaluations",
    component: AIOnlineEvals,
    routeProps: { hideTabBar: true },
    metaTitleKey: "onlineEvals.title",
    labelKey: "aiObservability.nav.quality",
    icon: "star-rate",
    group: "Evaluate",
    dataTest: "ai-secondary-nav-quality",
    tabQuery: "quality",
  },
  {
    key: "jobs",
    featureKey: "evaluations",
    routeName: "aiEvaluations",
    path: "evaluations",
    component: AIOnlineEvals,
    labelKey: "aiObservability.nav.evalJobs",
    icon: "event",
    group: "Evaluate",
    dataTest: "ai-secondary-nav-eval-jobs",
    tabQuery: "jobs",
  },
  {
    key: "scorers",
    featureKey: "evaluations",
    routeName: "aiEvaluations",
    path: "evaluations",
    component: AIOnlineEvals,
    labelKey: "aiObservability.nav.scorers",
    icon: "rule",
    group: "Evaluate",
    dataTest: "ai-secondary-nav-scorers",
    tabQuery: "scorers",
  },
  {
    key: "scoreConfigs",
    featureKey: "evaluations",
    routeName: "aiEvaluations",
    path: "evaluations",
    component: AIOnlineEvals,
    labelKey: "aiObservability.nav.scoreConfigs",
    icon: "tune",
    group: "Evaluate",
    dataTest: "ai-secondary-nav-score-configs",
    tabQuery: "scoreConfigs",
  },
];

/**
 * Routes with no nav counterpart (detail/create/compare pages a rail item
 * never links to directly). `after` is the owning section's `routeName` —
 * `useAIObservabilityRouteChildren` splices each sub-route immediately after
 * it, preserving the static-before-dynamic ordering vue-router needs (e.g.
 * `remote-tasks/new` must precede `remote-tasks/:id`, or "new" is matched as
 * an entity id).
 */
interface AiObservabilitySubRoute {
  featureKey: FeatureKey;
  routeName: string;
  path: string;
  component: () => Promise<unknown>;
  metaTitleKey: I18nKey;
  after: string;
}

const AI_OBSERVABILITY_SUB_ROUTES: AiObservabilitySubRoute[] = [
  {
    featureKey: "queues",
    routeName: "aiQueueDetail",
    path: "queues/:id",
    component: AIQueueDetailPage,
    metaTitleKey: "routeTitles.aiQueueDetail",
    after: "aiQueues",
  },
  {
    featureKey: "queues",
    routeName: "aiQueueWorkbench",
    path: "queues/:id/review",
    component: AIQueueWorkbenchPage,
    metaTitleKey: "routeTitles.aiQueueReview",
    after: "aiQueues",
  },
  {
    featureKey: "datasets",
    routeName: "aiDatasetDetail",
    path: "datasets/:id",
    component: AIDatasetDetailPage,
    metaTitleKey: "routeTitles.aiDatasetDetail",
    after: "aiDatasets",
  },
  {
    featureKey: "experiments",
    routeName: "aiExperimentCreate",
    path: "experiments/new",
    component: AIExperimentCreatePage,
    metaTitleKey: "routeTitles.aiExperimentCreate",
    after: "aiExperiments",
  },
  {
    featureKey: "experiments",
    routeName: "aiExperimentCompare",
    path: "experiments/compare/:baselineId/:candidateId",
    component: AIExperimentComparePage,
    metaTitleKey: "routeTitles.aiExperimentCompare",
    after: "aiExperiments",
  },
  {
    featureKey: "experiments",
    routeName: "aiExperimentDetail",
    path: "experiments/:id",
    component: AIExperimentDetailPage,
    metaTitleKey: "routeTitles.aiExperimentDetail",
    after: "aiExperiments",
  },
  {
    featureKey: "remoteTasks",
    routeName: "aiRemoteTaskCreate",
    path: "remote-tasks/new",
    component: AIRemoteTaskFormPage,
    metaTitleKey: "routeTitles.aiRemoteTaskCreate",
    after: "aiRemoteTasks",
  },
  {
    featureKey: "remoteTasks",
    routeName: "aiRemoteTaskEdit",
    path: "remote-tasks/:id/edit",
    component: AIRemoteTaskFormPage,
    metaTitleKey: "routeTitles.aiRemoteTaskEdit",
    after: "aiRemoteTasks",
  },
  {
    featureKey: "remoteTasks",
    routeName: "aiRemoteTaskDetail",
    path: "remote-tasks/:id",
    component: AIRemoteTaskDetailPage,
    metaTitleKey: "routeTitles.aiRemoteTaskDetail",
    after: "aiRemoteTasks",
  },
];

/**
 * Builds the full `/ai` children array — the redirect stub, every primary
 * route (deduped by `routeName`, so the four Evaluate nav entries yield ONE
 * `aiEvaluations` route), and each primary's sub-routes right after it.
 * Both editions call this; only the gate differs per route (`featureKey:
 * null` sections get no `beforeEnter` at all — llm-insights/sessions are
 * reachable in every edition).
 */
export function useAIObservabilityRouteChildren(): RouteRecordRaw[] {
  const children: RouteRecordRaw[] = [
    { path: "", name: "aiObservability", redirect: { name: "aiLLMInsights" } },
  ];
  const seenRouteNames = new Set<string>();
  for (const section of AI_OBSERVABILITY_SECTIONS) {
    if (seenRouteNames.has(section.routeName)) continue;
    seenRouteNames.add(section.routeName);

    if (section.key === "prompts") {
      children.push(
        ...promptRoutes.map((r) => ({ ...r, beforeEnter: withFeatureGate("prompts", routeGuard) })),
      );
      continue;
    }

    children.push({
      path: section.path!,
      name: section.routeName,
      component: section.component!,
      meta: { titleKey: section.metaTitleKey ?? section.labelKey, keepAlive: false },
      ...(section.routeProps ? { props: section.routeProps } : {}),
      ...(section.featureKey
        ? { beforeEnter: withFeatureGate(section.featureKey, routeGuard) }
        : {}),
    } as RouteRecordRaw);

    for (const sub of AI_OBSERVABILITY_SUB_ROUTES.filter((s) => s.after === section.routeName)) {
      children.push({
        path: sub.path,
        name: sub.routeName,
        component: sub.component,
        meta: { titleKey: sub.metaTitleKey, keepAlive: false },
        beforeEnter: withFeatureGate(sub.featureKey, routeGuard),
      } as RouteRecordRaw);
    }
  }
  return children;
}

/** The `ai` shell route itself — same `component`/guard in every edition. */
export function useAIObservabilityShellRoute(): RouteRecordRaw {
  return {
    path: "ai",
    component: AIObservabilityShell,
    beforeEnter(to: any, from: any, next: any) {
      routeGuard(to, from, next);
    },
    meta: { titleKey: "routeTitles.aiMonitoring", keepAlive: false },
    children: useAIObservabilityRouteChildren(),
  };
}

/**
 * Siblings of the `ai` shell, not nested under it. `aiSessionDetails` is
 * ungated like Sessions itself (no FeatureKey — every edition that serves
 * Sessions serves its drill-down); the `online-evals` redirect is a legacy
 * URL kept working in every edition.
 */
export function useAIObservabilityExtraRoutes(): RouteRecordRaw[] {
  return [
    {
      path: "ai/session-details",
      name: "aiSessionDetails",
      component: SessionDetails,
      meta: { titleKey: "routeTitles.sessionDetails", keepAlive: false },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "online-evals",
      redirect: { name: "aiEvaluations" },
    },
  ];
}
