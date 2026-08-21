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
import anomaly_detection from "./anomaly_detection";
import { anomalyKeys } from "./anomaly_detection.querykeys";

export const anomalyConfigsQuery = (org: string) =>
  queryOptions({
    queryKey: anomalyKeys.list(org),
    queryFn: async (): Promise<any[]> => (await anomaly_detection.list(org)).data ?? [],
    refetchOnWindowFocus: true,
  });

export const anomalyHistoryQuery = (org: string, limit: number) =>
  queryOptions({
    queryKey: anomalyKeys.history(org, limit),
    queryFn: async () => (await anomaly_detection.getAllHistory(org, limit)).data,
    refetchOnWindowFocus: true,
  });
