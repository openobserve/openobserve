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
import { expireSession } from "@/utils/sessionServices";
import {
  currentAccessRouteKey,
  noteAccessSuccess,
  recordForbidden,
} from "@/composables/useAccessStore";
import { usePasswordReset } from "@/composables/usePasswordReset";
import { isPasswordResetError } from "@/utils/passwordResetErrors";

declare module "axios" {
  interface AxiosRequestConfig {
    /** The caller renders a 403 itself, so the access boundary does not record it. */
    skipAccessToast?: boolean;
    /** The caller handles the refusal itself, so the access boundary does not record the 403. */
    silentForbidden?: boolean;
    /** Route the request started on, so a late 403 is not pinned on the page the user moved to. */
    accessRouteKey?: string;
  }
}

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
    expireSession(store);
    return Promise.reject(new Error("Cloud environment: direct logout"));
  }

  if (config.isEnterprise == "true" && (store.state as any).zoConfig.sso_enabled) {
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
          return undefined;
        })
        .catch(() => {
          return refreshInstance
            .get("/config/logout")
            .finally(() => expireSession(store))
            .then(() => Promise.reject(new Error("Refresh failed")));
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    return refreshPromise;
  }

  // Not enterprise SSO — standard logout
  expireSession(store);
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

  instance.interceptors.request.use((requestConfig) => {
    requestConfig.accessRouteKey = currentAccessRouteKey();
    return requestConfig;
  });

  instance.interceptors.response.use(
    function (response) {
      noteAccessSuccess({
        url: response.request?.responseURL || response.config?.url,
        method: response.config?.method,
        routeKey: response.config?.accessRouteKey,
      });
      return response;
    },
    function (error) {
      // Ahead of the status switch: a reset-required 403 is a policy state, not an authorization failure.
      if (isPasswordResetError(error)) {
        usePasswordReset().open(error.response.data.reason);
        // A blocked page fires many requests behind an undismissable dialog; one toast per rejection would stack.
        return new Promise(() => {});
      }
      if (error && error.response && error.response.status) {
        switch (error.response.status) {
          case 400:
            break;
          case 401:
            if (config.isCloud == "true" && !error.request.responseURL.includes("/auth/login")) {
              expireSession(store);
            }
            // Delegate to the shared refresh helper — it owns the URL exclusion
            // checks and the logout-on-failure path. Retry the original request
            // once the token is refreshed.
            else if (config.isEnterprise == "true" && (store.state as any).zoConfig.sso_enabled) {
              return attemptTokenRefresh(error.config.url)
                .then(() => instance.request(error.config))
                .catch(() => Promise.reject(error));
            } else {
              if (!error.request.responseURL.includes("/login")) expireSession(store);
            }
            break;
          case 403:
            if (
              (config.isEnterprise == "true" || config.isCloud == "true") &&
              !error.config?.skipAccessToast &&
              !error.config?.silentForbidden
            ) {
              const responseUrl = error.request?.responseURL || error.config?.url || "";
              recordForbidden({
                url: responseUrl,
                method: error.config?.method,
                routeKey: error.config?.accessRouteKey,
              });
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
