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
import {
  useLocalUserInfo,
  useLocalToken,
  useLocalCurrentUser,
} from "@/utils/zincutils";
import useIngestionRoutes from "./shared/useIngestionRoutes";
import config from "@/aws-exports";
import authService from "@/services/auth";
import { useStore } from "vuex";

const useOSRoutes = () => {
  const parentRoutes = [
    {
      path: "/login",
      component: Login,
      beforeEnter: async (to: any, from: any, next: any) => {
        const store = useStore();
        if (config.isEnterprise == "true" && store.state.zoConfig.dex_enabled) {
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
        }
        next();
      },
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

  const homeChildRoutes: any[] = [...useIngestionRoutes()];

  return { parentRoutes, homeChildRoutes };
};

export default useOSRoutes;
