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

import type { RouteLocationNormalized } from "vue-router";
import {
  useAIObservabilityShellRoute,
  useAIObservabilityExtraRoutes,
} from "@/composables/shared/useAIObservabilityRoutes";

const Billing = () => import("@/enterprise/components/billings/Billing.vue");
const Plans = () => import("@/enterprise/components/billings/plans.vue");
const InvoiceHistory = () => import("@/enterprise/components/billings/invoiceHistory.vue");
const Usage = () => import("@/enterprise/components/billings/usage/UsageView.vue");
const BillingGroup = () => import("@/enterprise/components/billings/BillingGroup.vue");
const AzureMarketplaceSetup = () => import("@/views/AzureMarketplaceSetup.vue");
const AwsMarketplaceSetup = () => import("@/views/AwsMarketplaceSetup.vue");

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
        titleKey: "routeTitles.awsMarketplaceSetup",
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
    useAIObservabilityShellRoute(),
    ...useAIObservabilityExtraRoutes(),
    {
      path: "billings",
      name: "billings",
      component: Billing,
      meta: {
        keepAlive: false,
        allowOnEmptyData: true,
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
        // The Paid Usage page moved onto the Plans AI credits card; keep its old links working.
        {
          path: "paid_usage",
          redirect: (to: RouteLocationNormalized) => ({ name: "plans", query: to.query }),
        },
      ],
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useEnvRoutes;
