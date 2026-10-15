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
import searchService from "./search";
import { k8sKeys } from "./kubernetes.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";
import { parseVector, type Series } from "@/views/Infrastructure/kubernetes2/kubernetesModel";

// Two absolute END times inside one bucket must not share a key, because each request uses its exact time.
const timeKey = (startUs: number, endUs: number, relative: boolean) =>
  relative ? quantizeRange(startUs, endUs) : { start: startUs, end: endUs };

export const k8sInstantQuery = (
  org: string,
  id: string,
  text: string,
  endUs: number,
  relative: boolean,
) =>
  queryOptions({
    queryKey: k8sKeys.instant(org, id, text, timeKey(endUs, endUs, relative).end),
    queryFn: async (): Promise<Series[]> =>
      parseVector(
        await searchService.metrics_query({
          org_identifier: org,
          // metrics_query interpolates the query raw into the URL.
          query: encodeURIComponent(text),
          end_time: endUs,
        }),
      ),
    staleTime: LIVE_STALE_TIME,
  });

export const k8sSqlQuery = (
  org: string,
  name: string,
  sql: string,
  startUs: number,
  endUs: number,
  relative: boolean,
  size?: number,
) =>
  queryOptions({
    queryKey: k8sKeys.sql(org, name, sql, timeKey(startUs, endUs, relative)),
    queryFn: async (): Promise<any[]> => {
      const res: any = await searchService.search(
        {
          org_identifier: org,
          query: {
            query: {
              sql,
              start_time: startUs,
              end_time: endUs,
              from: 0,
              ...(size ? { size } : {}),
            },
          },
          page_type: "logs",
        },
        "ui",
      );
      return res?.data?.hits ?? [];
    },
    staleTime: LIVE_STALE_TIME,
  });
