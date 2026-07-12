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

import config from "@/aws-exports";
import { ref } from "vue";

/**
 * Composable for prefetching route modules on hover
 * This improves perceived performance by loading route components before navigation
 */
/**
 * Whatever /metrics is going to RENDER — which is not a constant.
 *
 * The explorer took over /metrics when the zero-query grid landed and the panel
 * editor moved to /metrics/editor, so prefetching the editor was warming a chunk
 * the click does not use. But the explorer is behind `config.showMetricsExplorer`,
 * and with the flag off the router sends /metrics straight back to the editor — so
 * hardcoding the explorer merely inverts the same bug for the org that turned it
 * off: pay for a module the click never uses, leave the one it does use cold.
 *
 * The condition is the router's own (`showMetricsExplorer !== "false"`, see
 * shared/router.ts), so the two cannot answer this question differently.
 *
 * Exported because it IS the decision, not an implementation detail — which chunk
 * this resolves to is the only thing about a prefetch that can be wrong, and a
 * mocked module's factory runs once, so nothing else about it is observable.
 */
export const metricsChunk = () =>
  config.showMetricsExplorer !== "false"
    ? import("@/plugins/metrics/explorer/MetricsExplorer.vue")
    : import("@/plugins/metrics/Index.vue");

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
      return Promise.all([
        import("@/plugins/logs/Index.vue"),
        import("@/plugins/logs/SearchResult.vue"),
      ]);
    },
    "/metrics": metricsChunk,
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
      // Mark as being prefetched
      prefetchedRoutes.value.add(routePath);

      // Trigger the dynamic import asynchronously without blocking
      // The browser will cache this module, making subsequent navigation instant
      moduleLoader().catch(() => {
        // If prefetch fails, remove from cache so it can be retried
        prefetchedRoutes.value.delete(routePath);
      });
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
