// Copyright 2023 OpenObserve Inc.
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
      console.log("axios error", error);
      if (error && error.response && error.response.status) {
        console.log(
          JSON.stringify(
            error.response.data["error"] ||
              "Error occurred while making request"
          )
        );
        segment?.track("Error occurred while making request", {
          error: error.response.data["error"],
          status: error.response.status,
        });
      } else {
        console.log(
          JSON.stringify({ error: "Error occurred while making request" })
        );
        segment?.track("Error occurred while making request");
      }
      switch (error.response?.status) {
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
          // Check if the failing request is not the login or refresh token request
          else if (
            config.isEnterprise == "true" &&
            (store.state as any).zoConfig.sso_enabled &&
            !error.config.url.includes("/config/dex_login") &&
            !error.config.url.includes("/config/dex_refresh") &&
            !error.config.url.includes("/auth/login")
          ) {
            // Modify the request to include the refresh token
            return instance
              .get("/config/dex_refresh", {
                //headers: { Authorization: `${refreshToken}` },
              })
              .then((res) => {
                if (res.status === 200) {
                  // Token refreshed successfully, retry the original request
                  return instance.request(error.config);
                }
              })
              .catch((refreshError) => {
                instance.get("/config/logout", {}).then((res) => {
                  store.dispatch("logout");
                  useLocalCurrentUser("", true);
                  useLocalUserInfo("", true);
                  sessionStorage.clear();
                  window.location.reload();
                  return Promise.reject(refreshError);
                });
              });
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
          if (config.isEnterprise == "true" || config.isEnterprise == "true") {
            Notify.create({
              message:
                "Unauthorized Access: You are not authorized to perform this operation, please contact your administrator.",
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
          break;
        case 404:
          break;
        case 500:
          break;
        default:
          // noop
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

export default http;
