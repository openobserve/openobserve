/**
 * Dashboards Context Provider - Extracts context from dashboard pages
 * 
 * This provider extracts essential dashboard information including:
 * - Dashboard ID and name
 * - Panel ID (if viewing/editing specific panel)
 * - Organization context
 * - User intent (view dashboard, create panel, edit panel, etc.)
 * 
 * Example Usage:
 * ```typescript
 * import { createDashboardsContextProvider } from '@/composables/contextProviders/dashboardsContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 * 
 * // Create and register provider
 * const provider = createDashboardsContextProvider(route, store, dashboardPanelData, editMode);
 * contextRegistry.register('dashboards', provider);
 * contextRegistry.setActive('dashboards');
 * ```
 */

import type { ContextProvider, PageContext } from './types';

/**
 * Creates a dashboards context provider that extracts essential context from dashboard pages
 * 
 * @param route - Vue router route object (for query params)
 * @param store - Vuex store instance (for organization info)
 * @param dashboardPanelData - Panel data object (for AddPanel page, optional)
 * @param editMode - Boolean indicating if editing a panel (for AddPanel page, optional)
 * @param currentDashboardData - Current dashboard data (for ViewDashboard page, optional)
 * 
 * Example:
 * ```typescript
 * const provider = createDashboardsContextProvider(route, store, dashboardPanelData, editMode);
 * ```
 */
export const createDashboardsContextProvider = (
  route: any,
  store: any,
  dashboardPanelData?: any,
  editMode?: boolean,
  currentDashboardData?: any
): ContextProvider => {
  return {
    getContext(): PageContext {
      const context: PageContext = {
        currentPage: 'Dashboards',
        dashboardId: route?.query?.dashboard || '',
        organization_identifier: store?.state?.selectedOrganization?.identifier || ''
      };

      // Determine user intent based on route and context
      if (route?.query?.panelId) {
        // Editing specific panel
        context.panelId = route.query.panelId;
        context.user_intent = 'edit existing panel';
        context.panelName = dashboardPanelData?.data?.title || '';
      } else if (dashboardPanelData && !editMode) {
        // Creating new panel
        context.user_intent = 'create new panel';
        context.panelName = dashboardPanelData?.data?.title || '';
      } else if (currentDashboardData?.data) {
        // Viewing dashboard
        context.user_intent = 'view dashboard';
        context.dashboardName = currentDashboardData.data.title || '';
        context.tabId = route?.query?.tab || '';
      } else {
        // Fallback - likely viewing dashboard list or other dashboard operation
        context.user_intent = 'view dashboard';
      }

      return context;
    }
  };
};