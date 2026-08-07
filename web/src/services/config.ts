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

import http from "./http";
import { defineGlobalQuery } from "@/composables/query/queryClient";

const zo_config = {
  get_config: () => {
    return http().get(`/config`);
  },
};

export default zo_config;

/**
 * Read by main.ts, MainLayout, Login, General and UsageTab — one cached entry
 * serves all of them. Not persisted despite being session-static: the payload
 * carries the RUM client token, and secrets stay memory-only.
 */
export const configQuery = defineGlobalQuery<[], any>({
  key: ["config", "get"],
  fetch: async () => (await zo_config.get_config()).data,
  tier: "SESSION_STATIC",
  persist: "none",
  scope: ["config"],
});
