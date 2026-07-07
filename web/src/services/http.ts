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

import store from "../stores";
import type { AxiosInstance } from "axios";
import axios from "axios";
import config from "../aws-exports";
import { useLocalUserInfo, useLocalCurrentUser } from "@/utils/zincutils";
import { addUnauthorizedError } from "@/composables/useUnauthorizedErrorGrouper";

// Shared refresh state — ensures only one dex_refresh request is in-flight
// at a time across all axios instances and streaming fetch requests. All
// concurrent 401s wait on the same Promise and retry once it resolves.
let refreshPromise: Promise<void> | null = null;

// Exported so streaming (fetch-based) requests that bypass the axios interceptor
// can participate in the same token-refresh flow.
export const attemptTokenRefresh = (requestUrl: string = ""): Promise<void> => {
  // Avoid infinite loops for auth endpoints
  if (
    requestUrl.includes("/config/dex_login") ||
    requestUrl.includes("/config/dex_refresh") ||
    requestUrl.includes("/auth/login")
  ) {
    return Promise.reject(new Error("Cannot refresh: auth endpoint"));
  }

  if (config.isCloud == "true") {
    store.dispatch("logout");
    useLocalCurrentUser("", true);
    useLocalUserInfo("", true);
    sessionStorage.clear();
    window.location.reload();
    return Promise.reject(new Error("Cloud environment: direct logout"));
  }

  if (
    config.isEnterprise == "true" &&
    (store.state as any).zoConfig.sso_enabled
  ) {
    if (!refreshPromise) {
      const refreshInstance = axios.create({
        withCredentials: true,
        baseURL: store.state.API_ENDPOINT,
      });
      refreshPromise = refreshInstance
        .get("/config/dex_refresh")
        .then((res) => {
          if (res.status !== 200) {
            return Promise.reject(new Error("Refresh returned non-200"));
          }
        })
        .catch(() => {
          return refreshInstance
            .get("/config/logout")
            .finally(() => {
              store.dispatch("logout");
              useLocalCurrentUser("", true);
              useLocalUserInfo("", true);
              sessionStorage.clear();
              window.location.reload();
            })
            .then(() => Promise.reject(new Error("Refresh failed")));
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    return refreshPromise;
  }

  // Not enterprise SSO — standard logout
  store.dispatch("logout");
  useLocalCurrentUser("", true);
  useLocalUserInfo("", true);
  sessionStorage.clear();
  window.location.reload();
  return Promise.reject(new Error("Not SSO: cannot refresh"));
};

const http = ({ headers } = {} as any) => {
  let instance: AxiosInstance;

  headers = {
    ...headers,
  };

  instance = axios.create({
    // timeout: 10000,
    withCredentials: true,
    baseURL: store.state.API_ENDPOINT,
    headers,
  });

  instance.interceptors.response.use(
    function (response) {
      return response;
    },
    function (error) {
      if (error && error.response && error.response.status) {
        switch (error.response.status) {
          case 400:
            break;
          case 401:
            if (
              config.isCloud == "true" &&
              !error.request.responseURL.includes("/auth/login")
            ) {
              store.dispatch("logout");
              useLocalCurrentUser("", true);
              useLocalUserInfo("", true);
              sessionStorage.clear();
              window.location.reload();
            }
            // Delegate to the shared refresh helper — it owns the URL exclusion
            // checks and the logout-on-failure path. Retry the original request
            // once the token is refreshed.
            else if (
              config.isEnterprise == "true" &&
              (store.state as any).zoConfig.sso_enabled
            ) {
              return attemptTokenRefresh(error.config.url)
                .then(() => instance.request(error.config))
                .catch(() => Promise.reject(error));
            } else {
              if (!error.request.responseURL.includes("/login")) {
                store.dispatch("logout");
                useLocalCurrentUser("", true);
                useLocalUserInfo("", true);
                sessionStorage.clear();
                window.location.reload();
              }
            }
            break;
          case 403:
            if (config.isEnterprise == "true" || config.isCloud == "true") {
              const responseUrl =
                error.request?.responseURL || error.config?.url || "";
              addUnauthorizedError(responseUrl);
            }
            break;
          case 404:
            break;
          case 500:
            break;
          default:
          // noop
        }
      }
      return Promise.reject(error);
    },
  );

  return instance;
};

export default http;
