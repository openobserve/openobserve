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

import { routeGuard } from "@/utils/zincutils";
import { withFeatureGate } from "@/utils/enterpriseFeatures";
import { promptRoutes } from "@/views/AIObservability/promptRoutes";
import useIngestionRoutes from "./shared/useIngestionRoutes";

// LLM Insights + Sessions are the only "Monitor" sections OSS actually serves
// from its own backend; every other AI Observability route below is still
// REGISTERED here (not just hidden in the rail) so the locked-but-visible
// nav items in AIObservabilityShell (Index.vue) resolve to something —
// `withFeatureGate` redirects to the shared `enterpriseFeatureLocked` page
// since a true OSS build never satisfies `isEnterprise`/`isCloud`. Reuses the
// SAME page components the enterprise router points at (they already resolve
// their own enterprise-only bits internally); OSS just never gets far enough
// to render them.
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

const useOSRoutes = () => {
  const parentRoutes: any = [];

  const homeChildRoutes: any[] = [
    ...useIngestionRoutes(),
    {
      path: "ai",
      component: () => import("@/enterprise/views/AIObservability/Index.vue"),
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      meta: {
        titleKey: "routeTitles.aiMonitoring",
        keepAlive: false,
      },
      children: [
        {
          path: "",
          name: "aiObservability",
          redirect: { name: "aiLLMInsights" },
        },
        {
          path: "llm-insights",
          name: "aiLLMInsights",
          component: () => import("@/enterprise/views/AIObservability/LLMInsightsPage.vue"),
          meta: { titleKey: "aiObservability.nav.llmInsights", keepAlive: false },
        },
        {
          path: "sessions",
          name: "aiSessions",
          component: () => import("@/enterprise/views/AIObservability/SessionsPage.vue"),
          meta: { titleKey: "aiObservability.nav.sessions", keepAlive: false },
        },
        {
          path: "agent-graph",
          name: "aiAgentGraph",
          component: AIAgentGraphPage,
          meta: { titleKey: "aiObservability.nav.agentGraph", keepAlive: false },
          beforeEnter: withFeatureGate("agentGraph", routeGuard),
        },
        {
          path: "agent-behavior",
          name: "aiAgentBehavior",
          component: AIAgentBehaviorPage,
          meta: { titleKey: "aiObservability.nav.agentBehavior", keepAlive: false },
          beforeEnter: withFeatureGate("agentBehavior", routeGuard),
        },
        {
          path: "discovery",
          name: "aiDiscovery",
          component: AIDiscoveryPage,
          meta: { titleKey: "aiObservability.nav.discovery", keepAlive: false },
          beforeEnter: withFeatureGate("discovery", routeGuard),
        },
        {
          path: "queues",
          name: "aiQueues",
          component: AIQueuesPage,
          meta: { titleKey: "aiObservability.nav.queues", keepAlive: false },
          beforeEnter: withFeatureGate("queues", routeGuard),
        },
        {
          path: "queues/:id",
          name: "aiQueueDetail",
          component: AIQueueDetailPage,
          meta: { titleKey: "routeTitles.aiQueueDetail", keepAlive: false },
          beforeEnter: withFeatureGate("queues", routeGuard),
        },
        {
          path: "queues/:id/review",
          name: "aiQueueWorkbench",
          component: AIQueueWorkbenchPage,
          meta: { titleKey: "routeTitles.aiQueueReview", keepAlive: false },
          beforeEnter: withFeatureGate("queues", routeGuard),
        },
        {
          path: "datasets",
          name: "aiDatasets",
          component: AIDatasetsPage,
          meta: { titleKey: "aiObservability.nav.datasets", keepAlive: false },
          beforeEnter: withFeatureGate("datasets", routeGuard),
        },
        {
          path: "datasets/:id",
          name: "aiDatasetDetail",
          component: AIDatasetDetailPage,
          meta: { titleKey: "routeTitles.aiDatasetDetail", keepAlive: false },
          beforeEnter: withFeatureGate("datasets", routeGuard),
        },
        ...promptRoutes.map((r) => ({ ...r, beforeEnter: withFeatureGate("prompts", routeGuard) })),
        {
          path: "playground",
          name: "aiPlayground",
          component: AIPlaygroundPage,
          meta: { titleKey: "aiObservability.nav.playground", keepAlive: false },
          beforeEnter: withFeatureGate("playground", routeGuard),
        },
        {
          path: "experiments",
          name: "aiExperiments",
          component: AIExperimentsPage,
          meta: { titleKey: "aiObservability.nav.experiments", keepAlive: false },
          beforeEnter: withFeatureGate("experiments", routeGuard),
        },
        {
          path: "experiments/new",
          name: "aiExperimentCreate",
          component: AIExperimentCreatePage,
          meta: { titleKey: "routeTitles.aiExperimentCreate", keepAlive: false },
          beforeEnter: withFeatureGate("experiments", routeGuard),
        },
        {
          path: "experiments/compare/:baselineId/:candidateId",
          name: "aiExperimentCompare",
          component: AIExperimentComparePage,
          meta: { titleKey: "routeTitles.aiExperimentCompare", keepAlive: false },
          beforeEnter: withFeatureGate("experiments", routeGuard),
        },
        {
          path: "experiments/:id",
          name: "aiExperimentDetail",
          component: AIExperimentDetailPage,
          meta: { titleKey: "routeTitles.aiExperimentDetail", keepAlive: false },
          beforeEnter: withFeatureGate("experiments", routeGuard),
        },
        {
          // `remote-tasks/new` must precede `remote-tasks/:id`, or "new" is
          // matched as an entity id.
          path: "remote-tasks",
          name: "aiRemoteTasks",
          component: AIRemoteTasksPage,
          meta: { titleKey: "aiObservability.nav.remoteTasks", keepAlive: false },
          beforeEnter: withFeatureGate("remoteTasks", routeGuard),
        },
        {
          path: "remote-tasks/new",
          name: "aiRemoteTaskCreate",
          component: AIRemoteTaskFormPage,
          meta: { titleKey: "routeTitles.aiRemoteTaskCreate", keepAlive: false },
          beforeEnter: withFeatureGate("remoteTasks", routeGuard),
        },
        {
          path: "remote-tasks/:id/edit",
          name: "aiRemoteTaskEdit",
          component: AIRemoteTaskFormPage,
          meta: { titleKey: "routeTitles.aiRemoteTaskEdit", keepAlive: false },
          beforeEnter: withFeatureGate("remoteTasks", routeGuard),
        },
        {
          path: "remote-tasks/:id",
          name: "aiRemoteTaskDetail",
          component: AIRemoteTaskDetailPage,
          meta: { titleKey: "routeTitles.aiRemoteTaskDetail", keepAlive: false },
          beforeEnter: withFeatureGate("remoteTasks", routeGuard),
        },
        {
          path: "evaluations",
          name: "aiEvaluations",
          component: AIOnlineEvals,
          props: { hideTabBar: true },
          meta: { titleKey: "onlineEvals.title", keepAlive: false },
          beforeEnter: withFeatureGate("evaluations", routeGuard),
        },
      ],
    },
    {
      // Legacy URL — keep saved/bookmarked links working, same as the
      // enterprise router's equivalent redirect.
      path: "online-evals",
      redirect: { name: "aiEvaluations" },
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useOSRoutes;
