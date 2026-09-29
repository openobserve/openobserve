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
import useIngestionRoutes from "./shared/useIngestionRoutes";

const useOSRoutes = () => {
  const parentRoutes: any = [];

  // LLM Insights + Sessions are the "Monitor" half of the AI Observability
  // module — ships in OSS under the SAME /ai shell and route names
  // (aiLLMInsights/aiSessions) the enterprise build uses, just with a
  // trimmed-down set of children. The rest of that module (Evaluate/
  // Experiment/Annotate, plus Monitor's Agent Graph/Agent Behavior) stays
  // enterprise/cloud-only, registered separately under
  // web/src/enterprise/composables/router.ts, which OSS builds never import.
  // AIObservabilityShell (Index.vue) hides everything but the Monitor group
  // when `config.isEnterprise`/`isCloud` are both false, so its rail only ever
  // links to routes that actually exist here. Reuses the SAME page components
  // the enterprise routes render — they already resolve their own
  // enterprise-only bits (detail route name, Agent mode, Version Compare) via
  // `config.isEnterprise` internally.
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
      ],
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useOSRoutes;
