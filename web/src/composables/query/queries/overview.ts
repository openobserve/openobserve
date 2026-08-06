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
 * The Home page's Overview tab.
 *
 * Its panels are rendered behind `v-if`, so every tab switch unmounts and
 * remounts them and re-runs their loaders. That is what made switching tabs
 * re-request everything.
 *
 * The reads whose range is relative to "now" key on a *quantised* range — the
 * request still carries the caller's exact timestamps, but the key is rounded to
 * a minute so a remount inside that minute is a hit.
 */

import incidentsService from "@/services/incidents";
import serviceGraphService from "@/services/service_graph";
import anomalyService from "@/services/anomaly_detection";
import organizationsService from "@/services/organizations";
import { qk, quantizeRange } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

export interface Range {
  startTime: number;
  endTime: number;
}

const incidentsOptions = (org: string, status: string, limit: number, offset: number) => ({
  queryKey: qk.incidents.list(org, { status, limit, offset }),
  queryFn: async (): Promise<any> => (await incidentsService.list(org, status, limit, offset)).data,
  ...tierOptions("ENTITY_LIST"),
});

/**
 * `force` is the Refresh button and any post-write reload. Everything else —
 * mounts, tab switches — reads the cache.
 */
export const fetchIncidents = (
  org: string,
  status = "open",
  limit = 4,
  offset = 0,
  force = false,
): Promise<any> =>
  queryClient.fetchQuery(
    force
      ? { ...incidentsOptions(org, status, limit, offset), staleTime: 0 }
      : incidentsOptions(org, status, limit, offset),
  );

export const invalidateIncidents = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.incidents.root(org) });

/**
 * 5-minute buckets, not the 60s default. The Overview shows a rolling 15-minute
 * window, so minute precision in the key buys nothing and makes a tab switch
 * that straddles a minute boundary miss. The request still carries the exact
 * range; only the key is rounded.
 */
const OVERVIEW_BUCKET_MS = 5 * 60_000;

const topologyOptions = (org: string, range: Range) => ({
  queryKey: [
    ...qk.traces.root(org),
    "topology",
    quantizeRange(range.startTime, range.endTime, OVERVIEW_BUCKET_MS),
  ] as const,
  queryFn: async (): Promise<any> =>
    (await serviceGraphService.getCurrentTopology(org, range)).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchServiceTopology = (org: string, range: Range, force = false): Promise<any> =>
  queryClient.fetchQuery(
    force ? { ...topologyOptions(org, range), staleTime: 0 } : topologyOptions(org, range),
  );

const anomalyListOptions = (org: string) => ({
  queryKey: [...qk.org(org), "anomalyDetection", "list"] as const,
  queryFn: async (): Promise<any[]> => (await anomalyService.list(org)).data ?? [],
  ...tierOptions("ENTITY_LIST"),
});

export const fetchAnomalyConfigs = (org: string, force = false): Promise<any[]> =>
  queryClient.fetchQuery(
    force ? { ...anomalyListOptions(org), staleTime: 0 } : anomalyListOptions(org),
  );

const anomalyHistoryOptions = (org: string, limit: number) => ({
  queryKey: [...qk.org(org), "anomalyDetection", "history", limit] as const,
  queryFn: async (): Promise<any> => (await anomalyService.getAllHistory(org, limit)).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchAnomalyHistory = (org: string, limit = 20, force = false): Promise<any> =>
  queryClient.fetchQuery(
    force
      ? { ...anomalyHistoryOptions(org, limit), staleTime: 0 }
      : anomalyHistoryOptions(org, limit),
  );

const orgSummaryOptions = (org: string) => ({
  queryKey: [...qk.organizations.root(org), "summary"] as const,
  queryFn: async (): Promise<any> =>
    (await organizationsService.get_organization_summary(org)).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchOrgSummary = (org: string): Promise<any> =>
  queryClient.fetchQuery(orgSummaryOptions(org));

/** Exposed so callers that build their own query params round the same way. */
export const overviewRange = (startTime: number, endTime: number) =>
  quantizeRange(startTime, endTime, OVERVIEW_BUCKET_MS);
