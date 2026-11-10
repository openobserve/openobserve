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
import { orgKey } from "@/composables/query/keys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import securityIntel, { type SightingsRequest, type SightingsResponse } from "./securityIntel";

export const securityIntelKeys = {
  all: (org: string) => orgKey(org, "security", "intel"),
  sightings: (org: string, req: SightingsRequest) =>
    orgKey(
      org,
      "security",
      "intel",
      "sightings",
      req.type,
      req.indicator,
      req.interval,
      req.start_time,
      req.end_time,
      req.sightings.map((s) => `${s.stream}|${s.column}|${s.mode}`).join(","),
    ),
};

/** One indicator's sightings over the pinned sweep window, per stream and column. */
export const intelSightingsQuery = (org: string, req: SightingsRequest) =>
  queryOptions({
    queryKey: securityIntelKeys.sightings(org, req),
    queryFn: async (): Promise<SightingsResponse> => (await securityIntel.sightings(org, req)).data,
    staleTime: LIVE_STALE_TIME,
  });
