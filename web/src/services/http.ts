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
import { usePasswordReset } from "@/composables/usePasswordReset";
import { isPasswordResetError } from "@/utils/passwordResetErrors";
import { ASSISTANT_DRAFT_KEY, clearSessionStorageExcept } from "@/utils/clearSessionStorage";

declare module "axios" {
  interface AxiosRequestConfig {
    /** The caller renders a 403 itself, so it is left out of the grouped "Access Required" toast. */
    skipAccessToast?: boolean;
    /** Skip the global Unauthorized toast on a 403; the caller handles the refusal itself. */
    silentForbidden?: boolean;
    /** An assistant request that handles 401 itself, so it never takes the logout-and-reload branch. */
    assistantManaged?: boolean;
    /** Set on the one retry of an assistant request after an SSO refresh. */
    assistantRetried?: boolean;
  }
}

// Shared refresh state — ensures only one dex_refresh request is in-flight
// at a time across all axios instances and streaming fetch requests. All
// concurrent 401s wait on the same Promise and retry once it resolves.
let refreshPromise: Promise<void> | null = null;

// The one dex_refresh request in flight; assistant 401s share it without the logout-on-failure wrapper.
let dexRefreshPromise: Promise<void> | null = null;

const sharedDexRefresh = (): Promise<void> => {
  dexRefreshPromise ??= axios
    .create({ withCredentials: true, baseURL: store.state.API_ENDPOINT })
    .get("/config/dex_refresh")
    .then((res) => {
      if (res.status !== 200) return Promise.reject(new Error("Refresh returned non-200"));
      return undefined;
    })
    .finally(() => {
      dexRefreshPromise = null;
    });
  return dexRefreshPromise;
};

/** Refreshes the session for an assistant call; never logs out, clears storage or reloads (`00` §5.1). */
export const refreshSession = (): Promise<"refreshed" | "expired"> => {
  const sso =
    config.isCloud != "true" &&
    config.isEnterprise == "true" &&
    (store.state as any).zoConfig?.sso_enabled;
  if (!sso) return Promise.resolve("expired");
  return (refreshPromise ?? sharedDexRefresh()).then(
    () => "refreshed" as const,
    () => "expired" as const,
  );
};

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
    clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
    window.location.reload();
    return Promise.reject(new Error("Cloud environment: direct logout"));
  }

  if (config.isEnterprise == "true" && (store.state as any).zoConfig.sso_enabled) {
    if (!refreshPromise) {
      const refreshInstance = axios.create({
        withCredentials: true,
        baseURL: store.state.API_ENDPOINT,
      });
      refreshPromise = sharedDexRefresh()
        .catch(() => {
          return refreshInstance
            .get("/config/logout")
            .finally(() => {
              store.dispatch("logout");
              useLocalCurrentUser("", true);
              useLocalUserInfo("", true);
              clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
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
  clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
  window.location.reload();
  return Promise.reject(new Error("Not SSO: cannot refresh"));
};

// An assistant 401 keeps the SSO refresh and its one retry, but never the logout-and-reload branches (`00` §12.3).
const retryAssistantAfterRefresh = (instance: AxiosInstance, error: any): Promise<unknown> => {
  const sso = config.isEnterprise == "true" && (store.state as any).zoConfig.sso_enabled;
  if (!sso || error.config.assistantRetried) return Promise.reject(error);
  // A failed refresh rejects with the original 401; the retry settles with its own result.
  return sharedDexRefresh().then(
    () => instance.request({ ...error.config, assistantRetried: true }),
    () => Promise.reject(error),
  );
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
            if (error.config?.assistantManaged) return retryAssistantAfterRefresh(instance, error);
            if (config.isCloud == "true" && !error.request.responseURL.includes("/auth/login")) {
              store.dispatch("logout");
              useLocalCurrentUser("", true);
              useLocalUserInfo("", true);
              clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
              window.location.reload();
            }
            // Delegate to the shared refresh helper — it owns the URL exclusion
            // checks and the logout-on-failure path. Retry the original request
            // once the token is refreshed.
            else if (config.isEnterprise == "true" && (store.state as any).zoConfig.sso_enabled) {
              return attemptTokenRefresh(error.config.url)
                .then(() => instance.request(error.config))
                .catch(() => Promise.reject(error));
            } else {
              if (!error.request.responseURL.includes("/login")) {
                store.dispatch("logout");
                useLocalCurrentUser("", true);
                useLocalUserInfo("", true);
                clearSessionStorageExcept(ASSISTANT_DRAFT_KEY);
                window.location.reload();
              }
            }
            break;
          case 403:
            if (
              (config.isEnterprise == "true" || config.isCloud == "true") &&
              !error.config?.skipAccessToast &&
              !error.config?.silentForbidden
            ) {
              const responseUrl = error.request?.responseURL || error.config?.url || "";
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
