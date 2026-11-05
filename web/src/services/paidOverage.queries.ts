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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";

import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

import paidOverage, { type PaidOverageFeature, type PaidOverageStatus } from "./paidOverage";
import { paidOverageKeys } from "./paidOverage.querykeys";

/** `GET paid_overage`; a consent card and the meter re-read it on focus and on the `consent_granted` hint. */
export const paidOverageQuery = (org: string, feature: PaidOverageFeature) =>
  queryOptions({
    queryKey: paidOverageKeys.status(org, feature),
    queryFn: async (): Promise<PaidOverageStatus> => (await paidOverage.get(org, feature)).data,
    staleTime: LIVE_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

/** `PUT paid_overage` for one organization; every read of the org's status refetches after it. */
export const setPaidOverageMutation = (org: string, feature: PaidOverageFeature) =>
  mutationOptions({
    mutationFn: async (enabled: boolean): Promise<PaidOverageStatus> =>
      (await paidOverage.update(org, feature, enabled)).data,
    meta: { invalidates: [paidOverageKeys.all(org)], silentError: true },
  });
