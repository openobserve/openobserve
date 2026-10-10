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
import ingestion, { toRecentRejections, type RecentRejections } from "./ingestion";

export const ingestionKeys = {
  all: (org: string) => orgKey(org, "ingestion"),
  recentRejections: (org: string) => orgKey(org, "ingestion", "recentRejections"),
};

/** Always re-read: the bar asks while a user is fixing their sender, so a cached answer would be stale by definition. */
export const recentRejectionsQuery = (org: string, apiEndpoint: string) =>
  queryOptions({
    queryKey: ingestionKeys.recentRejections(org),
    queryFn: async (): Promise<RecentRejections> =>
      toRecentRejections((await ingestion.recentRejections(org, apiEndpoint)).data),
    staleTime: 0,
    retry: false,
  });
