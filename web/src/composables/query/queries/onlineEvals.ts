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
 * Online Evals (enterprise). Four org-scoped lists behind one service, loaded
 * together on every visit to the page and again by the scorer library and the
 * manual-evaluation dialog.
 *
 * The service already unwraps axios, so these query functions return the list
 * directly.
 */

import onlineEvalsService from "@/services/online-evals.service";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const root = (org: string) => [...qk.org(org), "onlineEvals"] as const;

const make = <T>(name: string, tier: "ORG_CONFIG" | "ENTITY_LIST", fn: (org: string) => Promise<T>) => {
  const options = (org: string) => ({
    queryKey: [...root(org), name] as const,
    queryFn: () => fn(org),
    ...tierOptions(tier),
  });
  return {
    fetch: (org: string) => queryClient.fetchQuery(options(org)),
    refetch: (org: string) => queryClient.fetchQuery({ ...options(org), staleTime: 0 }),
  };
};

/** Providers change rarely and gate the job form, so they persist. */
export const providersQuery = make("providers", "ORG_CONFIG", (org) =>
  onlineEvalsService.providers.list(org),
);
export const scoreConfigsQuery = make("scoreConfigs", "ENTITY_LIST", (org) =>
  onlineEvalsService.scoreConfigs.list(org),
);
export const scorersQuery = make("scorers", "ENTITY_LIST", (org) =>
  onlineEvalsService.scorers.list(org),
);
export const evalJobsQuery = make("jobs", "ENTITY_LIST", (org) => onlineEvalsService.jobs.list(org));

/** One prefix covers all four — any write here can affect more than one list. */
export const invalidateOnlineEvals = (org: string) =>
  queryClient.invalidateQueries({ queryKey: root(org) });
