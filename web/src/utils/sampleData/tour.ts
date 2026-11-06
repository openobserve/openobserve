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
import { queryClient } from "@/composables/query/queryClient";
import { foldersQuery } from "@/services/common.queries";
import { dashboardsByFolderQuery, toSearchHit } from "@/services/dashboards.queries";
import { sampleDataStateQuery } from "@/services/sample_data.queries";
import type { SampleDataState } from "@/services/sample_data";
import type { SampleWindow } from "./assets";
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
  /** The capability the chapter demonstrates, shown as a tag. */
  capability: "dashboards" | "alerts" | "logs" | "traces" | "metrics" | "pipelines";
  /** Route name of the page the chapter opens, used to skip chapters the license locks. */
  route: string;
}

/** One incident, investigated end to end: each chapter shows one capability on the same story. */
export const SAMPLE_TOUR_STEPS: readonly SampleTourStep[] = [
  { id: "dashboard", capability: "dashboards", route: "viewDashboard" },
  { id: "alert", capability: "alerts", route: "alertList" },
  { id: "logs", capability: "logs", route: "logs" },
  { id: "deploy", capability: "logs", route: "logs" },
  { id: "traces", capability: "traces", route: "traces" },
  { id: "metrics", capability: "metrics", route: "metrics" },
  { id: "pipeline", capability: "pipelines", route: "pipelines" },
  { id: "business", capability: "dashboards", route: "viewDashboard" },
];

export interface SampleWindowQuery {
  from?: string;
  to?: string;
  period?: string;
}

/** The saved load window as URL params; orgs loaded before the window was saved fall back to a relative period. */
export const windowParams = (
  win: SampleWindow | undefined,
  fallbackPeriod?: string,
): SampleWindowQuery =>
  win
    ? { from: String(win.startUs), to: String(win.endUs) }
    : fallbackPeriod
      ? { period: fallbackPeriod }
      : {};

const logsQuery = (org: string, stream: string, filter: string, win: SampleWindowQuery) => ({
  name: "logs",
  query: {
    org_identifier: org,
    stream,
    stream_type: "logs",
    ...win,
    refresh: "0",
    sql_mode: "false",
    query: b64EncodeUnicode(filter) ?? "",
    columns: b64EncodeUnicode(JSON.stringify(["service_name", "message"])) ?? "",
    // quick mode fetches only the interesting fields, which leaves the message column blank
    quick_mode: "false",
    type: "logs",
  },
});

const sampleFolderId = async (org: string, type: "dashboards" | "alerts") => {
  const folders = await queryClient.fetchQuery(foldersQuery(org, type));
  return folders.find((f) => f.name === SAMPLE_FOLDER_NAME)?.folderId;
};

// only the sample folder, so a user's same-titled copy elsewhere is never opened
const dashboardTarget = async (org: string, title: string): Promise<RouteLocationRaw> => {
  const folder = await sampleFolderId(org, "dashboards");
  const rows = folder ? await queryClient.fetchQuery(dashboardsByFolderQuery(org, folder)) : [];
  const hit = rows.map(toSearchHit).find((h) => h.title === title);
  if (!hit) return { name: "dashboards", query: { org_identifier: org } };
  return {
    name: "viewDashboard",
    query: { org_identifier: org, dashboard: hit.dashboardId, folder },
  };
};

const stateToWindow = (state?: SampleDataState): SampleWindow | undefined =>
  state?.status === "loaded" && state.start_time && state.end_time
    ? { startUs: state.start_time, endUs: state.end_time }
    : undefined;

const alertsTarget = async (org: string): Promise<RouteLocationRaw> => {
  const folder = await sampleFolderId(org, "alerts");
  return { name: "alertList", query: { org_identifier: org, ...(folder ? { folder } : {}) } };
};

/** Where a chapter's "Show me" lands; resolved lazily because asset ids differ per org. */
export const resolveTourTarget = async (
  org: string,
  id: SampleTourStepId,
): Promise<RouteLocationRaw> => {
  const win = stateToWindow(
    await queryClient.fetchQuery(sampleDataStateQuery(org)).catch(() => undefined),
  );
  switch (id) {
    case "dashboard":
      return dashboardTarget(org, SAMPLE_DASHBOARD_TITLES.overview);
    case "business":
      return dashboardTarget(org, SAMPLE_DASHBOARD_TITLES.business);
    case "alert":
      return alertsTarget(org);
    case "logs":
      return logsQuery(
        org,
        SAMPLE_STREAMS.appLogs,
        "service_name = 'payment' AND level = 'error'",
        windowParams(win, "1h"),
      );
    case "deploy":
      return logsQuery(
        org,
        SAMPLE_STREAMS.appLogs,
        "event = 'deployment'",
        windowParams(win, "1h"),
      );
    case "traces":
      return {
        name: "traces",
        query: {
          org_identifier: org,
          stream: SAMPLE_STREAMS.traces,
          ...windowParams(win, "1h"),
          query: b64EncodeUnicode("span_status = 'ERROR'") ?? "",
        },
      };
    case "metrics":
      return {
        name: "metrics",
        query: { org_identifier: org, metric: SAMPLE_METRICS.latencyP95, ...windowParams(win) },
      };
    case "pipeline":
      return { name: "pipelines", query: { org_identifier: org } };
  }
};
