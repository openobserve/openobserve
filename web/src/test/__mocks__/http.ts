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

import { vi } from "vitest";
import axios from "axios";
import { Notify } from "quasar"; // ✅ Ensure Quasar Notify works in mock

vi.mock("@/services/http.ts", () => ({
  default: () => {
    const instance = axios.create({
      withCredentials: true,
      baseURL: "http://localhost:5080", // 🔹 Replacing `store.state.API_ENDPOINT`
    });

    // Mock request interceptor
    instance.interceptors.request.use(
      (config) => {
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Mock response interceptor with error handling
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error("Mock Interceptor Error", error);

        if (error?.response?.status === 400) {
          return Promise.reject({
            response: { status: 400, data: "Bad Request" },
          });
        }

        if (error?.response?.status === 401) {
          console.log("Mock 401: Unauthorized - Logging out user...");
          sessionStorage.clear(); // Simulate logout
          return Promise.reject({
            response: { status: 401, data: "Unauthorized" },
          });
        }

        if (error?.response?.status === 403) {
          console.log("Mock 403: Forbidden - Showing notification...");
          Notify.create({
            message: "Unauthorized Access: Please contact your administrator.",
            color: "negative",
            timeout: 0,
          });
          return Promise.reject({
            response: { status: 403, data: "Forbidden" },
          });
        }

        return Promise.reject({
          response: { status: 500, data: "Internal Server Error" },
        });
      },
    );

    return instance;
  },
}));
