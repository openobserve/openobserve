// Copyright 2023 OpenObserve Inc.
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

import { ref } from "vue";

/**
 * Composable for prefetching route modules on hover
 * This improves perceived performance by loading route components before navigation
 */
export default function useRoutePrefetch() {
  // Track which routes have already been prefetched to avoid redundant loads
  const prefetchedRoutes = ref<Set<string>>(new Set());

  /**
   * Route to module path mapping
   * Maps the route path to the corresponding lazy-loaded component import
   */
  const routeModuleMap: Record<string, () => Promise<any>> = {
    "/": () => import("@/views/HomeView.vue"),
    "/logs": () => {
      return new Promise((resolve) => {
        import("@/plugins/logs/Index.vue");
        import("@/plugins/logs/SearchResult.vue");
        resolve(true);
      });
    },
    "/metrics": () => import("@/plugins/metrics/Index.vue"),
    "/traces": () => import("@/plugins/traces/Index.vue"),
    "/rum": () => import("@/views/RUM/RealUserMonitoring.vue"),
    "/dashboards": () => import("@/views/Dashboards/Dashboards.vue"),
    "/streams": () => import("@/views/StreamExplorer.vue"),
    "/alerts": () => import("@/views/AppAlerts.vue"),
    "/ingestion": () => import("@/views/Ingestion.vue"),
    "/iam": () => import("@/views/IdentityAccessManagement.vue"),
    "/reports": () => import("@/components/reports/ReportList.vue"),
    "/actions": () => import("@/components/actionScripts/ActionScripts.vue"),
    "/settings": () => import("@/components/settings/index.vue"),
  };

  /**
   * Prefetch a route's module by path
   * @param routePath - The route path to prefetch (e.g., "/logs", "/metrics")
   */
  const prefetchRoute = async (routePath: string) => {
    // Skip if already prefetched
    if (prefetchedRoutes.value.has(routePath)) {
      return;
    }

    // Get the module loader for this route
    const moduleLoader = routeModuleMap[routePath];

    if (moduleLoader) {
      try {
        // Mark as being prefetched
        prefetchedRoutes.value.add(routePath);

        // Trigger the dynamic import
        // The browser will cache this module, making subsequent navigation instant
        await moduleLoader();

        console.debug(
          `[Prefetch] Successfully prefetched module for route: ${routePath}`,
        );
      } catch (error) {
        // If prefetch fails, remove from cache so it can be retried
        prefetchedRoutes.value.delete(routePath);
        console.warn(
          `[Prefetch] Failed to prefetch module for route: ${routePath}`,
          error,
        );
      }
    }
  };

  /**
   * Prefetch multiple routes at once
   * @param routePaths - Array of route paths to prefetch
   */
  const prefetchRoutes = async (routePaths: string[]) => {
    const promises = routePaths
      .filter((path) => !prefetchedRoutes.value.has(path))
      .map((path) => prefetchRoute(path));

    await Promise.allSettled(promises);
  };

  /**
   * Reset the prefetch cache
   * Useful for testing or if you need to force re-prefetch
   */
  const resetPrefetchCache = () => {
    prefetchedRoutes.value.clear();
  };

  return {
    prefetchRoute,
    prefetchRoutes,
    prefetchedRoutes: prefetchedRoutes.value,
    resetPrefetchCache,
  };
}
