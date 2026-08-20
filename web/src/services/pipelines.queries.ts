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

import { queryOptions } from "@tanstack/vue-query";
import pipelines from "./pipelines";
import { pipelineKeys } from "./pipelines.querykeys";

export const pipelinesQuery = (org: string) =>
  queryOptions({
    queryKey: pipelineKeys.list(org),
    queryFn: async (): Promise<any[]> => (await pipelines.getPipelines(org)).data?.list ?? [],
    refetchOnWindowFocus: true,
  });

export const pipelineDetailQuery = (org: string, name: string) =>
  queryOptions({
    queryKey: pipelineKeys.detail(org, name),
    queryFn: async () => (await pipelines.getPipeline({ name, org_identifier: org })).data,
  });
