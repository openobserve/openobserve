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

import Billing from "@/enterprise/components/billings/Billing.vue";
import Plans from "@/enterprise/components/billings/plans.vue";
import InvoiceHistory from "@/enterprise/components/billings/invoiceHistory.vue";
import Usage from "@/enterprise/components/billings/usage.vue";
import BillingGroup from "@/enterprise/components/billings/BillingGroup.vue";
import AzureMarketplaceSetup from "@/views/AzureMarketplaceSetup.vue";
import AwsMarketplaceSetup from "@/views/AwsMarketplaceSetup.vue";
import OnlineEvals from "@/enterprise/components/OnlineEvals.vue";
import { routeGuard } from "@/utils/zincutils";

const AIObservabilityShell = () =>
  import("@/enterprise/views/AIObservability/Index.vue");
const AILLMInsightsPage = () =>
  import("@/enterprise/views/AIObservability/LLMInsightsPage.vue");
const AISessionsPage = () =>
  import("@/enterprise/views/AIObservability/SessionsPage.vue");
const AIAgentGraphPage = () =>
  import("@/enterprise/views/AIObservability/AgentGraphPage.vue");
// Reused for the AI/LLM session drill-down so it lives under /ai (keeps the
// AI menu item active) instead of the Traces session-details route.
const SessionDetails = () =>
  import("@/plugins/traces/SessionDetails.vue");

const useEnvRoutes = () => {
  // Note: AWS Marketplace registration is handled by backend at POST /api/aws-marketplace/register
  // The backend sets a cookie and redirects to Dex login
  const parentRoutes: any = [
    {
      // Post-login setup page for org selection/creation
      path: "/marketplace/aws/setup",
      name: "awsMarketplaceSetup",
      component: AwsMarketplaceSetup,
      meta: {
        title: "AWS Marketplace Setup",
        requiresAuth: true,
      },
    },
    {
      // Entry point from Azure Marketplace - saves token and redirects to login
      path: "/marketplace/azure/register",
      name: "azureMarketplaceRegister",
      component: AzureMarketplaceSetup,
      beforeEnter: (to: any, from: any, next: any) => {
        const token = to.query.token;
        if (token) {
          // Save token for after login - Login.vue will check this
          sessionStorage.setItem("azure_marketplace_token", token);
        }
        next();
      },
    },
  ];

  const homeChildRoutes = [
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
          path: "agent-graph",
          name: "aiAgentGraph",
          component: AIAgentGraphPage,
          meta: { title: "Agent Graph", keepAlive: false },
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
      // AI/LLM session drill-down — under /ai so the AI menu stays active
      // (reuses the Traces SessionDetails view).
      path: "ai/session-details",
      name: "aiSessionDetails",
      component: SessionDetails,
      meta: { title: "Session Details", keepAlive: false },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Legacy URL — keep saved/bookmarked links working
      path: "online-evals",
      redirect: { name: "aiEvaluations" },
    },
    {
      path: "billings",
      name: "billings",
      component: Billing,
      meta: {
        keepAlive: false,
      },
      children: [
        {
          path: "usage",
          name: "usage",
          component: Usage,
        },
        {
          path: "plans",
          name: "plans",
          component: Plans,
        },
        {
          path: "invoice_history",
          name: "invoice_history",
          component: InvoiceHistory,
        },
        {
          path: "billing_group",
          name: "billing_group",
          component: BillingGroup,
        },
      ],
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useEnvRoutes;
