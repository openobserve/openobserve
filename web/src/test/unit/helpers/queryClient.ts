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

import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * A QueryClient for one test.
 *
 * Retries off so a rejected mock fails the assertion instead of the timeout;
 * `gcTime: Infinity` so nothing is collected mid-test. Build a fresh one per
 * test — a shared client leaks cached data between tests and produces
 * order-dependent failures.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Plugin entry for a component mount, e.g.
 * `mount(Comp, { global: { plugins: [store, withQueryClient()] } })`.
 * Pass an existing client when the test needs to seed or assert on the cache.
 */
export function withQueryClient(queryClient: QueryClient = createTestQueryClient()) {
  return [VueQueryPlugin, { queryClient }] as const;
}

export default createTestQueryClient;
