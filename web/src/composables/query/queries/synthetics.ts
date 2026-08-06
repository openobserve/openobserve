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
 * Synthetic monitors.
 *
 * Client-paginated: the page filters, sorts and pages in the browser, so none
 * of that reaches the query key.
 */

import syntheticsService from "@/services/synthetics";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";
import { createDetailQuery } from "../createDetailQuery";

export const syntheticsMonitorsQuery = createOrgListQuery<any, [folderId?: string]>({
  key: (org, folderId) => qk.synthetics.monitors(org, folderId),
  // The API field was renamed `monitors` -> `checks`. Both are read so a
  // bundle and a server on opposite sides of that rename still render.
  fetch: async (org, folderId) => {
    const data = (await syntheticsService.listByFolderId(org, folderId)).data as any;
    return data?.checks ?? data?.monitors ?? [];
  },
  tier: "ENTITY_LIST",
  root: (org) => qk.synthetics.root(org),
});

export const monitorDetailQuery = createDetailQuery<[id: string, folderId?: string]>({
  key: (org, id, folderId) => [...qk.synthetics.root(org), "detail", id, folderId ?? ""] as const,
  fetch: async (org, id, folderId) => (await syntheticsService.get(org, id, folderId)).data,
  root: (org) => qk.synthetics.root(org),
});
