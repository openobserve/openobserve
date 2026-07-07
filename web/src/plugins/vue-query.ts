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

import { QueryClient, type VueQueryPluginOptions } from "@tanstack/vue-query";

// Single shared QueryClient for the whole app. Exported so tests and
// non-component code (e.g. mutations outside a setup scope) can reach it.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // How long fetched data is served from cache without a background
      // refetch. Within this window a revisit is instant ("get from cache").
      staleTime: 30_000, // 30s — override per query where needed
      // How long unused (no active observers) cache entries are kept before
      // garbage collection.
      gcTime: 5 * 60_000, // 5 min
      retry: 1,
      // O2 keeps long-lived tabs open; avoid surprise refetches on focus.
      refetchOnWindowFocus: false,
    },
  },
});

export const vueQueryPluginOptions: VueQueryPluginOptions = {
  queryClient,
  // Wire up the v6 devtools plugin so the floating panel can attach in dev.
  enableDevtoolsV6Plugin: true,
};
