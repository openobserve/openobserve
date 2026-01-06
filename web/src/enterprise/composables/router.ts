// Copyright 2023 OpenObserve Inc.
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
import AwsMarketplaceSetup from "@/views/AwsMarketplaceSetup.vue";

const useEnvRoutes = () => {
  const parentRoutes: any = [
    {
      // Entry point from AWS Marketplace - saves token and redirects to login
      path: "/marketplace/aws/register",
      name: "awsMarketplaceRegister",
      beforeEnter: (to: any, from: any, next: any) => {
        const token = to.query.token;
        if (token) {
          // Save token for after login - Login.vue will check this
          sessionStorage.setItem("aws_marketplace_token", token);
        }
        // Redirect to login page (normal flow, Login.vue handles token check)
        next("/login");
      },
    },
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

  return { parentRoutes, homeChildRoutes };
};

export default useEnvRoutes;
