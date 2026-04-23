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
import AzureMarketplaceSetup from "@/views/AzureMarketplaceSetup.vue";
import AwsMarketplaceSetup from "@/views/AwsMarketplaceSetup.vue";
import EvalTemplateList from "@/enterprise/components/EvalTemplateList.vue";
import EvalTemplateEditor from "@/enterprise/components/EvalTemplateEditor.vue";

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
      ],
    },
  ];

  // Child routes to merge under pipeline/pipelines path
  const pipelineChildren = [
    {
      path: "eval-templates",
      name: "evalTemplates",
      component: EvalTemplateList,
      meta: {
        title: "Evaluation Templates",
        keepAlive: false,
      },
    },
    {
      path: "eval-templates/add",
      name: "evalTemplatesAdd",
      component: EvalTemplateEditor,
      meta: {
        title: "Create Evaluation Template",
        keepAlive: false,
      },
    },
    {
      path: "eval-templates/:id/edit",
      name: "evalTemplatesEdit",
      component: EvalTemplateEditor,
      meta: {
        title: "Edit Evaluation Template",
        keepAlive: false,
      },
    },
  ];

  return { parentRoutes, homeChildRoutes, pipelineChildren };
};

export default useEnvRoutes;
