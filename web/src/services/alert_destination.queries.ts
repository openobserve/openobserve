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
import destination from "./alert_destination";
import { destinationKeys } from "./alert_destination.querykeys";
import type { DestinationModule } from "./alert_destination.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";

/**
 * Read by the alert form, pipelines and IAM. Memory-only: destination payloads
 * can carry webhook Authorization headers and PagerDuty/Opsgenie/ServiceNow
 * keys, which must not sit in localStorage like the other config lists do.
 */
export const destinationsQuery = (org: string, module?: DestinationModule) =>
  queryOptions({
    queryKey: destinationKeys.list(org, module),
    queryFn: async (): Promise<any[]> =>
      (
        await destination.list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: org,
          module,
        })
      ).data ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const saveDestinationMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (vars: { destination_name: string; data: any; module?: DestinationModule }) =>
      isUpdate()
        ? destination.update({ org_identifier: org, ...vars })
        : destination.create({ org_identifier: org, ...vars }),
    // The form composes its own success/error toasts.
    meta: { invalidates: [destinationKeys.all(org)], silentError: true },
  });

export const deleteDestinationMutation = (org: string) =>
  mutationOptions({
    mutationFn: (destination_name: string) =>
      destination.delete({ org_identifier: org, destination_name }),
    meta: { invalidates: [destinationKeys.all(org)], silentError: true },
  });

export const bulkDeleteDestinationsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (names: string[]) => destination.bulkDelete(org, { ids: names }),
    // Per-item response, so the outcome toast is the caller's to compose.
    meta: { invalidates: [destinationKeys.all(org)], silentError: true },
  });
