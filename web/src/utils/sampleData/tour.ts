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

import type { RouteLocationRaw } from "vue-router";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { queryClient } from "@/composables/query/queryClient";
import { foldersQuery } from "@/services/common.queries";
import { dashboardsSearchQuery, type DashboardSearchHit } from "@/services/dashboards.queries";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  SAMPLE_DASHBOARD_TITLES,
  SAMPLE_FOLDER_NAME,
  SAMPLE_METRICS,
  SAMPLE_STREAMS,
} from "./catalog";

export type SampleTourStepId =
  "dashboard" | "alert" | "logs" | "deploy" | "traces" | "metrics" | "pipeline" | "business";

export interface SampleTourStep {
  id: SampleTourStepId;
  icon: IconName;
  /** The capability the chapter demonstrates, shown as a tag. */
  capability: "dashboards" | "alerts" | "logs" | "traces" | "metrics" | "pipelines";
  /** Route names on which the chapter counts as open. */
  routes: string[];
}

/** One incident, investigated end to end: each chapter shows one capability on the same story. */
export const SAMPLE_TOUR_STEPS: readonly SampleTourStep[] = [
  { id: "dashboard", icon: "dashboard", capability: "dashboards", routes: ["viewDashboard"] },
  { id: "alert", icon: "notifications", capability: "alerts", routes: ["alertList"] },
  { id: "logs", icon: "search", capability: "logs", routes: ["logs"] },
  { id: "deploy", icon: "search", capability: "logs", routes: ["logs"] },
  { id: "traces", icon: "account-tree", capability: "traces", routes: ["traces", "traceDetails"] },
  { id: "metrics", icon: "bar-chart", capability: "metrics", routes: ["metrics"] },
  { id: "pipeline", icon: "alt-route", capability: "pipelines", routes: ["pipelines"] },
  { id: "business", icon: "dashboard", capability: "dashboards", routes: ["viewDashboard"] },
];

const logsQuery = (org: string, stream: string, filter: string) => ({
  name: "logs",
  query: {
    org_identifier: org,
    stream,
    stream_type: "logs",
    period: "1h",
    refresh: "0",
    sql_mode: "false",
    query: b64EncodeUnicode(filter) ?? "",
    columns: b64EncodeUnicode(JSON.stringify(["service_name", "message"])) ?? "",
    // quick mode fetches only the interesting fields, which leaves the message column blank
    quick_mode: "false",
    type: "logs",
  },
});

const dashboardTarget = async (org: string, title: string): Promise<RouteLocationRaw> => {
  const hits = await queryClient.fetchQuery(dashboardsSearchQuery(org, title));
  const hit = hits.find((h: DashboardSearchHit) => h.title === title);
  if (!hit) return { name: "dashboards", query: { org_identifier: org } };
  return {
    name: "viewDashboard",
    query: {
      org_identifier: org,
      dashboard: hit.dashboardId,
      folder: hit.folderId ?? "default",
      period: "3h",
    },
  };
};

const alertsTarget = async (org: string): Promise<RouteLocationRaw> => {
  const folders = await queryClient.fetchQuery(foldersQuery(org, "alerts"));
  const folder = folders.find((f) => f.name === SAMPLE_FOLDER_NAME)?.folderId;
  return { name: "alertList", query: { org_identifier: org, ...(folder ? { folder } : {}) } };
};

/** Where a chapter's "Show me" lands; resolved lazily because asset ids differ per org. */
export const resolveTourTarget = async (
  org: string,
  id: SampleTourStepId,
): Promise<RouteLocationRaw> => {
  switch (id) {
    case "dashboard":
      return dashboardTarget(org, SAMPLE_DASHBOARD_TITLES.overview);
    case "business":
      return dashboardTarget(org, SAMPLE_DASHBOARD_TITLES.business);
    case "alert":
      return alertsTarget(org);
    case "logs":
      return logsQuery(org, SAMPLE_STREAMS.appLogs, "service_name = 'payment' AND level = 'error'");
    case "deploy":
      return logsQuery(org, SAMPLE_STREAMS.appLogs, "event = 'deployment'");
    case "traces":
      return {
        name: "traces",
        query: {
          org_identifier: org,
          stream: SAMPLE_STREAMS.traces,
          period: "1h",
          query: b64EncodeUnicode("span_status = 'ERROR'") ?? "",
        },
      };
    case "metrics":
      return { name: "metrics", query: { org_identifier: org, metric: SAMPLE_METRICS.latencyP95 } };
    case "pipeline":
      return { name: "pipelines", query: { org_identifier: org } };
  }
};
