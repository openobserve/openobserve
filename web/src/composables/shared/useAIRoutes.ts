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

// AI Observability / Online Evals routes. Shared by both the open-source
// router (@/composables/router) and the enterprise router
// (@/enterprise/composables/router) so the `/ai` feature works in every build.
// Visibility of the sidebar entry is still gated on the `online_evals_enabled`
// zoConfig flag in MainLayout.vue — these routes only ensure the pages exist.

import OnlineEvals from "@/enterprise/components/OnlineEvals.vue";
import { routeGuard } from "@/utils/zincutils";

const AIObservabilityShell = () =>
  import("@/enterprise/views/AIObservability/Index.vue");
const AILLMInsightsPage = () =>
  import("@/enterprise/views/AIObservability/LLMInsightsPage.vue");
const AISessionsPage = () =>
  import("@/enterprise/views/AIObservability/SessionsPage.vue");

const useAIRoutes = () => {
  // Mounted directly under the MainLayout (home) children.
  const homeChildRoutes: any[] = [
    {
      path: "ai",
      component: AIObservabilityShell,
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      meta: {
        title: "AI Monitoring",
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
          component: AILLMInsightsPage,
          meta: { title: "LLM Insights", keepAlive: false },
        },
        {
          path: "sessions",
          name: "aiSessions",
          component: AISessionsPage,
          meta: { title: "Sessions", keepAlive: false },
        },
        {
          path: "evaluations",
          name: "aiEvaluations",
          component: OnlineEvals,
          props: { hideTabBar: true },
          meta: { title: "Evaluations", keepAlive: false },
        },
      ],
    },
    {
      // Legacy URL — keep saved/bookmarked links working
      path: "online-evals",
      redirect: { name: "aiEvaluations" },
    },
  ];

  return { homeChildRoutes };
};

export default useAIRoutes;
