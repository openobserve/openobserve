// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License. 

import { createRouter, createWebHistory } from "vue-router";
import Login from "../views/Login.vue";
import Home from "../views/HomeView.vue";
import Tickets from "../views/TicketsView.vue";
import Users from "../views/User.vue";
import About from "../views/About.vue";
import Dashboard from "../views/Dashboard.vue";
import ViewDashboard from "../views/ViewDashboard.vue";
import EditPanel from "../views/EditPanel.vue";

import LoginCallback from "../views/LoginCallback.vue";
import MemberSubscription from "../views/MemberSubscription.vue";
import Search from "../views/Search.vue";
import LogStream from "../views/LogStream.vue";
import JSTransform from "../views/JSTransform.vue";
import Alerts from "../views/Alerts.vue";
import Ingestion from "../views/Ingestion.vue";
import Error404 from "../views/Error404.vue";
import {
  useLocalUserInfo,
  getDecodedUserInfo,
  useLocalToken,
  useLocalCurrentUser,
} from "../utils/zincutils";
import type { cp } from "fs";
import FluentBit from "../components/ingestion/FluentBit.vue";
import Fluentd from "../components/ingestion/Fluentd.vue";
import Vector from "../components/ingestion/Vector.vue";
import Curl from "../components/ingestion/Curl.vue";

import segment from "@/services/segment_analytics";

export default function (store: any) {
  const routes = [
    {
      path: "/login",
      component: Login,
    },
    {
      path: "/logout",
      beforeEnter(to: any, from: any, next: any) {
        useLocalToken("", true);
        useLocalCurrentUser("", true);
        useLocalUserInfo("", true);
        window.location.href = "/login";
      },
    },
    {
      path: "/cb",
      name: "callback",
      component: LoginCallback,
    },
    {
      path: "/",
      component: () => import("../layouts/MainLayout.vue"),
      children: [
        {
          path: "",
          name: "home",
          component: Home,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "logs",
          name: "logs",
          component: Search,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "logstreams",
          name: "logstreams",
          component: LogStream,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "tickets",
          name: "tickets",
          component: Tickets,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "about",
          name: "about",
          component: About,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "dashboard",
          name: "dashboard",
          component: Dashboard,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "viewDashboard",
          name: "viewDashboard",
          component: ViewDashboard,
          props: true,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "editPanel",
          name: "editPanel",
          component: EditPanel,
          props: true,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "users",
          name: "users",
          component: Users,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "member_subscription",
          name: "member_subscription",
          component: MemberSubscription,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "functions",
          name: "functions",
          component: JSTransform,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "ingestion",
          name: "ingestion",
          component: Ingestion,
          meta: {
            keepAlive: true,
          },
          children: [
            {
              path: "",
              name: "curl",
              redirect: "ingestion/curl",
            },
            {
              path: "curl",
              name: "curl",
              component: Curl,
            },
            {
              path: "fluentbit",
              name: "fluentbit",
              component: FluentBit,
            },
            {
              path: "fluentd",
              name: "fluentd",
              component: Fluentd,
            },
            {
              path: "vector",
              name: "vector",
              component: Vector,
            },
          ],
        },
        {
          path: "alerts",
          name: "alerts",
          component: Alerts,
          meta: {
            keepAlive: true,
          },
        },
        {
          path: "/:catchAll(.*)*",
          component: Error404,
          meta: {
            keepAlive: true,
          },
        },
      ],
    },
  ];

  interface RouterMap {
    history: any;
    routes: any;
  }
  const routerMap: RouterMap = {
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: routes,
  };

  const router = createRouter(routerMap);

  router.beforeEach((to: any, from: any, next: any) => {
    const isAuthenticated = store.state.loggedIn;

    if (!isAuthenticated) {
      const sessionUserInfo = getDecodedUserInfo();

      const localStorageToken: any = useLocalToken();
      if (
        to.path !== "/login" &&
        to.path !== "/cb" &&
        (localStorageToken.value === "" || sessionUserInfo === null)
      ) {
        if (to.path !== "/logout") { window.sessionStorage.setItem("redirectURI", to.fullPath); }
        next({ path: "/login" });
      } else {
        if (sessionUserInfo !== null) {
          const userInfo = JSON.parse(String(sessionUserInfo));
          store.dispatch("login", {
            loginState: true,
            userInfo: userInfo,
          });
        }
        next();
      }
    } else {
      const sessionUserInfo = getDecodedUserInfo();
      const userID = JSON.parse(String(sessionUserInfo)).email;

      segment.track("page view", {
        path: to.path,
        referrer: from.path,
      });
      next();
    }
  });
  return router;
}
