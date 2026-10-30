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
 * Database Monitoring context provider — what screen the user is on and what
 * they are looking at, so the assistant does not have to be told twice.
 *
 * The "suggest a fix" prompts already carry the focused artifact in prose. This
 * carries the SCOPE around it — which tab, which window, which instance — so a
 * follow-up question ("and what about the other queries on this box?") lands in
 * the same place the user is looking, rather than at the org root.
 *
 * A getter is taken rather than a snapshot: the registry reads context at send
 * time, which can be many minutes and several filter changes after the page
 * registered. A frozen object would describe a scope the user has left.
 */

import type { ContextProvider, PageContext } from "./types";

/** Which DBM screen — mirrors the route names, so it is stable across renames of the UI copy. */
export type DbmPage = "databases" | "queries" | "query_detail" | "deadlocks" | "blocked_queries";

/** The registry key every DBM page registers under. */
export const DBM_CONTEXT_KEY = "dbm";

export interface DbmContextScope {
  /** Window bounds, microseconds — the same pair the DBM endpoints take. */
  startTime?: number;
  endTime?: number;
  /** `1h` / `15m` on a relative window; absent on an absolute one. */
  period?: string | null;
  /** `postgresql` | `mysql`, when the user has filtered to one engine. */
  system?: string | null;
  instance?: string | null;
  namespace?: string | null;
  env?: string | null;
  service?: string | null;
}

/** The one object the user has drilled into, when there is one. */
export interface DbmContextFocus {
  /** Query detail: the fingerprint and its normalized statement. */
  fingerprint?: string | null;
  query?: string | null;
  /** Deadlocks: both conflicting statements. */
  deadlockQueries?: string[];
  /** Blocked queries: the session at the root of the chain. */
  blockingRootPid?: number | null;
  blockingRootQuery?: string | null;
}

export interface DbmContextInput {
  currentPage: DbmPage;
  scope: DbmContextScope;
  focus?: DbmContextFocus;
}

/**
 * Creates the DBM context provider.
 *
 * @param getInput - Reads the CURRENT page state. Called on every context read.
 * @param store - Vuex store, for the organization identifier.
 */
export const createDbmContextProvider = (
  getInput: () => DbmContextInput,
  store: any,
): ContextProvider => {
  return {
    getContext(): PageContext {
      const input = getInput();
      const scope = input.scope ?? {};
      const focus = input.focus ?? {};

      const context: PageContext = {
        currentPage: `dbm_${input.currentPage}`,
        org_id: store?.state?.selectedOrganization?.identifier || "",
        time_range: {
          start_time: scope.startTime,
          end_time: scope.endTime,
          period: scope.period ?? undefined,
        },
        db_system: scope.system ?? undefined,
        db_instance: scope.instance ?? undefined,
        db_namespace: scope.namespace ?? undefined,
        env: scope.env ?? undefined,
        service_name: scope.service ?? undefined,
        // Microseconds, matching the other providers — the agent does time
        // arithmetic against the window above and both must be one unit.
        request_timestamp: Date.now() * 1000,
      };

      if (focus.fingerprint) context.query_fingerprint = focus.fingerprint;
      if (focus.query) context.query_text = focus.query;
      if (focus.deadlockQueries?.length) context.deadlock_queries = focus.deadlockQueries;
      if (focus.blockingRootPid != null) context.blocking_root_pid = focus.blockingRootPid;
      if (focus.blockingRootQuery) context.blocking_root_query = focus.blockingRootQuery;

      return context;
    },
  };
};
