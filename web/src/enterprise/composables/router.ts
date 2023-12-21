// Copyright 2023 Zinc Labs Inc.
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

import Login from "@/views/Login.vue";
import LoginCallback from "@/enterprise/components/login/Login.vue";
import {
  useLocalUserInfo,
  useLocalToken,
  useLocalCurrentUser,
  getLoginURL,
  getLogoutURL,
} from "@/utils/zincutils";

import authService from "@/services/auth";
import config from "@/aws-exports";
import Organizations from "@/enterprise/components/organizations/Organization.vue";
import Billing from "@/enterprise/components/billings/Billing.vue";
import Plans from "@/enterprise/components/billings/plans.vue";
import InvoiceHistory from "@/enterprise/components/billings/invoiceHistory.vue";
import Usage from "@/enterprise/components/billings/usage.vue";
import { routeGuard } from "@/utils/zincutils";


const useEnvRoutes = () => {
  const parentRoutes = [
    {
      path: "/login",
      component: Login,
      beforeEnter: async (to: any, from: any, next: any) => {
        debugger;
        if (config.isEnterprise == "true" || config.isEnterprise) {
          try {
            const url = await authService.get_dex_login();
            if (url) {
              window.location.href = url;
            } else {
              next();
            }
          } catch (error) {
            console.error("Error during redirection:", error);
            next(false);
          }
        } else {
          window.location.href = getLoginURL();
        }

      },
    },
    {
      path: "/logout",
      beforeEnter(to: any, from: any, next: any) {
        useLocalToken("", true);
        useLocalCurrentUser("", true);
        useLocalUserInfo("", true);
        window.location.href = getLogoutURL();
      },
    },
    {
      path: "/cb",
      name: "callback",
      component: LoginCallback,
    },
  ];

  const homeChildRoutes = [
    {
      path: "organizations",
      name: "organizations",
      component: Organizations,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "billings",
      name: "billings",
      component: Billing,
      meta: {
        keepAlive: false,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "usage",
          name: "usage",
          component: Usage,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "plans",
          name: "plans",
          component: Plans,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "invoice_history",
          name: "invoice_history",
          component: InvoiceHistory,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
      ],
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useEnvRoutes;
