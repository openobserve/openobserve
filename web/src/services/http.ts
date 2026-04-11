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
import { Notify } from "quasar";
import { useLocalUserInfo, useLocalCurrentUser } from "@/utils/zincutils";

// Shared refresh state — ensures only one dex_refresh request is in-flight
// at a time across all axios instances. All concurrent 401s wait on the same
// Promise and retry once it resolves.
let refreshPromise: Promise<void> | null = null;

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
            console.log(
              JSON.stringify(error.response.data["error"] || "Bad Request")
            );
            break;
          case 401:
            console.log(
              JSON.stringify(
                error.response.data["error"] || "Invalid credentials"
              )
            );
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
            // Check if the failing request is not the login or refresh token request
            else if (
              config.isEnterprise == "true" &&
              (store.state as any).zoConfig.sso_enabled &&
              !error.config.url.includes("/config/dex_login") &&
              !error.config.url.includes("/config/dex_refresh") &&
              !error.config.url.includes("/auth/login")
            ) {
              // If no refresh is in-flight, start one. All concurrent 401s
              // share the same Promise so only a single /config/dex_refresh
              // request is made.
              if (!refreshPromise) {
                refreshPromise = instance
                  .get("/config/dex_refresh", {})
                  .then((res) => {
                    if (res.status !== 200) {
                      return Promise.reject(
                        new Error("Refresh returned non-200"),
                      );
                    }
                  })
                  .catch((refreshError) => {
                    return instance
                      .get("/config/logout", {})
                      .finally(() => {
                        store.dispatch("logout");
                        useLocalCurrentUser("", true);
                        useLocalUserInfo("", true);
                        sessionStorage.clear();
                        window.location.reload();
                      })
                      .then(() => Promise.reject(refreshError));
                  })
                  .finally(() => {
                    refreshPromise = null;
                  });
              }

              // Wait for the shared refresh, then retry the original request
              return refreshPromise.then(() =>
                instance.request(error.config),
              );
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
              const backendError = error.response?.data?.["error"];
              let resourceHint = "";
              try {
                const urlPath =
                  error.request?.responseURL || error.config?.url || "";
                // Dynamically extract the most specific resource name from the URL.
                //
                // URL families handled:
                //   Standard:  /api/{org}/{resource}/{id}/{sub-resource}/...
                //   Versioned: /api/v2/{org}/{resource}/{id}/{sub-resource}/...
                //   Meta:      /api/_meta/{module}/{action}  (no org segment)
                //
                // Algorithm:
                //   1. Skip the leading "api" segment.
                //   2. Skip an optional version prefix (v1, v2, …).
                //   3. If the next segment begins with "_", it is a special namespace
                //      (e.g. _meta) with no org — use the last remaining segment.
                //   4. Otherwise the next segment is the org identifier — skip it,
                //      then collect everything that does NOT look like an ID
                //      (UUID, plain integer, or e-mail address) and use the last one.
                const segments = new URL(urlPath).pathname
                  .split("/")
                  .filter(Boolean);
                // segments[0] is always "api"
                let idx = 1;

                // Step 2: skip version prefix
                if (/^v\d+$/.test(segments[idx] ?? "")) idx++;

                const candidate = segments[idx];
                if (candidate?.startsWith("_")) {
                  // Step 3: special namespace (_meta, etc.) — no org segment
                  const remaining = segments.slice(idx + 1);
                  if (remaining.length > 0) {
                    resourceHint = ` on "${remaining[remaining.length - 1]}"`;
                  }
                } else if (candidate) {
                  // Step 4: skip the org identifier
                  idx++;
                  const resourcePath = segments.slice(idx);
                  const uuidRe =
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                  const isId = (s: string) =>
                    s.includes("@") || /^\d+$/.test(s) || uuidRe.test(s);
                  const resourceNames = resourcePath.filter((s) => !isId(s));
                  if (resourceNames.length > 0) {
                    // Map known multi-segment paths to friendly names
                    const joined = resourceNames.join("/");
                    const friendlyNames: Record<string, string> = {
                      "llm/models": "LLM Model Pricing",
                      "llm/models/built-in": "LLM Model Pricing",
                      "llm/models/refresh-built-in": "LLM Model Pricing",
                    };
                    const friendly = friendlyNames[joined];
                    resourceHint = ` on "${friendly || resourceNames[resourceNames.length - 1]}"`;
                  }
                }
              } catch {
                // ignore URL parse errors
              }
              const notifyMessage = backendError
                ? `Unauthorized Access: ${backendError}`
                : `Unauthorized Access: You are not authorized to perform this operation${resourceHint}. Please contact your administrator.`;
              Notify.create({
                message: notifyMessage,
                timeout: 0, // This ensures the notification does not close automatically
                color: "negative", // Customize color as needed
                position: "top",
                actions: [
                  {
                    color: "white",
                    icon: "close",
                    size: "sm",
                  },
                ],
              });
            }
            console.log(
              JSON.stringify(
                error.response.data["error"] || "Unauthorized Access"
              )
            );
            break;
          case 404:
            console.log(
              JSON.stringify(error.response.data["error"] || "Not Found")
            );
            break;
          case 500:
            console.log(
              JSON.stringify(
                error.response.data["error"] || "Invalid ServerError"
              )
            );
            break;
          default:
          // noop
        }
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

export default http;
