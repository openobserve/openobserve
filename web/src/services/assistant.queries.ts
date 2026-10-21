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

import { LIVE_STALE_TIME, SESSION_STALE_TIME } from "@/composables/query/cachePolicy";

import assistant from "./assistant";
import { assistantKeys } from "./assistant.querykeys";

/** B-06 capabilities; `enabled` is false on an unentitled or unconfigured build, so nothing is requested there. */
export const capabilitiesQuery = (org: string, enabled = true) =>
  queryOptions({
    queryKey: assistantKeys.capabilities(org),
    queryFn: () => assistant.capabilities(org),
    staleTime: SESSION_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: enabled && !!org,
  });

/** Cloud only: every caller gates the read on the edition; every turn end invalidates it. */
export const assistantUsageQuery = (org: string) =>
  queryOptions({
    queryKey: assistantKeys.usage(org),
    queryFn: () => assistant.usage(org),
    staleTime: LIVE_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    enabled: !!org,
  });
