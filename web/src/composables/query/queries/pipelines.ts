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
 * Pipeline definitions.
 *
 * Client-paginated: the page filters, sorts and pages in the browser, so none
 * of that reaches the query key.
 */

import pipelineService from "@/services/pipelines";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";
import { createDetailQuery } from "../createDetailQuery";

export const pipelinesQuery = createOrgListQuery<any>({
  key: (org) => qk.pipelines.list(org),
  fetch: async (org) => (await pipelineService.getPipelines(org)).data?.list ?? [],
  tier: "ENTITY_LIST",
  root: (org) => qk.pipelines.root(org),
});

export const pipelineDetailQuery = createDetailQuery<[name: string]>({
  key: (org, name) => qk.pipelines.detail(org, name),
  fetch: async (org, name) =>
    (await pipelineService.getPipeline({ name, org_identifier: org })).data,
  root: (org) => qk.pipelines.root(org),
});
