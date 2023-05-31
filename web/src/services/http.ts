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

import store from "../stores";
import axios from "axios";
import config from "../aws-exports";

const http = ({ headers } = {} as any) => {
  const instance = axios.create({
    // timeout: 10000,
    baseURL: store.state.API_ENDPOINT,
    headers: {
      Authorization:
        config.isOpenObserveCloud == "true"
          ? "Bearer " + localStorage.getItem("token")
          : localStorage.getItem("token") || "",
      ...headers,
    },
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
            store.dispatch("logout");
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
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
