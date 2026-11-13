import type { LocationQuery, RouteLocationRaw } from "vue-router";

// Pages that show one dashboard (or one playlist of dashboards). Their ids
// belong to a single org, so they make no sense after an org switch.
const DASHBOARD_ITEM_PATHS = new Set([
  "/dashboards/view",
  "/dashboards/add_panel",
  "/dashboards/tv",
]);

// The router also matches a trailing slash, for example "/dashboards/view/".
export const isDashboardItemPath = (path: string): boolean =>
  DASHBOARD_ITEM_PATHS.has(path.length > 1 ? path.replace(/\/+$/, "") : path);

/**
 * Builds the route to open after the user picks another org in the header.
 * Logs pages keep their query. Dashboard item pages go to the dashboard list
 * of the new org. Every other page keeps its path with only the new org.
 */
export const getOrgSwitchRoute = (
  path: string,
  query: LocationQuery,
  orgIdentifier: string,
): RouteLocationRaw => {
  if (isDashboardItemPath(path)) {
    return { path: "/dashboards", query: { org_identifier: orgIdentifier } };
  }
  const queryParams = path.indexOf(".logs") > -1 ? query : {};
  return { path, query: { ...queryParams, org_identifier: orgIdentifier } };
};
