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

import { orgKey } from "@/composables/query/keys";

/**
 * Keys for panel results, in the same shape as every other domain so the
 * org-switch and logout purges reach them by prefix rather than by a namespace
 * only this cache knows about.
 *
 * `digest` is the FNV-1a hash of the normalized schema + variables from
 * `panelKey.ts` — a panel's identity is that pair, not its id, so two variable
 * combinations occupy two entries instead of evicting each other.
 */
export const panelKeys = {
  all: (org: string) => orgKey(org, "panels"),
  dashboard: (org: string, folderId: string, dashboardId: string) =>
    orgKey(org, "panels", folderId, dashboardId),
  result: (org: string, folderId: string, dashboardId: string, panelId: string, digest: string) =>
    orgKey(org, "panels", folderId, dashboardId, panelId, digest),
};
