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

import Login from "@/views/Login.vue";
import {
  useLocalUserInfo,
  useLocalToken,
  useLocalCurrentUser,
} from "@/utils/zincutils";

const useOSRoutes = () => {
  const parentRoutes = [
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
  ];

  const homeChildRoutes: never[] = [];

  return { parentRoutes, homeChildRoutes };
};

export default useOSRoutes;
