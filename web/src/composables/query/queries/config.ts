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

/**
 * `/config` — the app shell's own settings. Fetched by `main.ts`, `MainLayout`,
 * `Login`, `General`, `UsageTab` and the build-version checker; one cached entry
 * now serves all of them.
 */

import configService from "@/services/config";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

export const configQueryOptions = () => ({
  queryKey: qk.config.get(),
  queryFn: async (): Promise<any> => (await configService.get_config()).data,
  // Not persisted despite being session-static: the payload carries the RUM
  // client token, and secrets stay memory-only. The win here is deduping the
  // eight call sites, not surviving a reload.
  ...tierOptions("SESSION_STATIC", { persist: "none" }),
});

export const fetchConfig = (): Promise<any> => queryClient.fetchQuery(configQueryOptions());

/**
 * Force a fresh `/config`. The build-version checker needs the live commit hash
 * to detect a deployment, so it must bypass `staleTime: Infinity`.
 */
export const refetchConfig = (): Promise<any> =>
  queryClient.fetchQuery({ ...configQueryOptions(), staleTime: 0 });
