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

/** Saved log views — re-read on every entry to the Logs page. */

import savedviewsService from "@/services/saved_views";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const savedViewsOptions = (org: string) => ({
  queryKey: qk.search.savedViews(org),
  queryFn: async (): Promise<any[]> => (await savedviewsService.get(org)).data?.views ?? [],
  ...tierOptions("ENTITY_LIST"),
});

export const fetchSavedViews = (org: string): Promise<any[]> =>
  queryClient.fetchQuery(savedViewsOptions(org));

export const refetchSavedViews = (org: string): Promise<any[]> =>
  queryClient.fetchQuery({ ...savedViewsOptions(org), staleTime: 0 });

export const invalidateSavedViews = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.search.savedViews(org) });
