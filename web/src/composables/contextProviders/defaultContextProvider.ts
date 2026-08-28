/**
 * Default Context Provider - Provides basic context when no specific page provider is active
 *
 * This provider extracts basic information available across all pages:
 * - Current route information
 * - Selected organization
 * - Basic user context
 * - Timestamp
 *
 * Example Usage:
 * ```typescript
 * import { createDefaultContextProvider } from '@/composables/contextProviders/defaultContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 *
 * // Create and register default provider
 * const defaultProvider = createDefaultContextProvider(router, store);
 * contextRegistry.register('default', defaultProvider);
 * contextRegistry.setActive('default');
 * ```
 */

import { gt } from "@/types/i18n";

import type { ContextProvider, PageContext } from "./types";

/**
 * Creates a default context provider that extracts basic application context
 *
 * @param router - Vue router instance (for route information)
 * @param store - Vuex store instance (for organization and user info)
 *
 * Example:
 * ```typescript
 * const provider = createDefaultContextProvider(router, store);
 * ```
 */
export const createDefaultContextProvider = (router: any, store: any): ContextProvider => {
  return {
    getContext(): PageContext {
      const currentRoute = router?.currentRoute?.value;

      return {
        // Resolved text, not the raw `meta.titleKey`: this is the human-readable
        // page label the assistant quotes back ("you're on Alerts"), and it should
        // match what the user actually sees in their locale. The stable,
        // language-independent identifier is already carried by `routeName` below.
        currentPage: currentRoute?.meta?.titleKey ? gt(currentRoute.meta.titleKey) : "unknown",

        // Current route information
        routeName: currentRoute?.name || "unknown",
        routePath: currentRoute?.path || "/",
        routeFullPath: currentRoute?.fullPath || "/",
        routeParams: currentRoute?.params || {},
        routeQuery: currentRoute?.query || {},

        // Organization context
        organization_identifier: store?.state?.selectedOrganization?.identifier || "",

        // Current timestamp when request is fired (microseconds) for AI agent time calculations
        request_timestamp: Date.now() * 1000,
      };
    },
  };
};
