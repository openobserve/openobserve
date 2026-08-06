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
 * Single-entity reads — what an editor loads when you open one row.
 *
 * ENTITY_DETAIL (30 s, memory, never persisted): long enough that closing and
 * reopening an editor is free, short enough that a row changed elsewhere does
 * not stay wrong for long. Save paths invalidate their own entity, so the
 * staleness window only covers edits made outside this tab.
 *
 * Two reads deliberately do NOT use this and go straight to their service:
 * `dashboards.get_Dashboard`, whose `hash` drives optimistic-concurrency saves,
 * and the read-modify-write in WorkflowLinkAlertsDialog. A cached value in
 * either would overwrite someone else's edit. See inventory section 3i.
 *
 * This file imports no services on purpose — each domain module declares its own
 * detail query, so a spec that mocks one service does not drag in six others.
 */

import { queryClient } from "./queryClient";
import { tierOptions } from "./tiers";

export function createDetailQuery<TArgs extends unknown[]>(config: {
  key: (org: string, ...args: TArgs) => readonly unknown[];
  fetch: (org: string, ...args: TArgs) => Promise<any>;
  /** Prefix dropped by `invalidate` — normally the domain root. */
  root: (org: string) => readonly unknown[];
}) {
  const options = (org: string, ...args: TArgs) => ({
    queryKey: config.key(org, ...args),
    queryFn: () => config.fetch(org, ...args),
    ...tierOptions("ENTITY_DETAIL"),
  });

  return {
    fetch: (org: string, ...args: TArgs) => queryClient.fetchQuery(options(org, ...args)),
    refetch: (org: string, ...args: TArgs) =>
      queryClient.fetchQuery({ ...options(org, ...args), staleTime: 0 }),
    invalidate: (org: string) => queryClient.invalidateQueries({ queryKey: config.root(org) }),
  };
}

export default createDetailQuery;
