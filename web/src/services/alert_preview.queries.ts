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
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";
import metrics from "./metrics";
import type { SeriesLabels } from "@/utils/alerts/promqlNoSeries";

const DAY_MICROS = 24 * 60 * 60 * 1_000_000;

/** The server's PromQL syntax tree of a query, for naming the selectors it reads. */
export const promqlParseTreeQuery = (org: string, query: string) =>
  queryOptions({
    queryKey: ["alerts", org, "promql-parse-tree", query],
    queryFn: async (): Promise<unknown> =>
      (await metrics.parsePromqlQuery({ org_identifier: org, query })).data?.data ?? null,
    staleTime: MEDIUM_STALE_TIME,
  });

/** Every series of one metric over the 24 hours before `endMicros`, as label maps. */
export const promqlDaySeriesQuery = (org: string, metric: string, endMicros: number) => {
  const { start, end } = quantizeRange(endMicros - DAY_MICROS, endMicros);
  return queryOptions({
    queryKey: ["alerts", org, "promql-day-series", metric, start, end],
    queryFn: async (): Promise<SeriesLabels[]> => {
      const response = await metrics.get_promql_series({
        org_identifier: org,
        labels: encodeURIComponent(metric),
        start_time: start,
        end_time: end,
      });
      const data = response.data?.data;
      return Array.isArray(data) ? data : [];
    },
    staleTime: LIVE_STALE_TIME,
  });
};
