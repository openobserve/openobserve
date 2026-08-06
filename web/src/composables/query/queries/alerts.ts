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
 * Alerts for one folder, or a name search across all of them.
 *
 * The folder and the search term are both applied by the server, so both are in
 * the key — searches used to bypass the cache entirely, so re-typing one always
 * cost a request. The tab filter is client-side and deliberately absent.
 *
 * The rows are cached raw; AlertList maps them into its table shape, because
 * that mapping needs component-local helpers.
 */

import alertsService from "@/services/alerts";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";
import { createDetailQuery } from "../createDetailQuery";

const PAGE_SIZE = 1000;

export const alertsListQuery = createOrgListQuery<any, [folderId: string, query?: string]>({
  key: (org, folderId, query) =>
    query
      ? qk.alerts.search(org, folderId || "__all__", { q: query })
      : qk.alerts.listByFolder(org, folderId),
  fetch: async (org, folderId, query) =>
    (
      await alertsService.listByFolderId(
        1,
        PAGE_SIZE,
        "name",
        false,
        "",
        org,
        folderId,
        query ?? "",
      )
    ).data?.list ?? [],
  tier: "ENTITY_LIST",
  root: (org) => qk.alerts.root(org),
});

export const alertDetailQuery = createDetailQuery<[alertId: string]>({
  key: (org, id) => qk.alerts.detail(org, id),
  fetch: async (org, id) => (await alertsService.get_by_alert_id(org, id)).data,
  root: (org) => qk.alerts.root(org),
});
