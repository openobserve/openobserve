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

import { createRouter, createWebHistory } from "vue-router";
import {
  getDecodedUserInfo,
  useLocalToken,
  getPath,
  mergeRoutes,
} from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";

import userCloudRoutes from "@/enterprise/composables/router";
import userRoutes from "@/composables/shared/router";
import useOSRoutes from "@/composables/router";
import { nextTick } from "vue";

export default function (store: any) {
  let { parentRoutes, homeChildRoutes } = userRoutes();

  let envRoutes: any;
  if (config.isCloud == "true") {
    envRoutes = userCloudRoutes();
  } else {
    envRoutes = useOSRoutes();
  }

  // parentRoutes = parentRoutes.concat(envRoutes.parentRoutes);
  // homeChildRoutes = homeChildRoutes.concat(envRoutes.homeChildRoutes);
  parentRoutes = mergeRoutes(parentRoutes, envRoutes.parentRoutes);
  homeChildRoutes = mergeRoutes(homeChildRoutes, envRoutes.homeChildRoutes);
  const routes = [
    ...parentRoutes,
    {
      path: "/",
      component: () => import("@/layouts/MainLayout.vue"),
      children: [...homeChildRoutes],
    },
  ];

  interface RouterMap {
    history: any;
    routes: any;
  }
  const routerMap: RouterMap = {
    history: createWebHistory(getPath()),
    // history: createWebHistory(window.location.pathname),
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
        if (to.path !== "/logout") {
          window.sessionStorage.setItem("redirectURI", to.fullPath);
        }
        next({ path: "/login" });
      } else {
        if (sessionUserInfo !== null) {
          const userInfo = JSON.parse(String(sessionUserInfo));
          store.dispatch("login", {
            loginState: true,
            userInfo: userInfo,
          });

          nextTick(() => {
            store.state.tracing?.setUser(userInfo);
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
