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

import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";

/**
 * Test-only Vue Query wiring. Returns a fresh QueryClient (retries off, no GC
 * delay) plus the plugin tuple to spread into a mount's `global.plugins`.
 *
 * Usage:
 *   const { plugins, queryClient } = vueQueryTestPlugin();
 *   mount(Component, { global: { plugins: [i18n, router, ...plugins] } });
 */
export function vueQueryTestPlugin() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });

  return {
    queryClient,
    plugins: [[VueQueryPlugin, { queryClient }]] as const,
  };
}

export default vueQueryTestPlugin;
