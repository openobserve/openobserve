// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import Login from "@/views/Login.vue";
import LoginCallback from "@/enterprise/components/login/Login.vue";
import {
  useLocalUserInfo,
  useLocalToken,
  useLocalCurrentUser,
  getLoginURL,
  getLogoutURL,
} from "@/utils/zincutils";

import Organizations from "@/enterprise/components/organizations/Organization.vue";

import Billing from "@/enterprise/components/billings/Billing.vue";
import Plans from "@/enterprise/components/billings/plans.vue";
import InvoiceHistory from "@/enterprise/components/billings/invoiceHistory.vue";
import Usage from "@/enterprise/components/billings/usage.vue";
import { routeGuardPendingSubscriptions } from "@/utils/zincutils";
const Settings = () => import("@/components/settings/index.vue");

const useEnvRoutes = () => {
  const parentRoutes = [
    {
      path: "/login",
      component: Login,
      beforeEnter(to: any, from: any, next: any) {
        window.location.href = getLoginURL();
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
        routeGuardPendingSubscriptions(to, from, next);
      },
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
      ],
    },
    {
      path: "settings",
      name: "settings",
      component: Settings,
      meta: {
        keepAlive: true,
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuardPendingSubscriptions(to, from, next);
      },
      children: [
        {
          path: "apikeys",
          name: "apiKeys",
          component: () => import("@/enterprise/components/settings/ApiKeys.vue"),
        },
      ],
    },
  ];

  return { parentRoutes, homeChildRoutes };
};

export default useEnvRoutes;
