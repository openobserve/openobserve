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
import { getPath, mergeRoutes } from "@/utils/zincutils";

import userRoutes from "@/composables/shared/router";
import useOSRoutes from "@/composables/router";
let { parentRoutes, homeChildRoutes } = userRoutes();

const envRoutes: any = useOSRoutes();

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

export default createRouter(routerMap);
