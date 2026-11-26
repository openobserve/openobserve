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

import type { ContextProvider, PageContext, PageTimeRange } from "./types";

/** The dashboard's applied range, as `pickerValueToTimeObj` resolves it. */
export interface DashboardAppliedTime {
  start_time: Date;
  end_time: Date;
  relativeTimePeriod?: string | null;
}

/**
 * Creates a dashboards context provider that extracts essential context from dashboard pages
 *
 * @param route - Vue router route object (for query params)
 * @param store - Vuex store instance (for organization info)
 * @param dashboardPanelData - Panel data object (for AddPanel page, optional)
 * @param editMode - Boolean indicating if editing a panel (for AddPanel page, optional)
 * @param currentDashboardData - Current dashboard data (for ViewDashboard page, optional)
 * @param appliedTime - Reads the range the dashboard's panels use (for ViewDashboard page, optional)
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
  currentDashboardData?: any,
  appliedTime?: () => DashboardAppliedTime | null,
): ContextProvider => {
  return {
    getContext(): PageContext {
      const context: PageContext = {
        currentPage: "Dashboards",
        dashboardId: route?.query?.dashboard || "",
        organization_identifier: store?.state?.selectedOrganization?.identifier || "",
        // Current timestamp when request is fired (microseconds) for AI agent time calculations
        request_timestamp: Date.now() * 1000,
      };

      const scope = dashboardPanelData
        ? panelEditorScope(dashboardPanelData)
        : dashboardScope(currentDashboardData?.data, route?.query?.tab);
      if (scope) {
        context.selectedStreams = scope.streams;
        if (scope.streamType) context.streamType = scope.streamType;
      }
      const timeRange = timeRangeOf(appliedTime?.());
      if (timeRange) context.timeRange = timeRange;

      // Determine user intent based on route and context
      if (route?.query?.panelId) {
        // Editing specific panel
        context.panelId = route.query.panelId;
        context.user_intent = "edit existing panel";
        context.panelName = dashboardPanelData?.data?.title || "";
      } else if (dashboardPanelData && !editMode) {
        // Creating new panel
        context.user_intent = "create new panel";
        context.panelName = dashboardPanelData?.data?.title || "";
      } else if (currentDashboardData?.data) {
        // Viewing dashboard
        context.user_intent = "view dashboard";
        context.dashboardName = currentDashboardData.data.title || "";
        context.tabId = route?.query?.tab || "";

        // Look up tab name for better AI context
        if (currentDashboardData.data.tabs && context.tabId) {
          const activeTab = currentDashboardData.data.tabs.find(
            (tab: any) => tab.tabId === context.tabId,
          );
          if (activeTab?.name) {
            context.tabName = activeTab.name;
          }
        }
      } else {
        // Fallback - likely viewing dashboard list or other dashboard operation
        context.user_intent = "view dashboard";
      }

      return context;
    },
  };
};

interface StreamScope {
  streams: string[];
  streamType: string | null;
}

function streamTypeOf(queryType: unknown, fields: any): string {
  if (typeof fields?.stream_type === "string" && fields.stream_type) return fields.stream_type;
  return queryType === "promql" ? "metrics" : "logs";
}

// No stream is no scope: a made-up "default" stream reads as a real one to the agent and the placeholder.
function panelEditorScope(dashboardPanelData: any): StreamScope | null {
  const index = dashboardPanelData?.layout?.currentQueryIndex;
  const fields = index === undefined ? null : dashboardPanelData?.data?.queries?.[index]?.fields;
  if (!fields?.stream) return null;
  return {
    streams: [fields.stream],
    streamType: streamTypeOf(dashboardPanelData.data.queryType, fields),
  };
}

function dashboardScope(dashboard: any, tabId: unknown): StreamScope | null {
  const tabs: any[] = Array.isArray(dashboard?.tabs) ? dashboard.tabs : [];
  // The dashboard opens on its first tab when the URL names none (or a stale one).
  const shown = tabs.find((tab) => tab?.tabId === tabId) ?? tabs[0];
  const panels: any[] = Array.isArray(shown?.panels) ? shown.panels : [];
  const queries = panels.flatMap((panel) =>
    (Array.isArray(panel?.queries) ? panel.queries : []).map((query: any) => ({
      queryType: panel.queryType,
      fields: query?.fields,
    })),
  );
  const named = queries.filter((query) => query.fields?.stream);
  if (!named.length) return null;
  const types = new Set(named.map((query) => streamTypeOf(query.queryType, query.fields)));
  return {
    streams: [...new Set(named.map((query) => String(query.fields.stream)))],
    // One type for a mixed scope would mislabel the other streams.
    streamType: types.size === 1 ? [...types][0] : null,
  };
}

function timeRangeOf(applied: DashboardAppliedTime | null | undefined): PageTimeRange | null {
  // Dashboard Dates carry microseconds as their "ms" value (getConsumableRelativeTime), so no scaling.
  const startTime = applied?.start_time?.getTime?.();
  const endTime = applied?.end_time?.getTime?.();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return applied?.relativeTimePeriod
    ? {
        type: "relative",
        relativeTimePeriod: applied.relativeTimePeriod,
        startTime: startTime as number,
        endTime: endTime as number,
      }
    : { type: "absolute", startTime: startTime as number, endTime: endTime as number };
}
