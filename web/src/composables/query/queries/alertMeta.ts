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

/** Destinations and templates — read by the alert form, pipelines and IAM. */

import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";
import { useOrgQuery } from "../useOrgQuery";

export type DestinationModule = "alert" | "pipeline";

export interface Destination {
  name: string;
  [extra: string]: unknown;
}

export interface AlertTemplate {
  name: string;
  [extra: string]: unknown;
}

const PAGE_SIZE = 100000;

export const destinationsQueryOptions = (org: string, module?: DestinationModule) => ({
  queryKey: qk.alerts.destinations(org, module),
  queryFn: async (): Promise<Destination[]> =>
    (
      await destinationService.list({
        page_num: 1,
        page_size: PAGE_SIZE,
        sort_by: "name",
        desc: false,
        org_identifier: org,
        module,
      })
    ).data ?? [],
  ...tierOptions("ORG_CONFIG"),
});

export const fetchDestinations = (
  org: string,
  module?: DestinationModule,
): Promise<Destination[]> => queryClient.fetchQuery(destinationsQueryOptions(org, module));

export const invalidateDestinations = (org: string) =>
  // Prefix, not the exact module key: a destination edit can move it between
  // modules, so both module lists must be refetched.
  queryClient.invalidateQueries({ queryKey: [...qk.alerts.root(org), "destinations"] });

export const useDestinations = (module?: DestinationModule) =>
  useOrgQuery<Destination[]>({
    key: (org) => qk.alerts.destinations(org, module),
    fetch: (org) => destinationsQueryOptions(org, module).queryFn(),
    tier: "ORG_CONFIG",
  });

export const templatesQueryOptions = (org: string) => ({
  queryKey: qk.alerts.templates(org),
  queryFn: async (): Promise<AlertTemplate[]> =>
    (await templateService.list({ org_identifier: org })).data ?? [],
  ...tierOptions("ORG_CONFIG"),
});

export const fetchTemplates = (org: string): Promise<AlertTemplate[]> =>
  queryClient.fetchQuery(templatesQueryOptions(org));

export const invalidateTemplates = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.alerts.templates(org) });

export const useTemplates = () =>
  useOrgQuery<AlertTemplate[]>({
    key: (org) => qk.alerts.templates(org),
    fetch: (org) => templatesQueryOptions(org).queryFn(),
    tier: "ORG_CONFIG",
  });
