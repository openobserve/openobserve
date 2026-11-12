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

export type AnalyticsSubTab =
  "overview" | "funnels" | "paths" | "heatmaps" | "retention" | "events";

export const PRODUCT_ANALYTICS_PATH = "/product-analytics";

export const PA_ROUTES = {
  shell: "productAnalytics",
  overview: "productAnalyticsOverview",
  funnels: "productAnalyticsFunnels",
  funnelBuilder: "productAnalyticsFunnelBuilder",
  paths: "productAnalyticsPaths",
  heatmaps: "productAnalyticsHeatmaps",
  retention: "productAnalyticsRetention",
  events: "productAnalyticsEvents",
  eventNew: "productAnalyticsEventNew",
  eventEdit: "productAnalyticsEventEdit",
} as const;

export const ANALYTICS_SUBTABS: readonly AnalyticsSubTab[] = [
  "overview",
  "funnels",
  "paths",
  "heatmaps",
  "retention",
  "events",
];

/** The route a sub-tab click opens. */
export const SUBTAB_ROUTES: Record<AnalyticsSubTab, string> = {
  overview: PA_ROUTES.overview,
  funnels: PA_ROUTES.funnels,
  paths: PA_ROUTES.paths,
  heatmaps: PA_ROUTES.heatmaps,
  retention: PA_ROUTES.retention,
  events: PA_ROUTES.events,
};

/** The sub-tab each shell child lights; the builder belongs to Funnels. */
export const ROUTE_SUBTAB: Record<string, AnalyticsSubTab> = {
  [PA_ROUTES.overview]: "overview",
  [PA_ROUTES.funnels]: "funnels",
  [PA_ROUTES.funnelBuilder]: "funnels",
  [PA_ROUTES.paths]: "paths",
  [PA_ROUTES.heatmaps]: "heatmaps",
  [PA_ROUTES.retention]: "retention",
  [PA_ROUTES.events]: "events",
};

export const subTabOfRoute = (name: unknown): AnalyticsSubTab | null =>
  typeof name === "string" ? (ROUTE_SUBTAB[name] ?? null) : null;

const HEATMAP_REDIRECT_KEYS = [
  "org_identifier",
  "app",
  "page_url",
  "device",
  "period",
  "from",
  "to",
];

/** The old RUM heatmaps path keeps working: its query moves to the Product Analytics route. */
export const redirectHeatmaps = (to: { query: Record<string, unknown> }) => {
  const query: Record<string, unknown> = {};
  for (const key of HEATMAP_REDIRECT_KEYS) {
    if (to.query[key] !== undefined) query[key] = to.query[key];
  }
  if (query.period === undefined && to.query.range !== undefined) query.period = to.query.range;
  return { name: PA_ROUTES.heatmaps, query };
};
