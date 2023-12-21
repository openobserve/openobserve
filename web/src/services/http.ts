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

import store from "../stores";
import axios from "axios";
import config from "../aws-exports";

const http = ({ headers } = {} as any) => {
  let instance;
  if (config.isEnterprise == "false" || !config.isEnterprise) {
    headers = {
      Authorization:
        (config.isCloud == "true")
          ? "Bearer " + localStorage.getItem("token")
          : localStorage.getItem("token") || "",
      ...headers,
    };
    instance = axios.create({
      // timeout: 10000,
      baseURL: store.state.API_ENDPOINT,
      headers,
    });
  } else {
    instance = axios.create({
      // timeout: 10000,
      baseURL: store.state.API_ENDPOINT,
      withCredentials: config.isEnterprise,
      headers,
    });
  }

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
            if (!error.request.responseURL.includes("/auth/login")) {
              store.dispatch("logout");
              localStorage.clear();
              sessionStorage.clear();
              window.location.reload();
            }
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
