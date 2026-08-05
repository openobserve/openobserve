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
 * Workflow definitions.
 *
 * Client-paginated: the page filters, sorts and pages in the browser, so none
 * of that reaches the query key.
 */

import workflowsService from "@/services/workflows";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";

export const workflowsQuery = createOrgListQuery<any>({
  key: (org) => qk.workflows.list(org),
  fetch: async (org) => {
    // The list handler returns a bare array; older builds wrapped it in `list`.
    const data = (await workflowsService.listWorkflows(org)).data;
    return Array.isArray(data) ? data : (data?.list ?? []);
  },
  tier: "ENTITY_LIST",
  root: (org) => qk.workflows.root(org),
});
